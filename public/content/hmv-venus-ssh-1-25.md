# HMV Venus SSH 闯关复盘（上）：第 1～25 关

> [HackMyVM | Venus](https://hackmyvm.eu/venus/) 是公开的 Linux 基础闯关平台，本文记录我在这个授权环境里的做题过程，操作只发生在平台分配的靶机内。

Venus 是 HMV 的第一章，题目本身不难，正好借它把 Linux 基础命令的参数过一遍。所以这篇不是纯 wp：每关记题目要求、考点、命令和现场解释，卡住的地方保留弯路。上篇覆盖第 1～25 关，0x26 之后进入 HTTP、MySQL 和权限工具，记在[下篇](/articles/read?slug=hmv-venus-ssh-26-50)。

![HMV Venus 平台页面](/content/hmv-venus-ssh-1-25/image-01.webp)

## 连接方式与题目结构

Windows 自带的 OpenSSH 就能连，不用先上 kali：

```powershell
PS C:\Users\zxmk7\Desktop> ssh -p 5000 hacker@venus.hackmyvm.eu
[== HMVLabs Chapter 1: Venus ==]
+===========================+
|        Respect &          |
|        Have fun!          |
+===========================+
hacker@venus.hackmyvm.eu's password:
Linux venus 6.12.73+deb13-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.12.73-1 (2026-02-17) x86_64
```

![首次 SSH 登录 Venus 成功](/content/hmv-venus-ssh-1-25/image-02.webp)

进去之后的结构是固定的：

- 每个用户的家目录在 `/pwned/<用户名>` 下，里面有两份固定文件：`mission.txt`（题目描述，英文加西语）和 `flagz.txt`（过关 flag，形如 `8===...===D~~`）。
- 每一关要找的是**下一个用户**的密码，拿到后 `su <下一关用户>` 切过去，在新家目录里读下一份 mission。整章就是一条用户链：

```text
hacker → sophia → angela → emma → mia → camila → luna → eleanor → victoria
      → isla → violet → lucy → elena → alice → anna → natalia → eva
      → clara → frida → eliza → iris → eloise → lucia → isabel → freya → alexa
```

- `su` 切换后仍在当前目录，要自己 `cd ../<新用户>` 进新家目录；平台对外端口是 5000，靶机内部本机 `ssh 127.0.0.1` 走默认 22，和 `su` 等效。

下面按闯关顺序记。

## 0x01 sophia：隐藏文件与 ls -a

题目：sophia 把密码存在当前文件夹的一个隐藏文件里。考点是 `ls` 的参数：`-a` = all（含隐藏文件），`-l` = long listing format。

```bash
hacker@venus:~$ ls -la
-rw-r----- 1 root   hacker   16 May  4 07:39 .myhiddenpazz
hacker@venus:~$ cat .myhiddenpazz
Y1o645M3mR84ejc
hacker@venus:~$ su sophia
```

以 `.` 开头的文件默认不显示，`-a` 才看得到。这里藏密码的是 `.myhiddenpazz`。

### 插曲：顺手读了三份启动脚本

与解题无关，纯复习。家目录里的 `.profile`、`.bashrc`、`.bash_logout` 是 Debian 的默认 shell 初始化脚本，我把每段都注释了一遍，有用的结论：

- `.profile`：登录 shell 加载。负责把 `.bashrc` source 进来，并把 `~/bin`、`~/.local/bin` 加进 `PATH`（所以这两个目录里的程序可以直接敲名字运行）。
- `.bashrc`：非登录 shell 的配置。开头的 `case $- in *i*) ;; *) return;; esac` 判断当前是不是交互式 shell——`echo $-` 输出 `himBHs`，其中的 `i` 就代表 interactive。后面是历史记录控制（`HISTCONTROL`、`histappend`）、`PS1` 提示符（`\u@\h:\w\$`，root 显示 `#`）、`dircolors` 别名和 bash-completion 这些默认项。
- `.bash_logout`：登录 shell 退出时执行，`SHLVL=1`（最外层 shell）时调用 `clear_console -q` 清屏。

## 0x02 angela：find 全盘找文件

题目：angela 的密码在一个叫 `whereismypazz.txt` 的文件里，但她忘了放哪。

```bash
sophia@venus:~$ find / -name "whereismypazz.txt" 2>/dev/null
/var/tmp/whereismypazz.txt
/usr/share/whereismypazz.txt
sophia@venus:~$ cat /var/tmp/whereismypazz.txt

sophia@venus:~$ cat /usr/share/whereismypazz.txt
oh5p9gAABugHBje
sophia@venus:~$ ssh angela@127.0.0.1
```

从根目录开始 find，`2>/dev/null` 把无权限目录的报错丢掉，保证输出干净。同名文件有两份，`/var/tmp` 下那份是空的，真的在 `/usr/share`——**空结果也是一种信息，两个都得看**。

## 0x03 emma：取指定行

题目：emma 的密码在 `findme.txt` 第 4069 行（文件共 4618 行）。这一关方法挺多：

```bash
angela@venus:~$ wc -l findme.txt
4618 findme.txt
angela@venus:~$ sed -n '4069p' findme.txt
fIvltaGaq0OUH8O
angela@venus:~$ awk 'NR==4069' findme.txt
fIvltaGaq0OUH8O
angela@venus:~$ head -n 4069 findme.txt | tail -n 1
fIvltaGaq0OUH8O
```

`wc -l` 的 `-l` 统计行数；`sed -n 'Np'` 里 `-n` 关掉默认的全部打印，`p` 是 print；awk 的 `NR` 就是当前行号；管道法先取前 4069 行再打最后一行。选顺手的就行。

## 0x04 mia：文件名叫 `-`

题目：mia 把密码留在了名为 `-` 的文件里。

直接 `cat -` 不会读这个文件——`-` 对 cat 来说是"从标准输入读"，命令会挂住等键盘输入：

```bash
emma@venus:~$ cat -
hello momo
^C
emma@venus:~$ cat ./-
iKXIYg0pyEH2Hos
```

解法是把路径写明确：`cat ./-`。顺带记两个相关约定：`--` 表示选项到此结束，后面的内容都按普通参数或文件名处理；程序启动时的三个标准流是 0=stdin、1=stdout、2=stderr（前面 `2>/dev/null` 丢的就是 2）。

## 0x05 camila：find 找目录

题目：密码在名为 `hereiam` 的文件夹里。和 0x02 差不多，加 `-type d` 限定类型为目录：

```bash
mia@venus:~$ find / -type d -name "hereiam" 2>/dev/null
/opt/hereiam
mia@venus:~$ cat /opt/hereiam/.here
F67aDmCAAgOOaOc
```

里面的文件又是隐藏的（`.here`），0x01 的 `ls -a` 再用一次。

## 0x06 luna：muack 里找可读文件

题目：密码在 `muack` 文件夹内的某个文件里。muack 下面 551 个目录项，看着吓人，实际普通文件只有一个：

```bash
camila@venus:~$ find muack -type f
muack/111/111/muack
camila@venus:~$ find muack -type f -readable
muack/111/111/muack
camila@venus:~$ cat muack/111/111/muack
j3vkuoKQwvbhkMc
```

`-readable` 过滤当前用户可读的文件。候选只有一个，直接读。

## 0x07 eleanor：按大小找

题目：密码在一个占 6969 字节的文件里。

```bash
luna@venus:~$ find / -type f -size 6969c 2>/dev/null
/usr/share/moon.txt
luna@venus:~$ cat /usr/share/moon.txt
UNDchvln6Bmtu7b
```

`-size` 后面的 `c` 表示字节；不加单位默认按 512B 块算，这里必须带 `c`。

## 0x08 victoria：按属主找

题目：密码在一个属主是 violin 的文件里。

```bash
eleanor@venus:~$ find / -type f -user violin 2>/dev/null
/usr/local/games/yo
eleanor@venus:~$ cat /usr/local/games/yo
pz8OqvJBFxH0cSj
```

0x02 到 0x08 基本是 find 的筛选参数排列组合：`-name`、`-type`、`-size`、`-user`、`-readable`，按题意组合就行。

## 0x09 isla：zip 的两种打开方式

题目：isla 的密码在一个 zip 文件里。

先用 `file` 确认类型（扩展名不是文件类型的依据），`unzip -l` 不解压先看内部列表：

```bash
victoria@venus:~$ file passw0rd.zip
passw0rd.zip: Zip archive data, made by v3.0 UNIX, ... uncompressed size 16, method=store
victoria@venus:~$ unzip -l passw0rd.zip
      16  2026-05-04 07:39   pwned/victoria/passw0rd.txt
victoria@venus:~$ unzip passw0rd.zip
checkdir error:  cannot create pwned
                 Permission denied
```

这里踩了一下：压缩包里保存的路径是 `pwned/victoria/passw0rd.txt`，而当前目录就是 `/pwned/victoria`（owner 是 root），unzip 想在当前目录重建 `pwned/` 这一层，没权限。两条路都能走：

```bash
victoria@venus:~$ unzip -p passw0rd.zip pwned/victoria/passw0rd.txt
D3XTob0FUImsoBb
victoria@venus:~$ mkdir /tmp/victoria
victoria@venus:~$ unzip passw0rd.zip -d /tmp/victoria
```

`-p` 直接把内容打到 stdout，不解压；`-d` 指定解压到可写目录。

## 0x10 violet：行首锚点

题目：密码在以 `a9HFX` 开头的行里，这 5 个字符不算密码。

```bash
isla@venus:~$ grep '^a9HFX' passy
a9HFXWKINVzNQLKLDVAc
isla@venus:~$ sed -n 's/^a9HFX//p' passy
WKINVzNQLKLDVAc
```

`^` 锚定行首。sed 的 `s/旧/新/` 把行首的 `a9HFX` 替换成空，`-n ... p` 只打印发生替换的行，剩下的正好是密码。

## 0x11 lucy：行尾锚点

同上，行尾锚是 `$`：

```bash
violet@venus:~$ grep '0JuAZ$' end
OCmMUjebG53giud0JuAZ
violet@venus:~$ sed -n 's/0JuAZ$//p' end
OCmMUjebG53giud
```

## 0x12 elena：捕获组

题目：密码在字符 `fu` 和 `ck` 之间。

```bash
lucy@venus:~$ grep -E 'fu(.*)ck' file.yo
fu4xZ5lIKYmfPLg9tck
lucy@venus:~$ sed -nE 's/.*fu(.*)ck.*/\1/p' file.yo
4xZ5lIKYmfPLg9t
```

grep 默认用基本正则（BRE），要让 `()` 按扩展正则解释需要 `-E`。sed 那句把整行替换成第一个捕获组 `\1`，留下的就是 `fu` 和 `ck` 中间的密码。

## 0x13 alice：环境变量

题目：alice 的密码在环境变量里。`env` 挨个翻一遍就能看到：

```bash
elena@venus:~$ env
（已省略 LS_COLORS 等无关行）
PASS=Cgecy2MY2MWbaqt
elena@venus:~$ echo "$PASS"
Cgecy2MY2MWbaqt
```

顺带从输出里认了几个变量：`PWD` 当前目录、`HOME` 家目录、`SHLVL` shell 嵌套层数、`OLDPWD` 上一个目录、`SSH_TTY` 当前终端设备。

## 0x14 anna：passwd 的注释字段（弯路关）

题目：管理员把 anna 的密码作为注释（comment）留在 passwd 文件里。

家目录没有 passwd，先全盘找。第一反应是看 anna 自己那一行：

```bash
alice@venus:~$ grep '^anna:' /etc/passwd
anna:x:1015:1015::/pwned/anna:/bin/bash
```

第 5 个字段（GECOS，注释字段）是空的，卡住了。问了 AI 才反应过来：**题目没说注释留在 anna 自己那一行**。把所有第 5 字段非空的行都列出来：

```bash
alice@venus:~$ awk -F: '$5 != "" {print $1, $5}' /etc/passwd
（系统账号一批，最后）
alice w8NvY27qkpdePox
alice@venus:~$ grep '^alice:' /etc/passwd
alice:x:1014:1014:w8NvY27qkpdePox:/pwned/alice:/bin/bash
```

密码在 alice 行的注释位上，拿它 `su anna` 通过。搞半天发现 `grep alice` 就好了 🤣 这关的教训：`-F:` 按冒号分列之后，"在 passwd 里"和"在 anna 那一行"是两回事，字段级信息要按字段找。

## 0x15 natalia：sudo

题目：Maybe sudo can help you to be natalia。

```bash
anna@venus:~$ sudo -l
User anna may run the following commands on venus:
    (natalia) NOPASSWD: /bin/bash
anna@venus:~$ sudo -u natalia /bin/bash
natalia@venus:/pwned/anna$ id;whoami
uid=1016(natalia) gid=1016(natalia) groups=1016(natalia)
natalia
```

`sudo -l` 先看自己能以谁的身份跑什么。`(natalia) NOPASSWD: /bin/bash` 意思是可以免密以 natalia 身份运行 bash，直接给自己一个 natalia 的 shell。

## 0x16 eva：base64

题目：eva 的密码被编码在 `base64.txt` 里。

```bash
natalia@venus:~$ cat base64.txt
dXBzQ0EzVUZ1MTBmREFPCg==
natalia@venus:~$ base64 -d base64.txt
upsCA3UFu10fDAO
```

结尾的 `=` 是 base64 padding 的特征，看到就可以直接试 `base64 -d`。

## 0x17 clara：早于 Unix 纪元的 mtime

题目：密码在一个 1968 年 5 月 1 日修改过的文件里。

1968 早于 Unix 纪元（1970-01-01），正常系统里不会有这么老的修改时间，是人为设置的。两个思路：

```bash
eva@venus:~$ find / -type f ! -newermt "1970-01-01" 2>/dev/null
/proc/163469/task/163469/fdinfo/6
/usr/lib/cmdo
eva@venus:~$ find / -type f -mtime +18000 2>/dev/null
/usr/lib/cmdo
eva@venus:~$ cat /usr/lib/cmdo
39YziWp5gSvgQN9
```

`! -newermt "1970-01-01"` 找"不比 1970 新"的文件，结果里混着 `/proc` 的干扰项——它是虚拟文件系统，里面的 fdinfo 时间戳不可靠；`-mtime +18000`（18000 天，约 50 年前）更干净，直接锁定 `/usr/lib/cmdo`。

## 0x18 frida：rockyou 爆破 zip

题目：frida 的密码在一个带密码的 zip 里，rockyou.txt 能帮上忙。

靶机上没有爆破工具，先用 scp 把压缩包拉到 kali（scp 语法和 cp 几乎一样，指定端口用大写 `-P`）：

```bash
┌──(kali㉿kali)-[~/桌面/靶机/HMVLabs]
└─$ scp -P 5000 clara@venus.hackmyvm.eu:/pwned/clara/protected.zip .
└─$ zip2john protected.zip > protected.zip.hash
└─$ john --wordlist=/usr/share/wordlists/rockyou.txt protected.zip.hash
pass123          (protected.zip/pwned/clara/protected.txt)
1g 0:00:00:00 DONE (2026-09-05 07:39) 100.0g/s 819200p/s ...
└─$ john --show --format=PKZIP protected.zip.hash
protected.zip/pwned/clara/protected.txt:pass123:...
1 password hash cracked, 0 left
└─$ fcrackzip -D -p /usr/share/wordlists/rockyou.txt -u protected.zip
PASSWORD FOUND!!!!: pw == pass123
└─$ unzip protected.zip
└─$ cat pwned/clara/protected.txt
Ed4ErEUJEaMcXli
```

两条等价路线：zip2john 把压缩包转成哈希交给 John 跑（`--show` 可以复查已破解的结果）；或者 fcrackzip 直接对着 zip 文件字典跑。"压缩包转哈希"是个通用思路，各格式的对应关系：

| 压缩类型 | 提取哈希工具 | John 格式 | Hashcat 模式 |
| :--- | :--- | :--- | :--- |
| ZIP (传统) | `zip2john` | `PKZIP` | `17220` |
| RAR | `rar2john` | `RAR5` | `13000` |
| 7z | `7z2john` | `7z` | `11600` |

## 0x19 eliza：uniq 找重复

题目：eliza 的密码是 `repeated.txt` 里唯一重复的字符串。

```bash
frida@venus:~$ uniq -d repeated.txt
Fg6b6aoksceQqB9
```

uniq 的常用参数：

| 参数 | 全称 | 作用 |
| :--- | :--- | :--- |
| `-d` | `--repeated` | 只显示有相邻重复的行 |
| `-u` | `--unique` | 只显示没有相邻重复的行 |
| `-c` | `--count` | 每行前加出现次数 |
| `-i` | `--ignore-case` | 忽略大小写 |

注意 uniq 只合并**相邻**重复，题目里特意标了 unsorted，这份文件的重复恰好挨着，`-d` 一次就中。

## 0x20 iris：私钥登录

题目：iris 把她的 key 留给了我。

家目录里翻出 `.iris_key`（OPENSSH PRIVATE KEY），直接指定私钥登录：

```bash
eliza@venus:~$ ssh -i .iris_key iris@127.0.0.1
Could not create directory '/pwned/eliza/.ssh' (Permission denied).
[== HMVLabs Chapter 1: Venus ==]
iris@venus:~$
```

known_hosts 写不进去只是个警告，不影响登录。这一关的凭据不是字符串而是一把钥匙，翻家目录时 `.ssh/*`、`*_key` 这类名字值得单独留意。

## 0x21 eloise：base64 藏图

题目：eloise 用比较特别的方式保存了密码。

`eloise` 文件以 `=` 结尾，先按 base64 试；解码出来还是个二进制，用 `file` 探一下管道里的数据：

```bash
iris@venus:~$ base64 -d eloise | file -
/dev/stdin: JPEG image data, ... baseline, precision 8, 394x102
iris@venus:~$ base64 -d eloise > /tmp/eloise.jpg
┌──(kali㉿kali)-[~/桌面/靶机/HMVLabs]
└─$ scp -P 5000 iris@venus.hackmyvm.eu:/tmp/eloise.jpg .
```

解码后是张 394x102 的图片，密码写在图里：`yOUJlV0SHOnbSPm`。

![base64 解码出的 eloise.jpg，密码写在图中](/content/hmv-venus-ssh-1-25/image-03.webp)

## 0x22 lucia：xxd 反转储

题目：lucia 创造性地保存了密码。`hi` 文件的内容是 xxd 风格的十六进制转储，`-r`（reverse）可以直接还原：

![xxd 转储与还原的现场截图](/content/hmv-venus-ssh-1-25/image-04.webp)

```bash
eloise@venus:~$ cat hi
00000000: 7576 4d77 4644 5172 5157 504d 6547 500a
eloise@venus:~$ xxd -r hi
uvMwFDQrQWPMeGP
```

xxd 常用的几个参数：`-b` 二进制转储、`-g` 分组、`-l` 限长、`-ps` 纯十六进制、`-u` 大写、`-r` 反向还原。生成和还原是一对。

## 0x23 isabel：无读权限目录的枚举

题目：isabel 把密码放在 `/etc/xdg` 下的一个文件里，忘了名字，但她的 `dict.txt`（299 行）可以帮忙。

先试常规路子，全被权限挡住：

```bash
lucia@venus:~$ ls /etc/xdg/
ls: cannot open directory '/etc/xdg/': Permission denied
lucia@venus:~$ ls -ld /etc/xdg
drw-rw---x 3 root root 4096 May  4 07:40 /etc/xdg
lucia@venus:~$ find /etc/xdg -maxdepth 1 -type f -printf '%f\n' | grep -Fxf dict.txt
（空结果）
```

`ls -ld` 给出原因：其他用户对这个目录只有 `--x`——**穿越权限**，能按已知名字访问里面的文件，但列不出目录内容。find 依赖读目录，同样失败，所以那条 find 接 grep 的管道静默返回空。

既然字典里有 299 个候选名，就按名字逐个探测——`[ -f ]` 文件测试不需要读目录权限：

```bash
lucia@venus:~$ while IFS= read -r name; do
> if [ -f "/etc/xdg/$name" ]; then
>     echo "FOUND: /etc/xdg/$name"
> fi
> done < dict.txt
FOUND: /etc/xdg/readme
lucia@venus:~$ cat /etc/xdg/readme
H5ol8Z2mrRsorC0
```

这一关的关键是分清目录权限的分层：`r`（列目录）、`x`（穿越、按名访问）、`w`（增删条目）。有 `x` 没 `r` 时，按字典猜名字是唯一解。

## 0x24 freya：uniq -u

题目：freya 的密码是 `different.txt` 里唯一不重复的字符串。0x19 的反面，直接 `-u`：

```bash
isabel@venus:~$ uniq -u different.txt
EEDyYFDwYsmYawj
```

## 0x25 alexa：每分钟一删的文件

题目：alexa 每分钟把密码写进 `/free` 下的一个 .txt，随后删掉。

先看一眼目录：

```bash
freya@venus:~$ ls -ld /free
drwxrwxr-x 1 executor executor 4096 Sep  9 11:16 /free
freya@venus:~$ ls -la /free
total 8
```

目录时间是 Sep 9，比系统里其他文件（May 4）新，说明确实有写入在反复发生。思路像竞争条件，但不用上 inotify，一个死循环每秒读一次就够：

```bash
freya@venus:~$ while true
do
    cat /free/*.txt 2>/dev/null
    sleep 1
done
mxq9O3MSxxX9Q3S
^C
```

转了几圈就逮到了。文件只存在一秒，`2>/dev/null` 保证空转时不刷报错。

## 上篇小结（1～25）

- 25 关用到的命令面很小：ls、find、grep、sed、awk、uniq、xxd、base64、unzip、ssh/scp、sudo，难度全在参数组合和边界条件上。
- 真正卡人的是三类边界：文件名和路径的特殊性（`-` 文件、zip 内路径重建、无读权限目录）；凭据不在"它该在的位置"（GECOS 注释字段、环境变量、别人的私钥、定时生成又删除的文件）；同名或相近数据源要交叉确认（0x02 的空文件）。
- 顺序上养成的习惯：先 `ls -ld` 看权限位、`file` 看真实类型，再决定是直接读、解压，还是按字典枚举。
- 0x26 之后题目开始碰 HTTP、MySQL、hydra 和 doas，记在[下篇](/articles/read?slug=hmv-venus-ssh-26-50)。
