#!/usr/bin/env bash
# 通过 curl 拉取本方案的全部静态资源 + 演示 API
# 用法：bash curl-assets.sh [云端地址] [输出目录]
# 例：  bash curl-assets.sh http://localhost:8791 ./downloaded
set -u
BASE="${1:-http://localhost:8791}"
OUT="${2:-./downloaded}"
mkdir -p "$OUT"

echo "目标服务: $BASE"
echo "输出目录: $OUT"
echo "=================================================="

fetch() {
  local path="$1" file="$2"
  local code
  code=$(curl -sS --max-time 20 -o "$OUT/$file" -w "%{http_code}" "$BASE/$path")
  local size
  size=$(wc -c < "$OUT/$file" 2>/dev/null || echo 0)
  if [ "$code" = "200" ]; then
    printf "  [OK]   %-38s %8s B  -> %s\n" "$path" "$size" "$file"
  else
    printf "  [FAIL] %-38s HTTP %s\n" "$path" "$code"
    rm -f "$OUT/$file"
  fi
}

echo "[1] 统一核心与浏览器端"
fetch "app.html"                 "app.html"
fetch "bridge.js"                "bridge.js"
fetch "config-generator.html"    "config-generator.html"
fetch "ARCHITECTURE.md"          "ARCHITECTURE.md"

echo "[2] 配置对象 / 数据"
fetch "poster-config.json"       "poster-config.json"
fetch "dependencies-config.json" "dependencies-config.json"
fetch "poster-source.jpeg"       "poster-source.jpeg"
fetch "step-dependencies.xmind"  "step-dependencies.xmind"

echo "[3] 展示与导航页"
fetch "poster.html"              "poster.html"
fetch "dependencies.html"        "dependencies.html"

echo "[4] 云端端"
fetch "cloud/index.html"         "cloud-index.html"
fetch "cloud/cloud-bridge.js"    "cloud-bridge.js"
fetch "cloud/server.cjs"         "cloud-server.cjs"
fetch "cloud/mq.cjs"             "cloud-mq.cjs"

echo "[5] 桌面端"
fetch "desktop/index.html"       "desktop-index.html"
fetch "desktop/desktop-bridge.js" "desktop-bridge.js"
fetch "desktop/PosterDeliveryDesktop.exe" "PosterDeliveryDesktop.exe"

echo "[6] 手机端（源码与工程，从云端静态目录取）"
fetch "mobile/mobile-bridge.js"  "mobile-bridge.js"
fetch "mobile/sync.js"           "mobile-sync.js"
fetch "mobile/README.md"         "mobile-README.md"
fetch "mobile/capacitor.config.json" "capacitor.config.json"

echo "=================================================="
echo "[7] API 演示（云端服务）"
echo -n "  info:      "; curl -sS --max-time 10 "$BASE/api/info" | head -c 160; echo
echo -n "  configs:   "; curl -sS --max-time 10 "$BASE/api/configs" | head -c 160; echo
echo -n "  mq status: "; curl -sS --max-time 10 "$BASE/api/mq/status" | head -c 160; echo

echo "=================================================="
echo "完成。文件数: $(find "$OUT" -type f | wc -l)"
