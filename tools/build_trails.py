"""把 tools/raw/osm_trails.json（山海圳綠道與自行車道的 OSM relation）轉成 data/trails.json：
用 data/city.json 的投影把成員 way 串成連續折線，只留落在任一區 polygon 內的點，簡化後再加密。
離線可重跑：python3 -I tools/build_trails.py"""
import json, math, os
here = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(here)
city = json.load(open(os.path.join(ROOT, "data", "city.json"), encoding="utf-8"))
raw = json.load(open(os.path.join(here, "raw", "osm_trails.json"), encoding="utf-8"))
P = city["projection"]; K = P["k"]
polys = [d["polygon"] for d in city["districts"]]
EPS, STEP = 0.04, 0.3  # Douglas–Peucker 容差、加密間距（世界單位）

# 要輸出的路線：id、OSM 名稱比對字串、種類、顏色、一句介紹
GREEN, TEAL = "#3a8f5a", "#2a8c8a"
TRAILS = [
    ("shanhaijun", "山海圳", "山海圳國家綠道", "greenway", GREEN, "從台江內海沿嘉南大圳、曾文溪一路到玉山的 177 公里國家級綠道，台南段經安南、善化、官田、六甲、楠西等區。"),
    ("batian", "八田自行車道", "八田自行車道", "cycleway", TEAL, "以烏山頭水庫與八田與一紀念園區為核心，沿嘉南大圳與官田田野騎行的環狀路線。"),
    ("siraya", "西拉雅自行車道", "西拉雅自行車道", "cycleway", TEAL, "串連西拉雅國家風景區的長程路線，從官田、大內一帶沿曾文溪谷到玉井、楠西的淺山丘陵。"),
    ("taijiang", "台江大道", "台江大道", "cycleway", TEAL, "安南區台江國家公園內的濱海自行車道，沿魚塭、紅樹林與海堤而行，可遠眺四草大橋與台江內海。"),
    ("goldcoast", "黃金海岸自行車道", "黃金海岸自行車道", "cycleway", TEAL, "南區喜樹、灣裡一帶沿台灣海峽的海岸線路線，以黃金海岸的夕陽與防風林聞名。"),
    ("beimen", "北門自行車道", "北門自行車道", "cycleway", TEAL, "北門區井仔腳瓦盤鹽田、北門遊客中心到南鯤鯓一帶的濱海鹽田路線。"),
    ("jingliao", "新營菁寮自行車道", "新營菁寮自行車道", "cycleway", TEAL, "從新營市區穿過嘉南平原的稻田，騎到後壁菁寮老街（紀錄片《無米樂》的故鄉）的農村路線。"),
]

proj = lambda p: ((p["lon"] - P["lon_c"]) * P["km_x"] * K, -(p["lat"] - P["lat_c"]) * P["km_z"] * K)
key = lambda p: (round(p["lat"], 7), round(p["lon"], 7))

def chain(ways):
    """把成員 way 串成盡量少的連續折線：從一條開始，往兩端找端點相接的 way（必要時反轉）。"""
    pool = [list(w) for w in ways if len(w) >= 2]
    out = []
    while pool:
        cur = pool.pop(0)
        grown = True
        while grown:
            grown = False
            for i, w in enumerate(pool):
                if key(w[0]) == key(cur[-1]): cur += w[1:]
                elif key(w[-1]) == key(cur[-1]): cur += w[::-1][1:]
                elif key(w[-1]) == key(cur[0]): cur = w[:-1] + cur
                elif key(w[0]) == key(cur[0]): cur = w[::-1][:-1] + cur
                else: continue
                pool.pop(i); grown = True; break
        out.append(cur)
    return out

def inside(poly, x, z):
    c = False; n = len(poly)
    for i in range(n):
        x0, z0 = poly[i]; x1, z1 = poly[(i + 1) % n]
        if (z0 > z) != (z1 > z) and x < (x1 - x0) * (z - z0) / (z1 - z0) + x0: c = not c
    return c
on_land = lambda x, z: any(inside(poly, x, z) for poly in polys)

def clip(pts):
    """只留落在任一區 polygon 內的點；中間被海或鄰縣切斷的就拆成多段。"""
    segs, cur = [], []
    for x, z in pts:
        if on_land(x, z): cur.append((x, z))
        elif cur: segs.append(cur); cur = []
    if cur: segs.append(cur)
    return segs

def dp(points, eps):
    if len(points) < 3: return points
    a, b = points[0], points[-1]
    def dist(p):
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dz) or 1
        return abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dz) / L
    imax, dmax = max(((i, dist(p)) for i, p in enumerate(points[1:-1], 1)), key=lambda x: x[1])
    if dmax > eps: return dp(points[:imax + 1], eps)[:-1] + dp(points[imax:], eps)
    return [a, b]

def simplify(points, eps):
    """封閉環線（八田自行車道）首尾同點，DP 會整條壓扁：先從中間切成兩半各自簡化再接回。"""
    if len(points) > 3 and math.hypot(points[0][0] - points[-1][0], points[0][1] - points[-1][1]) < eps:
        m = len(points) // 2
        return dp(points[:m + 1], eps)[:-1] + dp(points[m:], eps)
    return dp(points, eps)

def densify(points, step):
    out = [points[0]]
    for a, b in zip(points, points[1:]):
        n = max(1, math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / step))
        out += [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(1, n + 1)]
    return out

length = lambda pts: sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))

rels = {e["tags"].get("name", ""): e for e in raw["elements"] if e.get("type") == "relation"}
trails = []
for id_, match, name, kind, color, desc in TRAILS:
    rel = next((r for n, r in rels.items() if match in n), None)
    if not rel: print(f"[warn] 找不到 {name}（比對 {match!r}）"); continue
    ways = [m["geometry"] for m in rel.get("members", []) if m.get("type") == "way" and m.get("geometry")]
    chains = chain(ways)
    projected = [[proj(p) for p in c] for c in chains]
    total_pts = sum(len(c) for c in projected)
    segs = []
    for c in projected:
        for s in clip(c):
            s = simplify(s, EPS)
            if len(s) >= 2 and length(s) >= STEP: segs.append(densify(s, STEP))
    kept = sum(len(s) for s in segs)
    raw_kept = sum(len(s) for c in projected for s in clip(c))
    units = sum(length(s) for s in segs)
    trails.append({"id": id_, "name": name, "kind": kind, "color": color, "lengthKm": round(units / K, 1), "desc": desc,
                   "segments": [[[round(x, 3), round(z, 3)] for x, z in s] for s in segs]})
    print(f"{name:<10} ways={len(ways):>3} 串成 {len(chains):>2} 條 → 保留 {raw_kept}/{total_pts} 點 ({100 * raw_kept / max(1, total_pts):.0f}%)，"
          f"輸出 {len(segs)} 段 {kept} 點，{units:.1f} 單位 ≈ {units / K:.1f} km")

out = {"note": "路線幾何來自 OpenStreetMap（© OpenStreetMap contributors, ODbL），座標為 data/city.json 的世界座標，長度為地圖範圍內的近似值。", "trails": trails}
path = os.path.join(ROOT, "data", "trails.json")
json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"→ {os.path.relpath(path, ROOT)}：{len(trails)} 條步道，{os.path.getsize(path) // 1024} KB")
