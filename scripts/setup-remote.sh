#!/usr/bin/env bash
# 一次性设置,让 ./deploy.sh 能在远程服务器构建运行。
# 唯一 SSH 触碰服务器的步骤:1) 装 Docker(如缺) 2) 建本地指向服务器的 docker context。
# 之后你只在本地跑 ./deploy.sh。
# 用法: ./scripts/setup-remote.sh user@SERVER_IP[:PORT] [context-name]
set -euo pipefail

TARGET="${1:-}"
CONTEXT="${2:-ai-research-hub}"

if [[ -z "$TARGET" ]]; then
  echo "用法: ./scripts/setup-remote.sh user@SERVER_IP[:PORT] [context-name]"
  exit 1
fi

# ssh 与 docker 对「非默认端口」的写法不同,这里必须拆开:
#   ssh    不认 user@host:port —— 整个 "host:port" 会被当成主机名,直接解析失败,
#          端口只能走 -p。
#   docker context 的 ssh:// URL 认 user@host:port,原样传即可。
# 混用其中任一种写法都会让整个脚本在有自定义 SSH 端口的机器上跑不通。
SSH_TARGET="$TARGET"
SSH_PORT_OPT=()
if [[ "$TARGET" == *:* ]]; then
  SSH_TARGET="${TARGET%:*}"
  SSH_PORT_OPT=(-p "${TARGET##*:}")
fi

echo "→ 检查到 ${TARGET} 的 SSH(需已配好免密 key)..."
if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "${SSH_PORT_OPT[@]}" "$SSH_TARGET" true 2>/dev/null; then
  # 变量后面紧跟中文标点一律加花括号:某些 bash 会把标点的首字节并进变量名,
  # 在 set -u 下报 "unbound variable",反而把真正的失败原因盖掉。
  echo "✗ 无法免密 SSH 到 ${TARGET}。先: ssh-copy-id ${SSH_PORT_OPT[*]} ${SSH_TARGET}"
  echo "  (首次连接还需核对主机指纹,ssh-copy-id 会一并处理)"
  exit 1
fi

echo "→ 确保服务器已装 Docker ..."
ssh "${SSH_PORT_OPT[@]}" "$SSH_TARGET" 'command -v docker >/dev/null 2>&1 || (curl -fsSL https://get.docker.com | sh)'

echo "→ 确保当前用户可免 sudo 运行 docker ..."
ssh "${SSH_PORT_OPT[@]}" "$SSH_TARGET" 'id -nG "$USER" | grep -qw docker || sudo usermod -aG docker "$USER" || true'

echo "→ 建本地 docker context '$CONTEXT' → $TARGET ..."
docker context rm "$CONTEXT" >/dev/null 2>&1 || true
docker context create "$CONTEXT" --docker "host=ssh://$TARGET"

echo "→ 验证远程 daemon 可达 ..."
docker --context "$CONTEXT" version --format '{{.Server.Version}}' >/dev/null

echo
echo "✓ 完成。随时部署: ./deploy.sh"
echo "  (若 docker 需要新组权限,重连一次 SSH: ssh ${SSH_PORT_OPT[*]} ${SSH_TARGET})"
