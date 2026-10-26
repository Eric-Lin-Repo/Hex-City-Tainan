#!/bin/sh
# 把要上線的檔案複製到 dist/（排除 tools/、README、dist 本身），並加上版本戳避免手機快取舊版
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist
cp index.html *.css *.js dist/
cp -R data vendor dist/
rm -f dist/worker.js # Worker 程式由 wrangler 從專案根目錄讀，不當靜態資產發布
VER=$(date +%Y%m%d%H%M%S)
# index.html 引用的 app.js / css 加 ?v=版本，入口一換新，模組快取就全部失效
sed -i '' -E "s|\./app\.js\"|./app.js?v=$VER\"|; s|\./([a-z-]+)\.css\"|./\1.css?v=$VER\"|g" dist/index.html
# Cloudflare 靜態資產的回應標頭：每次都向伺服器核對（有 ETag，沒變就 304）
cat > dist/_headers <<'H'
/*
  Cache-Control: no-cache
H
echo "dist/ 準備完成：$(du -sh dist | cut -f1)，版本 $VER"
