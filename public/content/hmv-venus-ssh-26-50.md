# HMV Venus SSH 闯关复盘（下）：第 26～50 关

> 接 [上篇（第 1～25 关）](/articles/read?slug=hmv-venus-ssh-1-25)。平台仍是 [HackMyVM | Venus](https://hackmyvm.eu/venus/)，操作只发生在平台分配的靶机内。

上篇停在 freya 拿到 alexa 的密码。从 0x26 起，题目从纯文件操作转到本机 HTTP、数据库、编码和一小截权限工具。用户链接着上篇：

```text
alexa → ariel → lola → celeste → nina → kira → veronica → lana → noa
     → maia → gloria → alora → julie → irene → adela → sky → sarah
     → mercy → paula → karla → denise → zora → belen → leona → ava → maria
```

maria 家目录里的 mission 已经是 0x51，内容是 Congrats。

## 0x26 ariel：本机 HTTP

题目：ariel 的密码在线上，协议是 HTTP。

`ps` 直接被拒，不必绕进程列表。靶机上有本机 Web 服务，`curl 127.0.0.1` 就是密码：

```bash
alexa@venus:~$ ps aux
-bash: /usr/bin/ps: Permission denied
alexa@venus:~$ curl 127.0.0.1
33EtHoz9a0w2Yqo
```

后面好几关都是这个 nginx，只是路径、方法、请求头不同。

## 0x27 lola：Vim swap 里的字典

题目：ariel 没来得及保存 lola 的密码，但留下了一个临时文件。

先去 `/tmp` 是弯路。那个目录是 `drwxr-x-wx`，能往里写，列不出别人的文件。临时文件在家目录里：`.goas.swp`。`file` 认得出这是 Vim 8.2 的 swap，对应原文件 `~teste/goas`。

```bash
ariel@venus:~$ file .goas.swp
.goas.swp: Vim swap file, version 8.2, pid 2299, user teste, host deb11, file ~teste/goas, modified
ariel@venus:~$ vim -r .goas.swp
```

恢复出来是一份旧密码字典，行首带 `-->`（有一行少了 `>`）：

```text
-->ppkJjqYvSCIyAhK
-->cOXlRYXtJWnVQEG
--rxhKeFKveeKqpwp
```

在 Vim 里收成 hydra 能吃的词表：`:v/^--/d` 删掉不以 `--` 开头的行，`:%s/^-->\?//` 去掉行首的 `-->` 或 `--`。我把 swap 拉回 kali 做这一步更顺手：

```bash
scp -P 5000 ariel@venus.hackmyvm.eu:.goas.swp .
hydra -l lola -P lola_passwd -t 4 -s 5000 ssh://venus.hackmyvm.eu
[5000][ssh] host: venus.hackmyvm.eu   login: lola   password: d3LieOzRGX5wud6
```

18 条候选，`-t 4` 是因为 SSH 并行太高会被掐连接。命中的是 `d3LieOzRGX5wud6`。

## 0x28 celeste：按字典扫页面

题目：celeste 留了一份可能的 `.html` 页面名，密码在其中某一页。

`pages.txt` 是名字列表，本机 Web 还在。上篇 0x23 是按字典探测没有读权限的目录，这里换成按名字请求 URL，把 HTML 标签行滤掉：

```bash
lola@venus:~$ while IFS= read -r line; do
    curl -s "http://127.0.0.1/$line.html"
    echo
done < pages.txt 2>/dev/null | grep -v '<'
VLSNMTKwSV2o8Tn
```

`ss` 同样没权限，不需要它。页面名对上之后，响应体里就是密码。

## 0x29 nina：MySQL 和 passwd 求交集

题目：celeste 能进 MySQL，但没说拿它干什么。

库的密码就是上一关拿到的 SSH 密码。库里只有 `venus.people`，三列：`id_people`、`uzer`、`pazz`，95 行。

```bash
celeste@venus:~$ mysql -u celeste -p
MariaDB [(none)]> SHOW DATABASES;
information_schema
venus
MariaDB [venus]> SHOW TABLES;
people
```

我先把整张表拿去打 SSH，连接被限速打挂，方向也不对：这 95 个名字大多不是系统用户。题目要的是表里和真实账号重合的那一个。

`/etc/passwd` 一行是 `nina:x:1005:1005::/pwned/nina:/bin/bash`。`-F:` 按冒号分列，`$3` 是 uid，筛出 1000 到 65534 之间的普通用户；`cut -d: -f1` 取出库里的用户名；两边 `sort` 之后 `comm -12` 取交集：

```bash
celeste@venus:~$ mysql -u celeste -p'VLSNMTKwSV2o8Tn' \
    -e "SELECT CONCAT(uzer, ':', pazz) FROM venus.people;" > /tmp/db_pass.txt
celeste@venus:~$ awk -F: '$3>=1000 && $3<65534 {print $1}' /etc/passwd | sort > /tmp/sysusers.txt
celeste@venus:~$ cut -d: -f1 /tmp/db_pass.txt | sort > /tmp/dbusers.txt
celeste@venus:~$ comm -12 /tmp/sysusers.txt /tmp/dbusers.txt
nina
```

交集只有 `nina`。回到表里对上这一行，密码是 `ixpeqdWuvC5N9kG`。表里还有一行 `pazz` 长得像 flag（`8===...===D~~`），那是干扰项。

## 0x30 kira：换 HTTP 方法

题目：kira 在 `http://localhost/method.php` 里藏了东西。

GET 的正文是 `I dont like this method!`。把常见方法逐个打过去，PUT 返回密码，PATCH 返回一串 flag 形状的字符串，别拿错：

```bash
nina@venus:~$ for m in GET POST PUT PATCH DELETE OPTIONS HEAD TRACE CONNECT; do
    echo "===== $m ====="
    curl -s -i -X "$m" http://localhost/method.php | tail -n 5
done
===== PUT =====
tPlqxSKuT4eP3yr
===== PATCH =====
8===tPGClekAvQKSYthnLiwz===D~~
I dont like this method!
```

`curl -X HEAD` 不会自己处理响应体，容易挂住，加 `--max-time 3` 即可。密码是 PUT 的 `tPlqxSKuT4eP3yr`。

## 0x31 veronica：指定 User-Agent

题目：veronica 经常访问 `http://localhost/waiting.php`。

空 UA 时页面直接说它在等 `PARADISE`：

```bash
kira@venus:~$ curl -s http://localhost/waiting.php
Im waiting for the user-agent PARADISE.
kira@venus:~$ curl -s -A "PARADISE" http://localhost/waiting.php
QTOel6BodTx2cwX
```

`-A "PARADISE"` 等于 `-H "User-Agent: PARADISE"`。这几关用到的 curl 参数：

| 参数 | 作用 |
| :--- | :--- |
| `-s` | 静默，只要响应体 |
| `-i` | 连响应头一起打 |
| `-A` | 设置 User-Agent |
| `-H` | 加一个请求头 |
| `-X` | 指定方法 |
| `--max-time` | 超时，避免 HEAD 挂住 |

## 0x32 lana：别名里的密码

题目：veronica 常用 lana 的密码，所以做了个别名。

```bash
veronica@venus:~$ alias
alias lanapass='echo "UWbc0zNEVVops1v"'
alias ls='ls --color=auto'
```

`lanapass` 把密码 echo 出来：`UWbc0zNEVVops1v`。别名的几条规则：定义时等号两边不能有空格，命令要加引号；`alias` 列出全部，`alias 名字` 看单个，`unalias 名字` 删除。直接敲出来的别名只活在当前 shell，要永久生效得写进 `~/.bashrc` 再 `source`。

## 0x33 noa：扩展名是 gz，内容是 tar

题目：noa 喜欢压缩她的东西。

`zip.gz` 这个名字会让人去 `gunzip`，`file` 说它是 POSIX tar，gzip 会拒绝：

```bash
lana@venus:~$ file zip.gz
zip.gz: POSIX tar archive (GNU)
lana@venus:~$ gunzip zip.gz
gzip: zip.gz: not in gzip format
lana@venus:~$ tar -tf zip.gz
pwned/lana/zip
```

和上篇 0x09 一样，包内路径从 `pwned/` 建起，家目录不允许创建这一层。解到 `/tmp`：

```bash
lana@venus:~$ mkdir /tmp/lana && cd /tmp/lana
lana@venus:/tmp/lana$ tar -xf /pwned/lana/zip.gz
lana@venus:/tmp/lana$ cat pwned/lana/zip
9WWOPoeJrq6ncvJ
```

`tar -t` 只列表，`-x` 才解包。类型以 `file` 为准，不以扩展名为准。

## 0x34 maia：垃圾堆里的可打印串

题目：maia 的密码被垃圾围着。

`trash` 是 `data`，没有文本结构。`strings` 抽出连续可打印字符，绝大多数是几个字节的噪声，用长度把短的滤掉：

```bash
noa@venus:~$ file trash
trash: data
noa@venus:~$ strings trash | grep -E '^.{15,}$'
\nh1hnDPHpydEjoEN
```

行首的 `\n` 是垃圾字符，15 位密码是 `h1hnDPHpydEjoEN`。

## 0x35 gloria：补最后两个小写字母

题目：gloria 忘了密码最后两个字符，只记得是小写字母。已知前缀在 `forget` 里：`v7xUVE2e5bjUc??`。

26×26 = 676 种，生成词表后用 hydra 打平台的 5000 端口：

```bash
for a in {a..z}; do
  for b in {a..z}; do
    echo "v7xUVE2e5bjUc$a$b"
  done
done > cands.txt
hydra -l gloria -P cands.txt -t 4 -s 5000 ssh://venus.hackmyvm.eu
[5000][ssh] host: venus.hackmyvm.eu   login: gloria   password: v7xUVE2e5bjUcxw
```

同一件事可以写成一行：`echo v7xUVE2e5bjUc{a..z}{a..z} | xargs -n 1 > cands.txt`。SSH 限速，676 条跑了大约一刻钟，`-t 4` 比默认并行稳。

## 0x36 alora：ASCII 二维码

题目：alora 喜欢画画，所以把密码存成了…… `image` 是 ASCII 文本，画的是一张二维码。

```text
##########################################################
##########################################################
##########################################################
##########################################################
########              ##########  ##              ########
########  ##########  ##    ##  ####  ##########  ########
########  ##      ##  ##  ##  ######  ##      ##  ########
########  ##      ##  ####  ########  ##      ##  ########
########  ##      ##  ##        ####  ##      ##  ########
########  ##########  ##        ####  ##########  ########
########              ##  ##  ##  ##              ########
########################  ####  ##########################
########    ##  ####    ####  ##  ##      ##    ##########
############    ######  ##    ##      ##          ########
########    ##    ##  ##  ##            ####  ##  ########
##############      ##  ##    ######  ##    ####  ########
############    ##      ##  ########    ##  ##  ##########
########################    ####    ##  ##  ####  ########
########              ##    ####            ##  ##########
########  ##########  ######  ##########  ####  ##########
########  ##      ##  ####  ##      ######        ########
########  ##      ##  ##    ##  ######  ##  ####  ########
########  ##      ##  ####          ##    ##  ##  ########
########  ##########  ##      ####  ##  ##################
########              ##  ##                    ##########
##########################################################
##########################################################
##########################################################
##########################################################
```

扫出来是 `mhrTFCoxGoqUxtw`。

## 0x37 julie：ISO 里的 zip

题目：julie 做了一张带密码的 ISO。

不挂载也能看。`isoinfo -l -i` 列出内容，里面是 `MUSIC.ZIP;1`（ISO 9660 的版本号写在分号后面）。提取时路径前要有 `/`，分号要转义：

```bash
alora@venus:~$ isoinfo -l -i music.iso
----------   0    0    0             208 May  4 2026 [     25 00]  MUSIC.ZIP;1
alora@venus:~$ isoinfo -i music.iso -x /MUSIC.ZIP\;1 > /tmp/music.zip
alora@venus:~$ unzip /tmp/music.zip -d /tmp/music
alora@venus:~$ cat /tmp/music/pwned/alora/music.txt
sjDf4i2MSNgSvOv
```

这张 ISO 只有 360KB。事后看，`strings music.iso` 也能直接看到同一串密码；当时走的是按格式拆开。

## 0x38 irene：diff 找不同的那一行

题目：irene 觉得美在差异里。家目录两个等长文件 `1.txt`、`2.txt`。

```bash
julie@venus:~$ diff 1.txt 2.txt
174c174
< 8VeRLEFkBpe2DSD
---
> aNHRdohjOiNizlU
```

`174c174` 表示只有第 174 行不同。`<` 是 `1.txt`，`>` 是 `2.txt`。`diff -u` 把同一处画成补丁，更好读。登录用的是 `2.txt` 里的 `aNHRdohjOiNizlU`。

## 0x39 adela：私钥解开的密码

题目：adela 把密码借给了 irene。

三个文件：`id_rsa.pem`（无口令的 OpenSSH 私钥）、`id_rsa.pub`、`pass.enc`（256 字节密文）。用私钥做 RSA 解密：

```bash
irene@venus:~$ file id_rsa.pem
id_rsa.pem: OpenSSH private key (no password)
irene@venus:~$ openssl pkeyutl -decrypt -inkey id_rsa.pem -in pass.enc
nbhlQyKuaXGojHx
```

`openssl rsautl` 也能解，OpenSSL 3 起提示改用 `pkeyutl`。明文就是 adela 的密码。

## 0x40 sky：摩尔斯电码

题目：sky 把密码存在一个可以“听”的东西里。

`wtf` 是 ASCII，内容是点和划：

```bash
adela@venus:~$ file wtf
wtf: ASCII text
adela@venus:~$ cat wtf
.--. .- .--. .- .--. .- .-. .- -.. .. ... .
```

靶机上没有 `morse` 命令。这串解码是 `PAPAPARADISE`，登录要用小写：`papaparadise`。0x50 还会再来一次。

## 0x41 sarah：自定义请求头

题目：sarah 用 header 访问 `http://localhost/key.php`。

不带头时正文是一句问话，`key: true` 才给密码：

```bash
sky@venus:~$ curl -s http://localhost/key.php
Key header is true?
sky@venus:~$ curl -s -H "key: true" http://localhost/key.php
LWOHeRgmIxg7fuS
```

响应体没有换行，会粘在提示符上，看起来像 `LWOHeRgmIxg7fuSsky`。密码是前 15 位 `LWOHeRgmIxg7fuS`。

## 0x42 mercy：文件名是三个点

题目：mercy 的密码藏在这个目录里。

上篇 0x01 的隐藏文件再来一次。`...` 是合法文件名，普通 `ls` 不显示，`ls -la` 才看得到。`cat ...` 会被当成当前目录下的相对路径，写清楚即可：

```bash
sarah@venus:~$ ls -la
-rw-r----- 1 root  sarah   16 May  4 07:40 ...
sarah@venus:~$ cat ...
ym5yyXZ163uIS8L
```

## 0x43 paula：bash 历史

题目：mercy 总是把 paula 的密码输错。

`su -l mercy` 的 `-l` 是登录 shell，会回到新用户的家目录。历史在 `.bash_history` 里，错的那次把密码本身敲了进去：

```bash
mercy@venus:~$ cat .bash_history
ls -A
ls
rm /
ps
sudo -l
watch tv
vi /etc/logs
su paula
dlHZ6cvX6cLuL8p
history
history -c
```

`history -c` 只清当前 shell 的内存历史，文件里已经写下的行还在。密码是 `dlHZ6cvX6cLuL8p`。

## 0x44 karla：按附加组找

题目：karla 信任我，她在我的朋友组里。

`id` 比 `whoami` 多看出来一个组：`hidden`。按组找文件：

```bash
paula@venus:~$ id
uid=1044(paula) gid=1044(paula) groups=1044(paula),1053(hidden)
paula@venus:~$ find / -group hidden -type f 2>/dev/null
/usr/src/.karl-a
paula@venus:~$ cat /usr/src/.karl-a
gYAmvWY3I7yDKRf
```

文件名把 `karla` 拆开了，内容就是她的密码。

## 0x45 denise：EXIF 里的 About

题目：denise 把密码存在图片里。

`yuju.jpg` 用 `exiftool` 看元数据。有用的是 XMP 的 About，Artist 那些是干扰：

```bash
karla@venus:~$ exiftool yuju.jpg
Artist                          : sML
XMP Toolkit                     : Image::ExifTool 12.16
About                           : pFg92DpGucMWccA
Creator                         : sML
```

密码是 `pFg92DpGucMWccA`。

## 0x46 zora：doas

题目：zora 在喊 doas。

doas 是 OpenBSD 的提权工具，干的事和 sudo 同类，配置短得多。这一关没有 `sudo -l` 那种列表开关，`-l` 会直接报错。规则在 `/etc/doas.conf`：

```bash
denise@venus:~$ doas -l
doas: invalid option -- 'l'
usage: doas [-Lns] [-C config] [-u user] command [args]
denise@venus:~$ cat /etc/doas.conf
permit denise as zora
denise@venus:~$ doas -u zora bash
zora@venus:/pwned/denise$
```

`permit denise as zora` 允许 denise 以 zora 的身份执行命令。`doas -u zora bash` 会问 denise 自己的密码，通过后就是 zora 的 shell。

## 0x47 belen：按主机名访问

题目：belen 把密码留在 `venus.hmv`。

这是个主机名，不是文件。直接 curl：

```bash
zora@venus:~$ curl -s venus.hmv
2jA0E8bQ4WrGwWZ
```

本机 nginx 按 Host 区分站点。等价写法是 `curl -H "Host: venus.hmv" http://127.0.0.1`。

## 0x48 leona：md5crypt

题目：belen 偷了 leona 的密码。

`stolen.txt` 是一行哈希：`$1$leona$lhWp56YnWAMz6z32Bw53L0`。`$1$` 是 md5crypt，中间的 `leona` 是 salt。拉到 kali，用 rockyou 跑：

```bash
echo '$1$leona$lhWp56YnWAMz6z32Bw53L0' > /tmp/hash.txt
john --wordlist=/usr/share/wordlists/rockyou.txt /tmp/hash.txt
```

![John 用 rockyou 跑出 leona 的密码 freedom](/content/hmv-venus-ssh-26-50/image-01.webp)

John 提示这串也能按 `md5crypt-long` 加载，默认格式已经认出来了，不用改。结果行上的 `(?)` 表示它还没完全确认，`su leona` 用 `freedom` 可以通过。

## 0x49 ava：zone 文件里的 TXT

题目：ava 最近老在玩 `venus.hmv` 的 DNS。

`dig` 只回了一条 A 记录，指向 `172.25.20.20`，密码不在解析结果里。我卡在这里。记录写在本机 BIND 的 zone 文件中：

```bash
leona@venus:~$ dig venus.hmv
;; ANSWER SECTION:
venus.hmv.              600     IN      A       172.25.20.20
leona@venus:~$ cat /etc/bind/db.venus.hmv
ns1     IN      A       127.0.0.1
ava IN      TXT     oCXBeeEeYFX34NU
```

`ava` 的 TXT 记录就是密码：`oCXBeeEeYFX34NU`。查到 A 记录只说明域名解析正常，题目说的 “plays with the DNS” 指的是 zone 里多出来的那条 TXT。

## 0x50 maria：答案在前面

题目只有一句：maria 的密码在某个地方。

当前家目录里没有新文件。0x40 那串摩尔斯的明文就是这关的密码，还是小写 `papaparadise`。这关伤脑筋的地方在于它不给新线索，答案在已经做过的题里。

```bash
ava@venus:~$ su maria
maria@venus:~$ cat mission.txt
################
# MISSION 0x51 #
################
## EN ##
Congrats!
## ES ##
Felicidades :)
```

![Venus Flags 页，50 关全部完成](/content/hmv-venus-ssh-26-50/image-02.webp)

## 下篇小结（26～50）

- 后半段的新面是本机服务：nginx 按方法、User-Agent、自定义头和 Host 给不同响应；MariaDB 里的用户表要和 `/etc/passwd` 求交集；BIND 的 zone 文件里可以藏 TXT。
- 文件题换了层皮，判断顺序没变：先 `file`，再决定是 tar、strings、ISO、EXIF 还是摩尔斯。扩展名、`gunzip` 的失败、ISO 分号，都是 0x09 那种“容器路径和真实类型”的重复。
- 爆破只在候选集很小或平台点名 rockyou 时用：swap 里 18 条、末尾两位小写、一行 md5crypt。SSH 并行用 `-t 4`。
- 0x46 的 doas 和上篇的 sudo 是同一类题，差别是配置文件和开关：doas 读 `/etc/doas.conf`，没有 `sudo -l`。
- 0x50 的密码不在当前目录。做完一章之后，前面解出来的明文也算线索。
