#!/usr/bin/env bash
# 本地一条命令部署到远程服务器,全程不需手动 SSH 登录。
# 原理:通过 SSH docker context 在远程 daemon 上构建运行;镜像/数据卷都在远程;
# 密钥只读自本地 packages/server/.env.prod,不写入服务器磁盘、不进镜像、不进 git。
# 用法:
#   ./deploy.sh                      # 用 context "ai-research-hub"
#   DOCKER_CONTEXT=foo ./deploy.sh
# 一次性前置: ./scripts/setup-remote.sh user@SERVER_IP
set -euo pipefail
cd "$(dirname "$0")"

CONTEXT="${DOCKER_CONTEXT:-ai-research-hub}"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE="packages/server/.env.prod"

if ! docker context inspect "$CONTEXT" >/dev/null 2>&1; then
  echo "✗ Docker context '$CONTEXT' 不存在。"
  echo "  先跑一次性设置: ./scripts/setup-remote.sh user@SERVER_IP"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ 缺少 $ENV_FILE(生产配置:智谱 key、GitHub OAuth、APP_URL、COOKIE_SECRET)。"
  echo "  创建: cp packages/server/.env.prod.example $ENV_FILE"
  echo "  然后填 APP_URL=https://你的域名 + GitHub OAuth + COOKIE_SECRET。(见 docs/DEPLOY.md)"
  exit 1
fi

# 显示用端口:与 compose 变量插值同源——shell 环境优先,其次仓库根 .env,最后默认值
PORT_SHOWN="${CLIENT_PORT:-$(grep -E '^CLIENT_PORT=' .env 2>/dev/null | cut -d= -f2- || true)}"
echo "→ 部署到远程 context '$CONTEXT'(端口 ${PORT_SHOWN:-8080})..."
docker --context "$CONTEXT" compose -f "$COMPOSE_FILE" up -d --build --remove-orphans

echo
echo "→ 运行中的容器:"
docker --context "$CONTEXT" compose -f "$COMPOSE_FILE" ps

APP_URL="$(grep -E '^APP_URL=' "$ENV_FILE" | cut -d= -f2-)"
echo
echo "✓ 完成。站点应在: ${APP_URL:-你配置的 APP_URL}"
echo "  首次登录后,把自己设为管理员: 见 docs/DEPLOY.md 的「设管理员」一节。"
