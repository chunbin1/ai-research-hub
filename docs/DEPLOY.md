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
```bash
./deploy.sh
```
构建 + 启动三容器于远程。完成后访问 `https://your-domain.example`。

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
