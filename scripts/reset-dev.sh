#!/usr/bin/env bash
# reset-dev.sh — 清除 IntentOS dev 环境数据并重启
# 用法: ./scripts/reset-dev.sh [--all] [--no-restart]
#   --all         同时删除生成的 SkillApp（默认保留）
#   --no-restart  只清数据，不启动 dev server

set -euo pipefail

DATA_DIR="$HOME/Library/Application Support/IntentOS"
DELETE_APPS=false
RESTART=true

for arg in "$@"; do
  case $arg in
    --all)        DELETE_APPS=true ;;
    --no-restart) RESTART=false ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

echo "==> IntentOS Dev 环境重置"
echo "    userData: $DATA_DIR"

# 提示环境变量会跳过 onboarding
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo ""
  echo "    ⚠️  检测到环境变量 ANTHROPIC_API_KEY 已设置"
  echo "    删除文件后 onboarding 仍会被跳过（代码将环境变量视为已配置）"
  echo "    如需触发引导页，请先 unset ANTHROPIC_API_KEY"
fi
echo ""

if [ ! -d "$DATA_DIR" ]; then
  echo "    ℹ️  userData 目录不存在，无需清除"
else
  # 数据库
  echo "    删除数据库..."
  rm -f "$DATA_DIR"/intentos-skills.db \
        "$DATA_DIR"/intentos-skills.db-wal \
        "$DATA_DIR"/intentos-skills.db-shm \
        "$DATA_DIR"/intentos-apps.db \
        "$DATA_DIR"/intentos-apps.db-wal \
        "$DATA_DIR"/intentos-apps.db-shm

  # API Key 文件（所有 Provider）
  echo "    删除 API Key 文件..."
  rm -f "$DATA_DIR"/intentos-api-key.enc \
        "$DATA_DIR"/intentos-api-key.b64 \
        "$DATA_DIR"/intentos-apikey-*.enc \
        "$DATA_DIR"/intentos-apikey-*.b64

  # 自定义 Provider 配置
  echo "    删除自定义 Provider 配置..."
  rm -f "$DATA_DIR/custom-provider-config.json"

  # Onboarding 标记（下次启动重走引导）
  echo "    删除 onboarding 标记..."
  rm -f "$DATA_DIR/onboarding-complete"

  # Socket 文件
  echo "    删除 socket 文件..."
  rm -rf "$DATA_DIR/sockets/"

  # 生成的 SkillApp（可选）
  if [ "$DELETE_APPS" = true ]; then
    echo "    删除生成的 SkillApp (apps/)..."
    rm -rf "$DATA_DIR/apps/"
  else
    APP_COUNT=$(find "$DATA_DIR/apps/" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
    echo "    保留 apps/（共 ${APP_COUNT} 个，用 --all 可一并删除）"
  fi
fi

echo ""
echo "    ✅ 数据清除完成"

if [ "$RESTART" = true ]; then
  echo ""
  echo "==> 启动 dev server..."
  cd "$(dirname "$0")/.."
  npm run dev
fi
