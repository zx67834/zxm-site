# SourceCode 的复盘

> 这篇先保留我实际的推进顺序：从 Web 枚举拿到低权限 shell，再从定时任务中定位提权点。后续补充的另一条路径只作对照，不替代我实际复现的 `user.txt` 竞争法。

## 1. 目标与环境

靶机 IP：`192.168.134.58`  
Kali 地址：`192.168.134.4`
![Nmap 扫描前的目标信息](/content/sourcecode/target-info.png)
![靶机首页](/content/sourcecode/homepage.png)

## 2. 信息收集

先看端口，开放了 22 和 80：
```
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 10.0p2 Debian 7+deb13u4
80/tcp open  http    Apache httpd 2.4.67 (Debian)
```
![Nmap 扫描结果](/content/sourcecode/nmap.png)
![Web 服务首页](/content/sourcecode/web-home.png)

继续做 Web 目录枚举：

```
200   357B   http://192.168.134.25/login.php
200    29B   http://192.168.134.25/shell.php
200  2682B   http://192.168.134.25/index.html
```
![目录扫描结果](/content/sourcecode/directory-scan.png)

这里出现了 `login.php` 和 `shell.php` 两个关键页面。首页中的线索可以拿到登录凭据；登录后需要继续确认 `shell.php` 是否只是展示页，还是存在命令执行能力。

## 3. 初始访问：Web 登录到低权限 shell
![登录页面或凭据线索](/content/sourcecode/login-clue.png)
![登录后的页面](/content/sourcecode/login.png)
![命令执行验证](/content/sourcecode/rce.png)
![初始 shell](/content/sourcecode/shell.png)
![权限与本地用户枚举](/content/sourcecode/enum.png)
![定时任务线索](/content/sourcecode/timer-clue.png)

此时已经确认可以命令执行，身份是低权限 Web 用户。枚举时发现存在定时任务，这是后续提权的核心线索。

为了便于后续交互与等待竞态窗口，需要获得更稳定的 shell：
![升级交互式 shell](/content/sourcecode/tty.png)
## 4. 提权点：root 定时任务 `boob.sh`

`boob.sh` 会先清空 `huazai` 的家目录，随后把 `/opt/backup/` 中的内容复制回去：
![boob 定时任务](/content/sourcecode/boob-script.png)

危险点在 `cp -La`：`-L` 会跟随符号链接，而脚本又以 root 身份执行。脚本先删除攻击者可控目录里的文件，再复制文件，两个动作之间就产生了可以反复抢占的时间窗口。

## 5. 我实际复现的路径：`user.txt` 竞争

我选择的是最后一条复制语句：

```bash
cp -La /opt/backup/user.txt /home/huazai/user.txt
```

在 `huazai` 可写的家目录中持续将 `user.txt` 重建为指向 `/opt/boob.sh` 的符号链接。每次定时任务先删掉这个链接后，竞争循环会尝试立刻补回；一旦 root 执行复制时链接仍存在，`cp -L` 就会沿链接把备份内容写入 `/opt/boob.sh`，从而改变它的 MD5。

![竞争循环与后台运行状态](/content/sourcecode/race.png)

这条路径的优点是很直观：源文件与目标文件名都明确是 `user.txt`，可以直接把竞争点锁定在最后一次 `cp` 上。

## 6. 对照补充：另一条 `.bashrc` 竞争路径

另一种可行思路并不是不同漏洞，而是选择了同一个 root 脚本中的另一条复制语句：

```bash
cp -La /opt/backup/.* /home/huazai/
```

这里的 `.*` 会包含备份中的 `.bashrc`。因此也可以持续把 `/home/huazai/.bashrc` 重建为指向 `/opt/boob.sh` 的符号链接，等待脚本执行上述带 `-L` 的复制操作。若复制发生时链接存在，备份 `.bashrc` 的内容同样会被 root 写进 `/opt/boob.sh`，导致 MD5 变化。

两条路径的关系如下：

| 路径 | 竞争文件名 | 命中的复制语句 | 本质 |
| --- | --- | --- | --- |
| 我复现的路径 | `~/user.txt` | `cp -La /opt/backup/user.txt ~/user.txt` | root 跟随目标端符号链接写入 `boob.sh` |
| 对照路径 | `~/.bashrc` | `cp -La /opt/backup/.* ~/` | root 跟随目标端符号链接写入 `boob.sh` |

所以重点不在于记住 `user.txt` 或 `.bashrc`：两者都是攻击者可控制的“落点”，根因始终是 **root 任务在可写目录中使用 `cp -L`，且删除与复制之间存在可竞争的时间窗口**。

## 7. MD5 改变后得到 root

`boob.sh` 被改写后，另一个定时检查脚本发现 MD5 不一致，并创建了 UID 为 0 的账户。最终以该账户获得 root：

![获取 root 的证据](/content/sourcecode/root.png)

## 8. 这题的收获

- 不能只枚举 SUID；root 的 cron、systemd timer 和备份/清理脚本也都是高价值提权面。
- 手动复制失败不代表思路错误：要区分“我以 `huazai` 身份能否写入”与“root 定时任务是否会替我完成写入”。
- 竞态题先还原脚本的执行身份、文件操作顺序和软链接解析方式，再决定在哪个文件名上竞争。

## 9. 从现场证据看作者的设计思路

这一节把现场观察与推断分开。这样写的目的不是替作者脑补答案，而是说明：题目中的每个限制，如何把玩家推向下一步。

### 9.1 可以直接确认的设计

| 现场证据 | 设计作用 |
| --- | --- |
| root 的 crontab 中有 `*/8 * * * * /bin/bash /opt/boob.sh` | `boob.sh` 每 8 分钟运行一次，清理环境并踢出 `huazai`，形成固定的倒计时。 |
| 同一份 crontab 中有每分钟运行的 `/root/check_boob.sh` | `boob.sh` 的状态不是普通文件状态，而是被额外的完整性检查逻辑监控。 |
| SSH 配置包含 `DenyUsers huazai` | 首页给出的 `huazai` 密码不能直接 SSH 使用，玩家必须先利用 Web 入口取得本地 shell，再 `su huazai`。 |
| `/opt/backup/user.txt` 是 root 所有，且会被单独复制到 `~/user.txt` | `user.txt` 是被特意安排的、稳定的竞争落点；它不是普通用户初始化文件。 |
| 提权成功后 `/opt/boob.sh` 内容变为 user flag，而 `/root/boob.md5` 保留原始摘要 | 这直接证明“改写 boob → MD5 不一致 → 触发后续逻辑”是完整的一条预设链路。 |
| `check_boob.sh` 在触发后消失 | 这是一次性剧情开关：成功后自毁，避免反复创建账户，也让靶机状态明确进入完成态。 |

### 9.2 主题如何变成解题机制

靶机名是 **SourceCode**，`boob.sh` 的行为是每 8 分钟清空 `huazai` 的家目录、清空临时目录并把人踢下线。结合首页的提示 “Only by stopping the boob can you go on”，这里的“8 分钟”不是随机的 cron 周期，而是在借电影《源代码》的倒计时/循环设定塑造解题压力。

作者并没有直接把 root 权限放在 `boob.sh` 里，而是把它设计为一个需要被“拆掉”的机制：

```text
Web 入口拿到 huazai 凭据
        ↓
SSH 被拒绝，但 Webshell 中可 su huazai
        ↓
每 8 分钟被踢下线，发现并理解 boob.sh
        ↓
利用 cp -L 的竞争改写 boob.sh（拆弹）
        ↓
每分钟的 check_boob.sh 发现 MD5 改变
        ↓
创建 newhuazai（UID 0），“重生”后获得 root
```

`newhuazai` 这个账户名、检查脚本的自毁、以及备份 `.bashrc` 中的终端时钟彩蛋，共同让“拆弹后进入新状态”这件事更像题目叙事的一部分，而不只是一个孤立的 Linux 提权漏洞。

### 9.3 两条解法在作者设计中的位置

我复现的 `user.txt → /opt/boob.sh` 路径，和题目提示、MD5 检查、`newhuazai` 账户三者闭环，最符合“拆掉 boob 才能继续”的主线，因此应当视为作者重点引导的解法。

`.bashrc → /etc/passwd` 则是同一个 `cp -L` 原语自然导出的泛化利用：只要攻击者能在目标目录竞争到一个符号链接，就能让 root 的复制操作写到任意可写入的目标文件。它可以直接向 `/etc/passwd` 注入 UID 0 账户，绕过“拆弹 → 检查 → newhuazai”的剧情闭环。

因此更准确的表述不是“两种完全不同的漏洞”，而是：

- **预设主线**：用 `user.txt` 改写 `boob.sh`，触发检查脚本创建 `newhuazai`。
- **通用旁路**：用 `.bashrc` 把 root 的 `cp -L` 变成对 `/etc/passwd` 等敏感文件的越权写入。

作者给的是一个真实可泛化的竞态原语，而不是只允许单一 payload 的机关题。
