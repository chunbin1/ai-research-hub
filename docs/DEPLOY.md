# 研报站 部署指南

本地一条命令 `./deploy.sh` 部署到远程服务器,**全程不需手动 SSH 登录服务器**。

原理:本地建一个指向服务器的 Docker context,`deploy.sh` 通过 SSH 把构建和运行都交给
服务器上的 Docker daemon。镜像和数据卷都在远程;密钥只读自本地 `packages/server/.env.prod`,
不写入服务器磁盘、不进镜像、不进 git。

## 架构(生产)

```
浏览器  https://your-domain.example
  └─ Cloudflare(证书 / 强制 HTTPS / CDN / 隐藏源站 IP)
       └─ 服务器 host nginx :443(源站证书,Cloudflare SSL=Full)
            └─ 127.0.0.1:8080  client 容器(nginx,仅回环,公网不可直连)
                 ├─ /     → SPA
                 └─ /api  → server 容器 :3001 → ChromaDB 容器 :8000
```

三容器由 `docker-compose.prod.yml` 编排:`client`(8080→80,绑回环)、`server`(3001)、`chroma`(8000)。

## 一、一次性准备

### 1. 注册 GitHub OAuth App
GitHub → Settings → Developer settings → OAuth Apps → New OAuth App:
- Application name: 任意(如 研报站)
- Homepage URL: `https://your-domain.example`
- Authorization callback URL: `https://your-domain.example/api/auth/github/callback`

创建后拿到 **Client ID**,再 Generate 一个 **Client Secret**。

### 2. 生产环境变量 `packages/server/.env.prod`
与本地 `.env` 分开,已被 gitignore。
```bash
cp packages/server/.env.prod.example packages/server/.env.prod
```
填:
- `ZHIPU_API_KEY` = 你的智谱 key
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` = 上一步拿到的
- `APP_URL` = `https://your-domain.example`(无尾斜杠)
- `COOKIE_SECRET` = `openssl rand -hex 32` 生成
- `AUTH_DISABLED` 保持 `false`(生产严禁开启——开了任何人都是无限管理员)
- `LLM_KEY_SECRET` = `openssl rand -hex 32` 生成(留空则「自带模型」功能关闭,站点其余部分正常运行)

### 3. 服务器 + 域名 + Cloudflare
- 一台可 SSH 的 Linux 服务器(VPS),已配好 SSH 免密 key(`ssh-copy-id user@IP`)。
- 域名解析到服务器(经 Cloudflare 代理,橙色云)。
- 服务器 host nginx 监听 443(源站证书),反代到 `127.0.0.1:8080`。Cloudflare SSL 模式 Full。
  (host nginx / 证书配置属通用运维,不在本仓库范围。)

### 4. 建 docker context
```bash
./scripts/setup-remote.sh user@SERVER_IP
```

## 二、部署

合并到 `master` 会自动触发 GitHub Actions 部署(`.github/workflows/deploy.yml`),
也可以在 Actions 页面手动点「Run workflow」。本地那条路仍然有效,随时可用:

```bash
./deploy.sh
```

两条路做的事完全一样 —— workflow 就是把 `.env.prod` 写出来然后调 `./deploy.sh`。

### CI/CD 一次性配置

在仓库 Settings → Secrets and variables → Actions 建 4 个 secret:

| Secret | 怎么拿 |
|---|---|
| `ENV_PROD` | 把本地 `packages/server/.env.prod` **整个文件内容**贴进去 |
| `DEPLOY_SSH_KEY` | 能登生产机的私钥全文(建议专门生成一把部署专用的) |
| `DEPLOY_SSH_TARGET` | `用户@你的IP:SSH端口` 这种形式 |
| `DEPLOY_KNOWN_HOSTS` | 本地跑 `ssh-keyscan -p <SSH端口> <你的IP>` 的整段输出 |

再建 1 个 variable(不是 secret):

| Variable | 值 |
|---|---|
| `CLIENT_PORT` | 与你本地仓库根 `.env` 里的 `CLIENT_PORT` 一致 |

> ⚠️ `CLIENT_PORT` 这条别省,它是 **variable 不是 secret**。本地靠仓库根的
> `.env` 提供,而那个文件 gitignore 了,runner 上没有 —— 不给值 compose 会退回
> 它自己的默认端口,可能和机器上别的服务撞上。工作流会在动手部署前检查它,
> 缺了直接失败,不会带着错端口跑下去。

**这一步改变了密钥的存放范围**:原本 `.env.prod` 只在你自己的机器上,现在
GitHub 也持有一份。其中 `LLM_KEY_SECRET` 是用户自带 API key 的解密钥匙,
轮换时记得两处一起改。不想让密钥进 GitHub 的话,就别配这些 secret,
继续用本地 `./deploy.sh` —— 工作流缺 secret 会明确报错,不会偷偷跑坏。

### 工作流长什么样

- **CI**(`ci.yml`):每个 PR 和 master 推送跑类型检查 + 全部测试。不需要任何 secret。
  Node 版本钉在 20,与生产镜像的 `node:20-alpine` 一致。
- **部署**(`deploy.yml`),两个 job:
  - `部署` —— 写出 `.env.prod`(校验必需键齐全、禁止 `AUTH_DISABLED=true`)→
    建 docker context → `./deploy.sh` → 轮询 `/api/documents` 直到 200
  - `重建索引` —— 部署成功后自动跑 `import-raw.ts`

  重建是**独立的 job**:它红了不影响上面那个绿的「部署」,含义是「代码已上线、
  索引没跟上」,重跑这个 job 即可(已完成的会跳过)。切块规则和原文都没变时
  它是 0.6 秒空转,一次 embedding 都不会发。

## 三、设管理员
管理员靠手动改 DB(无写 API)。首次用你的 GitHub 账号登录一次(在站点点"GitHub 登录"),
让 users 表里有你这行,然后在服务器上:
```bash
# 进 server 容器改 SQLite(数据在 server_data 卷 → /app/data/research.db)
docker --context ai-research-hub compose -f docker-compose.prod.yml exec server \
  sh -c "apk add --no-cache sqlite >/dev/null 2>&1; sqlite3 /app/data/research.db \
  \"UPDATE users SET is_admin=1, unlimited=1 WHERE username='你的GitHub用户名';\""
```
刷新页面即成管理员(可传删研报、看 trace、无限次)。

## 四、更新
改完代码 `git pull` 后再 `./deploy.sh` 即可(增量重建)。数据在卷里不丢。

### 改了切块规则之后:重建索引

`deploy.sh` 只换代码,**不动索引**。改了 `markdownParser` 的切块行为后,库里的
索引还是旧切块建的,新代码的收益拿不到。

走 GitHub Actions 的话这一步是**自动的** —— `deploy.yml` 的 `重建索引` job
会在部署成功后跑。只在本地 `./deploy.sh` 之后需要手动补一次:

```bash
docker --context ai-research-hub compose -f docker-compose.prod.yml exec server \
  npx tsx scripts/import-raw.ts
```

它按篇把两路索引(BM25 + 向量)推到同一个切块代次:

- **可续传**。已经是最新代次的直接跳过,不重新 embedding。跑到一半挂了,重跑
  一次只补没做完的。
- **失败不伤线上**。新代写完并验证过才翻转,中途失败的那篇完整地停在旧代继续
  服务,不会出现「FTS 是新的、向量是旧的」这种静默返回错块的状态。
- 跑完会自检一次真实检索,零召回会以非零码退出。

不花钱的预演:加 `--no-vectors` 只重建 BM25(那些文档的检索会暂时降级为纯
BM25,状态表如实记录,trace 里看得到)。

### 为什么不能只跑 `reindex`

`pnpm reindex` 只重建 BM25 一路。融合是按 `doc_id#chunk_index` 对齐两路的,
切块一改编号整体平移(实测 CNOOC 47 个编号里只剩 27 个还指向同一段文字),
只重建一路会让同一个键在两边指向不同的文字。

现在这种错位会被代次机制**挡住**:检索侧发现两路代次不一致就拒绝融合、退成
单路,并在 trace 里记 `gen_mismatch`;`reindex` 自己也会警告并以非零码退出。
所以它不会返回错块 —— 但那是降级,不是正常状态。正确的收尾始终是 `import:raw`。

## 密钥怎么到服务器
`deploy.sh` 用本地 docker CLI 通过 SSH 操作远程 daemon;compose 读本地 `.env.prod` 把值作为
环境变量注入远程容器。`.env.prod` 文件本身不离开你的机器、不进镜像、不进 git。

## 更换 LLM_KEY_SECRET

用户自带的 API key 用这把主密钥加密存在 `user_llm_configs` 表里。**本项目不做
密钥轮转迁移** —— 换主密钥后所有旧密文都解不开。

换密钥的完整步骤:

1. 生成新密钥:`openssl rand -hex 32`
2. 改服务器上的 `.env` 里的 `LLM_KEY_SECRET`
3. 清空已有配置(否则用户会一直看到「配置已失效」):
   ```sql
   DELETE FROM user_llm_configs;
   ```
4. 重启服务,并通知用户重新填写自己的 key

反过来,如果只是丢了密钥而库里还有数据,同样执行第 3 步即可 —— 那些密文已经
永久不可恢复。
