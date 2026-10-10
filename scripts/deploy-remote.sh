#!/usr/bin/env bash
# 一键部署土木雷达：
#   ./scripts/deploy-remote.sh [--proxy] root@服务器IP [--translate]
#
# 两种模式：
#   默认        独立服务器（香港/海外），自带 Caddy 占用 80/443 自动签 HTTPS 证书
#   --proxy     官网服务器上与现有 nginx/宝塔共用机器：不占 80/443，radar 只监听
#               127.0.0.1:8791，由外层反代把你的域名转发过来
#
# 前置：本机已配好到服务器的 SSH；--proxy 模式下外层反代站点已建好并指向
# http://127.0.0.1:8791；DNS 已把域名解析到该服务器公网 IP。
# 配置：把 .env.production.example 复制为 .env.production 并填好占位值。
set -euo pipefail

TARGET= PROXY=0 TRANSLATE=0
for arg in "$@"; do
  case "$arg" in
    --proxy) PROXY=1 ;;
    --translate) TRANSLATE=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) TARGET=$arg ;;
  esac
done
if [ -z "$TARGET" ]; then echo "用法: ./scripts/deploy-remote.sh [--proxy] root@服务器IP [--translate]" >&2; exit 1; fi

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE="$ROOT_DIR/.env.production"
COMPOSE=(docker compose)
if [ "$PROXY" -eq 1 ]; then COMPOSE=(docker compose -f docker-compose.behind-proxy.yml); fi
if [ "$TRANSLATE" -eq 1 ]; then COMPOSE+=(--profile translate); fi
REMOTE_COMPOSE="${COMPOSE[*]}"

if [ ! -f "$ENV_FILE" ]; then
  echo "缺少 .env.production（从 .env.production.example 复制并填好后再试）" >&2
  exit 1
fi

# AUTH_SECRET 留空时生成一次并写回，之后部署复用同一个值（换值会让所有登录会话失效）
if ! grep -q '^AUTH_SECRET=..' "$ENV_FILE" ]; then
  SECRET=$(openssl rand -hex 24)
  sed -i.bak "s|^AUTH_SECRET=.*|AUTH_SECRET=$SECRET|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  echo "已生成 AUTH_SECRET 并写回 .env.production"
fi

if grep -q '<' "$ENV_FILE"; then
  echo ".env.production 仍有 <> 占位未填（邮箱 / SMTP 密码等）" >&2
  exit 1
fi

echo "==> 同步代码到 $TARGET:/opt/radar"
ssh "$TARGET" 'mkdir -p /opt/radar'
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude .runtime --exclude dist \
  --exclude .env --exclude '.env.production*' \
  "$ROOT_DIR"/ "$TARGET":/opt/radar/

echo "==> 上传生产配置"
rsync -az "$ENV_FILE" "$TARGET":/opt/radar/.env

echo "==> 安装 Docker（如缺失）并构建启动（$REMOTE_COMPOSE up）"
ssh "$TARGET" "cd /opt/radar && \
  if ! command -v docker >/dev/null 2>&1; then \
    if command -v dnf >/dev/null 2>&1; then \
      dnf remove -y podman-docker >/dev/null 2>&1; \
      dnf config-manager --add-repo=https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo >/dev/null 2>&1; \
      sed -i 's#download.docker.com#mirrors.aliyun.com/docker-ce#g' /etc/yum.repos.d/docker-ce.repo; \
      dnf install -y docker-ce docker-ce-cli containerd.io; \
    else \
      curl -fsSL https://get.docker.com | sh -s -- --mirror Aliyun; \
    fi; \
    systemctl enable --now docker; \
  fi; \
  $REMOTE_COMPOSE up -d --build && sleep 3 && $REMOTE_COMPOSE ps"

echo ""
if [ "$PROXY" -eq 1 ]; then
  echo "部署完成（反代模式）。请核对："
  echo "  1) DNS：你的域名 A 记录 -> 服务器公网 IP"
  echo "  2) 外层反代站点已绑定你的域名、签好证书并转发到 http://127.0.0.1:8791"
  echo "  3) 验证：ssh $TARGET curl -s -H 'Host: 你的域名' http://127.0.0.1:8791/api/health"
  echo "  4) 登录后在「设置」页重新填一次大模型 API Key（密钥只存服务器数据库，不随部署迁移）"
else
  echo "部署完成。请核对："
  echo "  1) 防火墙/云安全组放行 80/443；DNS A 记录 你的域名 -> 服务器公网 IP"
  echo "  2) 首次访问 https://你的域名（Caddy 自动申请证书，约 1-2 分钟）"
  echo "  3) 登录后在「设置」页重新填一次大模型 API Key（密钥只存服务器数据库，不随部署迁移）"
fi
echo "  查看日志：ssh $TARGET 'cd /opt/radar && $REMOTE_COMPOSE logs -f radar'"
