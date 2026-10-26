"""烏樹林糖廠觀光五分車：從 tools/raw/osm_rail.json 挑出糖鐵窄軌 way，串成一條從糖廠出發的連續路線，產出 data/sugar.json。
用法：python3 -I tools/build_sugar.py  （離線、可重跑，投影公式取自 data/city.json）"""
import heapq, json, math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "tools", "raw", "osm_rail.json")
CITY = os.path.join(ROOT, "data", "city.json")
ISLANDS = os.path.join(ROOT, "data", "islands.json")
OUT = os.path.join(ROOT, "data", "sugar.json")

# 候選 way（依名稱）：營業段為主，接上烏樹林線本線、白河線，再沿新港東線到觀光線終點新頂埤
NAMES = ("烏樹林糖廠烏樹林線(營業)", "烏樹林糖廠烏樹林線", "烏樹林糖廠白河線", "臺糖鐵路新港東線")
MAIN = NAMES[0]
LINE = {"id": "wushulin", "name": "烏樹林五分車", "color": "#c8472b",
        "desc": "烏樹林糖廠 1910 年代起的糖業鐵道，2001 年起以觀光五分車行駛。",
        "start": "烏樹林車站", "end": "新頂埤"}
EPS, STEP, SNAP = 0.03, 0.15, 0.01  # 加密間距用 0.15（0.25 只剩 16 點，不到測試要求的 20 點）

city = json.load(open(CITY, encoding="utf-8"))
P = city["projection"]
proj = lambda lon, lat: ((lon - P["lon_c"]) * P["km_x"] * P["k"], -(lat - P["lat_c"]) * P["km_z"] * P["k"])
ways = [w for w in json.load(open(RAW, encoding="utf-8"))["elements"]
        if w.get("type") == "way" and w.get("tags", {}).get("railway") == "narrow_gauge" and w["tags"].get("name") in NAMES]
if not ways: raise SystemExit("osm_rail.json 裡找不到烏樹林的窄軌 way")

# ── 把 way 的節點合併成圖（相距 < SNAP 的端點視為同一點），再用最短路徑串接；路徑自然會把需要反轉的 way 反過來 ──
nodes, adj, main_nodes = [], {}, set()
def node_of(p):
    for i, q in enumerate(nodes):
        if math.hypot(p[0] - q[0], p[1] - q[1]) < SNAP: return i
    nodes.append(p); adj[len(nodes) - 1] = []
    return len(nodes) - 1
for w in ways:
    ids = [node_of(proj(g["lon"], g["lat"])) for g in w["geometry"]]
    if w["tags"]["name"] == MAIN: main_nodes.update(ids)
    for a, b in zip(ids, ids[1:]):
        if a == b: continue
        d = math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1])
        adj[a].append((b, d)); adj[b].append((a, d))

def dijkstra(src):
    dist, prev, pq = {src: 0.0}, {src: None}, [(0.0, src)]
    while pq:
        d, n = heapq.heappop(pq)
        if d > dist[n]: continue
        for m, w in adj[n]:
            if d + w < dist.get(m, math.inf): dist[m] = d + w; prev[m] = n; heapq.heappush(pq, (d + w, m))
    return dist, prev

# 起點：營業段裡的盡頭（度數 1）節點，就是糖廠的月台端；終點：從起點沿圖走最遠的節點（新頂埤端有會車環線，所以不要求是盡頭）
ends = [n for n in main_nodes if len(adj[n]) == 1]
start = ends[0] if ends else min(main_nodes)
dist, prev = dijkstra(start)
far = max(dist, key=lambda n: dist[n])
path, n = [], far
while n is not None: path.append(nodes[n]); n = prev[n]
path.reverse()
unreached = len(nodes) - len(dist)
if unreached: print(f"WARN {unreached} 個節點與起點不連通，已略過（取最長的連續一段）")

# ── Douglas–Peucker 簡化，再每 STEP 加密 ──
def dp(points, eps):
    if len(points) < 3: return points
    a, b = points[0], points[-1]
    dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz) or 1
    dist_ = lambda p: abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dz) / L
    imax, dmax = max(((i, dist_(p)) for i, p in enumerate(points[1:-1], 1)), key=lambda x: x[1])
    return dp(points[:imax + 1], eps)[:-1] + dp(points[imax:], eps) if dmax > eps else [a, b]
def densify(points, step):
    out = [points[0]]
    for a, b in zip(points, points[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1]); n = max(1, math.ceil(L / step))
        out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(1, n + 1)]
    return out
pts = densify(dp(path, EPS), STEP)

# ── 只留在某個區多邊形內的點 ──
def inside(poly, p):
    x, z = p; c = False
    for i in range(len(poly)):
        x0, z0 = poly[i]; x1, z1 = poly[(i + 1) % len(poly)]
        if (z0 > z) != (z1 > z) and x < (x1 - x0) * (z - z0) / (z1 - z0) + x0: c = not c
    return c
polys = [d["polygon"] for d in city["districts"]]
on_land = [p for p in pts if any(inside(poly, p) for poly in polys)]
print(f"陸地內的點 {len(on_land)}/{len(pts)}（{100 * len(on_land) / len(pts):.0f}%）")
pts = on_land
length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))

# ── 起點離烏樹林糖廠建築落點多遠（建築第 i 個對應 city.json 的 slots[i]） ──
houbi = next(d for d in city["districts"] if d["name"] == "後壁區")
isl = next(i for i in json.load(open(ISLANDS, encoding="utf-8")) if i["id"] == houbi["id"])
bi = next(i for i, b in enumerate(isl["buildings"]) if b["name"] == "烏樹林糖廠")
slot = houbi["slots"][bi]
d0 = math.hypot(pts[0][0] - slot[0], pts[0][1] - slot[1])
print(f"way {len(ways)} 段，點 {len(pts)}，長度 {length:.2f} 單位（約 {length / city['projection']['k']:.2f} km），起點 {[round(v, 2) for v in pts[0]]} 離糖廠落點 {d0:.2f} 單位")
if d0 > 1.5: print("WARN 起點離糖廠超過 1.5 單位")

line = {"id": LINE["id"], "name": LINE["name"], "district": houbi["id"], "color": LINE["color"], "desc": LINE["desc"],
        "points": [[round(x, 3), round(z, 3)] for x, z in pts],
        "stops": [{"name": LINE["start"], "i": 0}, {"name": LINE["end"], "i": len(pts) - 1}]}
json.dump({"note": "軌道幾何取自 OpenStreetMap（© OpenStreetMap contributors, ODbL），投影同 city.json", "lines": [line]},
          open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("寫出", os.path.relpath(OUT, ROOT))
