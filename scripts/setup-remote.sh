#!/usr/bin/env bash
# 一次性设置,让 ./deploy.sh 能在远程服务器构建运行。
# 唯一 SSH 触碰服务器的步骤:1) 装 Docker(如缺) 2) 建本地指向服务器的 docker context。
# 之后你只在本地跑 ./deploy.sh。
# 用法: ./scripts/setup-remote.sh user@SERVER_IP [context-name]
set -euo pipefail

TARGET="${1:-}"
CONTEXT="${2:-ai-research-hub}"

if [[ -z "$TARGET" ]]; then
  echo "用法: ./scripts/setup-remote.sh user@SERVER_IP [context-name]"
  exit 1
fi

echo "→ 检查到 $TARGET 的 SSH(需已配好免密 key)..."
if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$TARGET" true 2>/dev/null; then
  echo "✗ 无法免密 SSH 到 $TARGET。先: ssh-copy-id $TARGET"
  exit 1
fi

echo "→ 确保服务器已装 Docker ..."
ssh "$TARGET" 'command -v docker >/dev/null 2>&1 || (curl -fsSL https://get.docker.com | sh)'

echo "→ 确保当前用户可免 sudo 运行 docker ..."
ssh "$TARGET" 'id -nG "$USER" | grep -qw docker || sudo usermod -aG docker "$USER" || true'

echo "→ 建本地 docker context '$CONTEXT' → $TARGET ..."
docker context rm "$CONTEXT" >/dev/null 2>&1 || true
docker context create "$CONTEXT" --docker "host=ssh://$TARGET"

echo "→ 验证远程 daemon 可达 ..."
docker --context "$CONTEXT" version --format '{{.Server.Version}}' >/dev/null

echo
echo "✓ 完成。随时部署: ./deploy.sh"
echo "  (若 docker 需要新组权限,重连一次 SSH: ssh $TARGET)"
