#!/usr/bin/env bash
# 一键启动本方案依赖的两个本地服务（持续运行）
#   - 云端 REST + 消息队列 : http://localhost:8791
#   - 桌面 exe 本地服务     : http://127.0.0.1:8792
# 用法：bash start-services.sh
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "启动云端服务 (REST + FileMQ) ... 127.0.0.1:8791"
cd "$ROOT/cloud"
node server.cjs > "${TMPDIR:-/tmp}/poster-cloud.log" 2>&1 &
CLOUD_PID=$!
echo "  云端 PID: $CLOUD_PID  日志: ${TMPDIR:-/tmp}/poster-cloud.log"

echo "启动桌面 exe 服务 ... 127.0.0.1:8792"
cd "$ROOT/desktop"
./PosterDeliveryDesktop.exe > "${TMPDIR:-/tmp}/poster-desktop.log" 2>&1 &
DESK_PID=$!
echo "  桌面 PID: $DESK_PID  日志: ${TMPDIR:-/tmp}/poster-desktop.log"

# 等待就绪
for i in 1 2 3 4 5 6 7 8 9 10; do
  c1=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://localhost:8791/api/info" || true)
  c2=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://127.0.0.1:8792/api/info" || true)
  if [ "$c1" = "200" ] && [ "$c2" = "200" ]; then break; fi
  sleep 1
done

echo "=================================================="
echo "云端服务:   http://localhost:8791/   (status $c1)"
echo "桌面服务:   http://127.0.0.1:8792/   (status $c2)"
echo
echo "拉取静态资源："
echo "  bash \"$ROOT/curl-assets.sh\" http://localhost:8791 ./downloaded"
echo
echo "常用 curl 示例："
echo "  curl http://localhost:8791/app.html -o app.html"
echo "  curl http://localhost:8791/api/configs"
echo "  curl -X POST http://localhost:8791/api/publish -H 'Content-Type: application/json' -d '{\"topic\":\"poster-config\",\"message\":{\"name\":\"test\"}}'"
echo "  curl http://localhost:8791/api/mq/replay/poster-config"
echo "=================================================="
echo "停止服务：kill $CLOUD_PID $DESK_PID"
