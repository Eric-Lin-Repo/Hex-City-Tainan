#!/bin/sh
# 依固定順序重建 data/ 裡所有產生出來的 JSON；加 --test 會接著跑全部測試與語法檢查
# 用法：bash tools/rebuild_all.sh [--test]
set -e
cd "$(dirname "$0")/.."

step() { # step 名稱 指令…：失敗就印出是哪一步並停下
  name=$1; shift
  printf '%-14s' "$name"
  if out=$("$@" 2>&1); then echo "OK"; else echo "失敗"; echo "$out" | tail -20; exit 1; fi
}

echo "── 重建資料 ──"
step build_city    python3 -I tools/build_city.py tools/raw/twTown1982.topo.json data # 要先跑：其他產生器讀它的輸出
step build_hsr     python3 -I tools/build_hsr.py
step build_terrain python3 -I tools/build_terrain.py
step build_bus     python3 -I tools/build_bus.py
step build_trails  python3 -I tools/build_trails.py
step build_sugar   python3 -I tools/build_sugar.py

[ "$1" = "--test" ] || exit 0

echo "── 測試 ──"
fail=0
for t in build bus sugar trails fields i18n specs food scenery highways; do
  printf '%-14s' "test_$t"
  if out=$(python3 -I tools/test_$t.py 2>&1); then echo "$out" | grep -E '^Ran ' | tr '\n' ' '; echo "OK"
  else echo "失敗"; echo "$out" | tail -20; fail=1; fi
done
printf '%-14s' "worker_bus"
if out=$(node tools/test_worker_bus.mjs 2>&1); then echo "$out" | tail -1; else echo "失敗"; echo "$out" | tail -20; fail=1; fi
printf '%-14s' "node --check"
bad=""
for f in *.js; do node --input-type=module --check < "$f" 2>/dev/null || bad="$bad $f"; done
if [ -z "$bad" ]; then echo "全部 *.js 無語法錯誤"; else echo "語法錯誤：$bad"; fail=1; fi

[ $fail -eq 0 ] && echo "── 全部通過 ──" || { echo "── 有測試失敗 ──"; exit 1; }
