"""把 data/rail.json 裡零碎的高鐵線段（kind == "hsr"，上下行各一套）串成一條南北連續路線，寫到 data/hsr.json。
用法：python3 -I tools/build_hsr.py（離線，只讀 data/rail.json）
做法：從最北的端點出發，每次接「端點離目前尾端最近、且還沒用過」的線段（必要時反轉），
      接到的線段若與已走過的路幾乎重疊（另一個方向的那條）就丟掉；最後每 0.3 單位加密，標出高鐵台南站的停靠索引。
"""
import json, math, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rail = json.load(open(os.path.join(ROOT, "data", "rail.json")))
segs = [[tuple(p) for p in l["points"]] for l in rail["lines"] if l.get("kind") == "hsr" and len(l["points"]) > 1]
dist = lambda a, b: math.hypot(a[0] - b[0], a[1] - b[1])

start = min((s for s in segs), key=lambda s: min(s[0][1], s[-1][1]))
path = list(start if start[0][1] < start[-1][1] else start[::-1])
used = {id(start)}
# 另一個方向的重複線段：中點離已走路徑很近就視為重複
def near_path(p, tol=0.25):
    return any(dist(p, q) < tol for q in path)
while True:
    tail = path[-1]
    best = None
    for s in segs:
        if id(s) in used: continue
        for cand in (s, s[::-1]):
            d = dist(tail, cand[0])
            if d < 0.6 and (best is None or d < best[0]): best = (d, s, cand)
    if not best: break
    _, s, cand = best
    used.add(id(s))
    mid = cand[len(cand) // 2] if len(cand) > 2 else ((cand[0][0] + cand[-1][0]) / 2, (cand[0][1] + cand[-1][1]) / 2)
    if near_path(mid) and cand[-1][1] <= tail[1] + 0.05: continue  # 往回走的重複線段
    path.extend(cand[1:])

# 加密
dense = [path[0]]
for a, b in zip(path, path[1:]):
    n = max(1, int(dist(a, b) / 0.3))
    for k in range(1, n + 1):
        dense.append((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n))
st = next(s for s in rail["stations"] if s.get("kind") == "hsr")
si = min(range(len(dense)), key=lambda i: dist(dense[i], st["pos"]))
total = sum(dist(a, b) for a, b in zip(dense, dense[1:]))
out = {"note": "台灣高鐵台南段：由 data/rail.json 的高鐵線段串成，兩端出地圖後折返（示意）", "station": st["id"], "points": [[round(x, 3), round(z, 3)] for x, z in dense], "stops": [0, si, len(dense) - 1]}
json.dump(out, open(os.path.join(ROOT, "data", "hsr.json"), "w"), ensure_ascii=False)
print(f"hsr segments {len(segs)} used {len(used)}; path {len(dense)} pts, length {total:.1f} units; z {dense[0][1]:.1f} → {dense[-1][1]:.1f}; station {st['name']} at idx {si} (off {dist(dense[si], st['pos']):.2f})")
gaps = [dist(a, b) for a, b in zip(path, path[1:])]
print("max gap between consecutive raw points", round(max(gaps), 2))
