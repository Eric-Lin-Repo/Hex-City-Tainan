"""把 twTown1982.topo.json 的台南 37 區轉成 HEX CITY 用的 data/city.json、islands.json、flows.json。
用法：python3 -I tools/build_city.py <twTown1982.topo.json> data
"""
import json, math, os, random, sys

SRC, OUT = sys.argv[1], sys.argv[2]
COUNTIES = ("台南市", "台南縣")   # 1982 版：原台南市 6 區 + 原台南縣 31 鄉鎮市 = 今日台南市 37 區
NS_UNITS = 80.0                   # 南北總長（世界單位）；原本 44 → 66 → 80，區塊相對建築更寬鬆
SMALL_AREA = 24.0                 # 面積（世界單位²）小於這個值的市區（中西、北、東、安平）建築縮小、間距放寬
SMALL_GAP = 0.65                  # 小區任兩個建築／景點／車站的最小間距；模型縮成 0.58 倍約 0.55–0.6 寬，原本 0.5 會疊在一起（中西區用 0.75 會塞不下）
INSET = 0.0                       # 區與區貼合（0）；大於 0 會往內縮留水道
t = json.load(open(SRC))
sc, tr = t["transform"]["scale"], t["transform"]["translate"]

# ── TopoJSON 解碼 ──
arcs = []
for arc in t["arcs"]:
    x = y = 0
    pts = []
    for dx, dy in arc:
        x += dx; y += dy
        pts.append((x * sc[0] + tr[0], y * sc[1] + tr[1]))
    arcs.append(pts)

def ring_from(idx_list):
    out = []
    for i in idx_list:
        pts = arcs[i] if i >= 0 else list(reversed(arcs[~i]))
        if out and out[-1] == pts[0]: pts = pts[1:]
        out.extend(pts)
    if out[0] == out[-1]: out.pop()
    return out

def district_name(n):
    if n.endswith("區"): return n
    return n[:-1] + "區"  # 鄉／鎮／市 → 區（2010 年縣市合併後的名稱）

towns = [g for g in t["objects"]["layer1"]["geometries"]
         if g["properties"]["COUNTYNAME"] in COUNTIES and "(海)" not in g["properties"]["TOWNNAME"]]
D = {}
for g in towns:
    id_ = "d" + g["properties"]["TOWNID"]
    D[id_] = {"name": district_name(g["properties"]["TOWNNAME"]), "arcs": [abs(i) if i >= 0 else ~i for i in g["arcs"][0]], "arcIdx": g["arcs"][0], "ring": ring_from(g["arcs"][0])}

# ── 投影到世界座標：北為 −z，整個城市置中 ──
lons = [p[0] for d in D.values() for p in d["ring"]]; lats = [p[1] for d in D.values() for p in d["ring"]]
lon_c, lat_c = (min(lons) + max(lons)) / 2, (min(lats) + max(lats)) / 2
km_x, km_z = 100.9, 111.0
k = NS_UNITS / ((max(lats) - min(lats)) * km_z)
proj = lambda p: ((p[0] - lon_c) * km_x * k, -(p[1] - lat_c) * km_z * k)

def dp(points, eps):
    if len(points) < 3: return points
    a, b = points[0], points[-1]
    def dist(p):
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dz) or 1
        return abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dz) / L
    imax, dmax = max(((i, dist(p)) for i, p in enumerate(points[1:-1], 1)), key=lambda x: x[1])
    if dmax > eps:
        return dp(points[:imax + 1], eps)[:-1] + dp(points[imax:], eps)
    return [a, b]

def area(poly):
    return 0.5 * sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
def centroid(poly):
    A = area(poly); cx = cz = 0
    for i in range(len(poly)):
        x0, z0 = poly[i]; x1, z1 = poly[(i + 1) % len(poly)]
        f = x0 * z1 - x1 * z0; cx += (x0 + x1) * f; cz += (z0 + z1) * f
    return (cx / (6 * A), cz / (6 * A))
def inside(poly, p):
    x, z = p; c = False; n = len(poly)
    for i in range(n):
        x0, z0 = poly[i]; x1, z1 = poly[(i + 1) % n]
        if (z0 > z) != (z1 > z) and x < (x1 - x0) * (z - z0) / (z1 - z0) + x0: c = not c
    return c
def seg_dist(p, a, b):
    ax, az = a; bx, bz = b; px, pz = p
    dx, dz = bx - ax, bz - az; L2 = dx * dx + dz * dz
    tt = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / L2))
    return math.hypot(px - (ax + tt * dx), pz - (az + tt * dz))
def boundary_dist(poly, p):
    return min(seg_dist(p, poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))
def nearest_on_boundary(poly, p):
    best = None
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        dx, dz = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dz * dz
        tt = 0 if L2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
        q = (a[0] + tt * dx, a[1] + tt * dz); d = math.hypot(p[0] - q[0], p[1] - q[1])
        if best is None or d < best[0]: best = (d, q)
    return best[1]

rnd = random.Random(7)
# 每條邊界弧線在投影後各自簡化一次（保留端點），相鄰的區共用同一條簡化結果，交界才會完全貼合
simp_arc = {}
def simp(i):
    if i not in simp_arc:
        simp_arc[i] = dp([proj(p) for p in arcs[i]], 0.06)
    return simp_arc[i]
def ring_from_simplified(idx_list):
    out = []
    for i in idx_list:
        pts = simp(i) if i >= 0 else list(reversed(simp(~i)))
        if out and out[-1] == pts[0]: pts = pts[1:]
        out.extend(pts)
    if out[0] == out[-1]: out.pop()
    return out
import collections
arc_use = collections.Counter(a for d in D.values() for a in d["arcs"])
coast = [[[round(x, 3), round(z, 3)] for x, z in simp(i)] for i, n in arc_use.items() if n == 1]  # 只屬於一個區的弧線 = 海岸或市界
for id_, d in D.items():
    full = ring_from_simplified(d["arcIdx"])
    c = centroid(full)
    r_mean = sum(math.hypot(p[0] - c[0], p[1] - c[1]) for p in full) / len(full)
    f = max(0.78, 1 - INSET / r_mean) if INSET > 0 else 1.0
    poly = full if f == 1.0 else [(c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f) for p in full]
    d["full"], d["poly"], d["area"] = full, poly, abs(area(poly))
    # 區中心：離邊界最遠的內部點（格點搜尋）
    xs = [p[0] for p in poly]; zs = [p[1] for p in poly]
    best = (-1, c)
    step = max(0.08, min(0.2, (max(xs) - min(xs)) / 40))
    x = min(xs)
    while x <= max(xs):
        z = min(zs)
        while z <= max(zs):
            if inside(poly, (x, z)):
                bd = boundary_dist(poly, (x, z))
                if bd > best[0]: best = (bd, (x, z))
            z += step
        x += step
    d["hub"] = best[1]; d["hubClear"] = best[0]

# ── 相鄰與橋 ──
ids = list(D)
bridges = []
for i, a in enumerate(ids):
    for b in ids[i + 1:]:
        shared = set(D[a]["arcs"]) & set(D[b]["arcs"])
        if not shared: continue
        pts = [proj(p) for s in shared for p in arcs[s]]
        mid = pts[len(pts) // 2]
        pa = nearest_on_boundary(D[a]["poly"], mid); pb = nearest_on_boundary(D[b]["poly"], mid)
        bridges.append({"a": a, "b": b, "from": [round(pa[0], 3), round(pa[1], 3)], "to": [round(pb[0], 3), round(pb[1], 3)]})
        D[a].setdefault("neighbors", []).append(b); D[b].setdefault("neighbors", []).append(a)
        D[a].setdefault("ports", []).append(pa); D[b].setdefault("ports", []).append(pb)

# ── 鐵路：站點投影後貼回陸地，軌道線段讓建築與樹避開 ──
rail_src = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "rail_source.json")))
def snap(p):
    for id_, d in D.items():
        if inside(d["full"], p):
            if inside(d["poly"], p) and boundary_dist(d["poly"], p) >= 0.4: return p, id_
            hub = d["hub"]
            for t in range(1, 41):
                q = (p[0] + (hub[0] - p[0]) * t / 40, p[1] + (hub[1] - p[1]) * t / 40)
                if inside(d["poly"], q) and boundary_dist(d["poly"], q) >= 0.4: return q, id_
            return hub, id_
    id_ = min(D, key=lambda i: math.hypot(D[i]["hub"][0] - p[0], D[i]["hub"][1] - p[1]))
    return D[id_]["hub"], id_
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
import heapq

# ── 地理編碼快取（tools/fetch_geocode.py 產生）：key 為 station:<id>、poi:<id>、building:<區>:<名> ──
geo_cache_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "geocode_cache.json")
geo_cache = json.load(open(geo_cache_path)) if os.path.exists(geo_cache_path) else {}
def geo_lonlat(key, ok=("district-match", "bbox")):
    """快取裡信心等級夠的經緯度 (lon, lat)，沒有就 None。"""
    e = geo_cache.get(key)
    if not e or e.get("confidence") not in ok or "lat" not in e: return None
    return (e["lon"], e["lat"])
def district_of(p):
    for id_, d in D.items():
        if inside(d["full"], p): return id_
    return min(D, key=lambda i: math.hypot(D[i]["hub"][0] - p[0], D[i]["hub"][1] - p[1]))
def land_dist(p):
    """在某區（縮進後的島）內回 0，否則回到最近島邊界的距離。"""
    best = math.inf
    for d in D.values():
        if inside(d["poly"], p): return 0.0
        best = min(best, boundary_dist(d["poly"], p))
    return best

RAIL_MERGE_DECIMALS = 4  # 節點座標四捨五入到 0.0001 度（約 10 公尺），讓雙軌與橋的端點接起來
def build_rail_graph(osm):
    """OSM 鐵路 way → 節點圖（節點 = 四捨五入後的經緯度，邊長 = 公里）。"""
    adj = {}
    key = lambda pt: (round(pt["lon"], RAIL_MERGE_DECIMALS), round(pt["lat"], RAIL_MERGE_DECIMALS))
    for w in osm:
        g = w.get("geometry", [])
        for a, b in zip(g, g[1:]):
            ka, kb = key(a), key(b)
            if ka == kb: continue
            dist = math.hypot((a["lon"] - b["lon"]) * km_x, (a["lat"] - b["lat"]) * km_z)
            adj.setdefault(ka, []).append((kb, dist)); adj.setdefault(kb, []).append((ka, dist))
    return adj
def graph_components(adj):
    seen, sizes = set(), []
    for n in adj:
        if n in seen: continue
        stack, cnt = [n], 0; seen.add(n)
        while stack:
            x = stack.pop(); cnt += 1
            for m, _ in adj[x]:
                if m not in seen: seen.add(m); stack.append(m)
        sizes.append(cnt)
    return sorted(sizes, reverse=True)
def is_tra_track(t):
    """台鐵正線：railway=rail、usage main/branch，營運者含臺灣鐵路或名稱含縱貫／沙崙／正線／橋；排除站場、側線、支線。"""
    if t.get("railway") != "rail" or t.get("service") in ("yard", "siding", "spur"): return False
    if t.get("usage") not in ("main", "branch"): return False
    nm, op = t.get("name", ""), t.get("operator", "")
    if "高速鐵路" in nm or "高速鐵路" in op: return False
    return "臺灣鐵路" in op or "台灣鐵路" in op or any(k in nm for k in ("縱貫", "沙崙", "正線", "橋"))
def dijkstra(adj, a, b):
    dist, prev, pq = {a: 0}, {a: None}, [(0, a)]
    while pq:
        d, n = heapq.heappop(pq)
        if n == b: break
        if d > dist.get(n, 1e18): continue
        for m, w in adj.get(n, []):
            nd = d + w
            if nd < dist.get(m, 1e18): dist[m] = nd; prev[m] = n; heapq.heappush(pq, (nd, m))
    if b not in prev: return None
    out = []
    n = b
    while n is not None: out.append(n); n = prev[n]
    return out[::-1]

osm_rail_path = os.path.join(RAW, "osm_rail.json")
rail_graph = None
hsr_tracks = []
if os.path.exists(osm_rail_path):
    osm_all = json.load(open(osm_rail_path))["elements"]
    tra = [w for w in osm_all if w["type"] == "way" and is_tra_track(w.get("tags", {}))]
    rail_graph = build_rail_graph(tra)
    comps = graph_components(rail_graph)
    if len(comps) > 1: print(f"WARN rail graph 不連通：{len(comps)} 個片段，大小 {comps[:8]}")
    rail_nodes = list(rail_graph)
    for w in osm_all:
        t = w.get("tags", {})
        if w["type"] == "way" and t.get("railway") == "rail" and "高速鐵路" in t.get("name", "") and not t.get("service"):
            pts = [proj((g["lon"], g["lat"])) for g in w.get("geometry", [])]
            if len(pts) > 1: hsr_tracks.append([[round(x, 3), round(z, 3)] for x, z in dp(pts, 0.05)])
    print("rail graph ways", len(tra), "nodes", len(rail_graph), "components", len(comps), "hsr ways", len(hsr_tracks))

stations, station_node = [], {}
for st in rail_src["stations"]:
    if rail_graph:
        ll = geo_lonlat("station:" + st["id"]) or (st["lon"], st["lat"])  # 地理編碼只用來找最近的軌道節點
        node = min(rail_nodes, key=lambda n: (n[0] - ll[0]) ** 2 + (n[1] - ll[1]) ** 2)
        # 軌道沿區界走時最近的節點會落在水道裡：在附近 0.8 單位內改挑離陸地 0.3 以內、最靠近的節點
        if land_dist(proj(node)) > 0.3:
            p0 = proj(node)
            cands = [n for n in rail_nodes if math.hypot(proj(n)[0] - p0[0], proj(n)[1] - p0[1]) < 0.8 and land_dist(proj(n)) <= 0.3]
            if cands: node = min(cands, key=lambda n: (n[0] - ll[0]) ** 2 + (n[1] - ll[1]) ** 2)
        station_node[st["id"]] = node
        q = proj(node); did = district_of(q)
    else:
        q, did = snap(proj((st["lon"], st["lat"])))
    stations.append({"id": st["id"], "name": st["name"], "pos": [round(q[0], 3), round(q[1], 3)], "district": did, "kind": st.get("kind", "rail")})
pos_of = {st["id"]: st["pos"] for st in stations}
# 相鄰兩站若近於 1.4 單位，把後一站沿線方向推開，避免車站模型疊在一起（有真實路線時不推）
for l in ([] if rail_graph else rail_src["lines"]):
    for a, b in zip(l["stations"], l["stations"][1:]):
        pa, pb = pos_of[a], pos_of[b]
        d = math.hypot(pb[0] - pa[0], pb[1] - pa[1])
        if d < 1.4:
            ux, uz = ((pb[0] - pa[0]) / d, (pb[1] - pa[1]) / d) if d > 1e-6 else (1.0, 0.0)
            pos_of[b][0] = round(pa[0] + ux * 1.4, 3); pos_of[b][1] = round(pa[1] + uz * 1.4, 3)
def densify(pts, max_len=0.3):
    """太長的線段補中間點（平原上的縱貫線幾乎是直線，dp 之後點很少；補點不改形狀，火車行駛較平順）。"""
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / max_len))
        out += [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(1, n + 1)]
    return out
def route_points(station_ids):
    """站序 → 密集路線點與各站在點列中的索引。有 OSM 圖就沿真實軌道，否則直線。"""
    pts, stops = [], []
    for a, b in zip(station_ids, station_ids[1:]):
        if rail_graph:
            path = dijkstra(rail_graph, station_node[a], station_node[b])
            if not path: print(f"WARN rail {a}→{b} 在軌道圖上不連通，改用直線")
            seg = [proj(n) for n in path] if path else [tuple(pos_of[a]), tuple(pos_of[b])]
            seg = dp(seg, 0.03)
        else:
            seg = [tuple(pos_of[a]), tuple(pos_of[b])]
        seg = densify(seg)
        if pts: seg = seg[1:]
        else: stops.append(0)
        pts.extend(seg)
        stops.append(len(pts) - 1)
    return [[round(x, 3), round(z, 3)] for x, z in pts], stops
lines = []
for l in rail_src["lines"]:
    pts, stops = route_points(l["stations"])
    lines.append({"id": l["id"], "name": l["name"], "color": l["color"], "kind": "tra", "stations": l["stations"], "points": pts, "stops": stops})
for i, trk in enumerate(hsr_tracks):
    lines.append({"id": f"hsr-{i}", "name": "台灣高鐵", "color": "#d98c3a", "kind": "hsr", "stations": [], "points": trk, "stops": []})
rail_segs = [(tuple(l["points"][i]), tuple(l["points"][i + 1])) for l in lines for i in range(len(l["points"]) - 1)]
station_pts = [tuple(st["pos"]) for st in stations]

# ── 河流與水庫（OSM）──
RIVERS = ["曾文溪", "急水溪", "鹽水溪", "二仁溪", "二層行溪", "八掌溪", "後堀溪", "菜寮溪"]
LAKES = ["曾文水庫", "烏山頭水庫", "南化水庫", "七股潟湖", "德元埤水庫", "虎頭埤", "尖山埤", "鏡面水庫", "白河水庫", "鹿寮水庫"]
def merge_ways(ways):
    """把同名的 way 依端點相接合併成幾條折線。"""
    segs = [[(g["lon"], g["lat"]) for g in w.get("geometry", [])] for w in ways]
    segs = [sg for sg in segs if len(sg) > 1]
    out = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while changed:
            changed = False
            for i, sg in enumerate(segs):
                if sg[0] == cur[-1]: cur += sg[1:]; segs.pop(i); changed = True; break
                if sg[-1] == cur[0]: cur = sg + cur[1:]; segs.pop(i); changed = True; break
                if sg[-1] == cur[-1]: cur += sg[::-1][1:]; segs.pop(i); changed = True; break
                if sg[0] == cur[0]: cur = sg[::-1] + cur[1:]; segs.pop(i); changed = True; break
        out.append(cur)
    return out
rivers, lakes = [], []
osm_water_path = os.path.join(RAW, "osm_water.json")
if os.path.exists(osm_water_path):
    wel = json.load(open(osm_water_path))["elements"]
    by_name = {}
    for e in wel:
        t = e.get("tags", {})
        nm = t.get("name", "")
        if e["type"] == "way" and t.get("waterway") in ("river", "canal") and nm in RIVERS:
            by_name.setdefault(nm, []).append(e)
    for nm, ways in by_name.items():
        for line in merge_ways(ways):
            pts = dp([proj(p) for p in line], 0.08)
            if len(pts) > 2: rivers.append({"name": nm, "points": [[round(x, 3), round(z, 3)] for x, z in pts]})
    def lake_name(nm):
        """OSM 名稱對到清單：如「烏山頭水庫 (珊瑚潭)」「虎頭埤水庫」「尖山埤水庫」。"""
        return next((L for L in LAKES if L in nm), None)
    def dp_ring(pts, eps):
        """封閉環的簡化：去掉重複的閉合點，拆成兩段各自簡化（整環丟給 dp 會因首尾同點退化成兩點）。"""
        if len(pts) > 1 and pts[0] == pts[-1]: pts = pts[:-1]
        if len(pts) < 4: return pts
        h = len(pts) // 2
        return dp(pts[:h + 1], eps)[:-1] + dp(pts[h:] + [pts[0]], eps)[:-1]
    for e in wel:
        t = e.get("tags", {}); nm = lake_name(t.get("name", ""))
        if t.get("natural") != "water" or not nm: continue
        if e["type"] == "way":
            rings = [[(g["lon"], g["lat"]) for g in e.get("geometry", [])]]
        else:
            outer = [m for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
            rings = merge_ways(outer)
        for ring in rings:
            if len(ring) < 4: continue
            pts = dp_ring([proj(p) for p in ring], 0.06)
            if len(pts) >= 3 and abs(area(pts)) > 0.02: lakes.append({"name": nm, "polygon": [[round(x, 3), round(z, 3)] for x, z in pts]})
    print("rivers", [(r["name"], len(r["points"])) for r in rivers], "lakes", [(l["name"], len(l["polygon"])) for l in lakes])

# ── 湖面與水庫：建築、景點、樹、田都不放進湖裡（前端只畫大半在陸地上的湖，這裡用同一個標準）──
# 曾文水庫的湖面幾乎都在嘉義縣大埔鄉，整片落在區界外；改在楠西區、壩的上游側畫一片等比例縮小的示意湖（schematic），
# 壩體建築放在湖的下游端。壩的真實座標見 tools/dams.json。
dams = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "dams.json")))["dams"]  # {水庫名: {lon, lat, source}}
SCHEMATIC = {"曾文水庫": "楠西區"}  # 區界外的水庫 → 示意湖放在哪一區
LAKE_GAP, DAM_GAP, TREE_GAP = 0.5, 0.4, 0.25  # 建築與景點、壩、樹離湖岸的最小距離
def on_land_frac(poly): return sum(1 for p in poly if land_dist(p) == 0) / len(poly)
def seg_hits(poly, a, b, step=0.2):
    n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / step))
    return any(inside(poly, (a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n)) for t in range(n + 1))
def fit_lake(poly, did, dam_q):
    """把區界外的湖等比例縮小搬進 did 區：湖的壩端（離壩最近的頂點）放在離壩最近的可行位置，
    整片湖在區內、離區界 ≥ 0.35，不蓋到區中心廣場、車站、鐵路與區中心往橋頭的動線。由大到小試縮放比例。回傳 (多邊形, 壩端位置)。"""
    d = D[did]; dpoly, hub = d["poly"], d["hub"]
    plaza = min(d["hubClear"] * 0.75, 1.1) + 0.6
    corridors = [(hub, q) for q in d.get("ports", [])]
    a = min(poly, key=lambda v: math.hypot(v[0] - dam_q[0], v[1] - dam_q[1]))
    coarse = poly[::max(1, len(poly) // 48)]
    t0, _ = snap(dam_q)
    grid = sorted(((t0[0] + i * 0.2, t0[1] + j * 0.2) for i in range(-30, 31) for j in range(-30, 31)), key=lambda t: math.hypot(t[0] - t0[0], t[1] - t0[1]))
    for s in (0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15):
        for t in grid:
            if not inside(dpoly, t): continue
            f = lambda v: (t[0] + (v[0] - a[0]) * s, t[1] + (v[1] - a[1]) * s)
            pts = [f(v) for v in coarse]
            if not all(inside(dpoly, q) and boundary_dist(dpoly, q) >= 0.35 for q in pts): continue
            if inside(pts, hub) or min(math.hypot(q[0] - hub[0], q[1] - hub[1]) for q in pts) < plaza: continue
            if any(inside(pts, q) or min(math.hypot(q[0] - v[0], q[1] - v[1]) for v in pts) < 0.6 for q in station_pts): continue
            if any(seg_dist(q, a2, b2) < 0.4 for q in pts for a2, b2 in rail_segs): continue
            if any(seg_hits(pts, a2, b2) for a2, b2 in corridors + rail_segs): continue
            print(f"示意湖 {did}：縮放 {s}，壩端 ({t[0]:.2f}, {t[1]:.2f})，離真實壩 {math.hypot(t[0] - dam_q[0], t[1] - dam_q[1]):.2f} 單位")
            return [f(v) for v in poly], t
    raise SystemExit(f"示意湖放不進 {did}")
dam_at = {}  # 水庫名 → 壩體建築的目標位置（之後再找湖岸邊的空地）
# 放在真實位置的建築（大學等，見 tools/pinned_buildings.json）：其他建築放好之後才放到離真實座標最近的空地
pins = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "pinned_buildings.json")))["pins"]
for lk in lakes:
    if lk["name"] in SCHEMATIC:
        did = next(i for i, d in D.items() if d["name"] == SCHEMATIC[lk["name"]])
        poly2, tip = fit_lake(lk["polygon"], did, proj((dams[lk["name"]]["lon"], dams[lk["name"]]["lat"])))
        lk.update({"polygon": [[round(x, 3), round(z, 3)] for x, z in poly2], "schematic": True, "district": did})
        dam_at[lk["name"]] = tip
shown_lakes = [l for l in lakes if on_land_frac(l["polygon"]) >= 0.5]
for lk in shown_lakes:
    lxs = [v[0] for v in lk["polygon"]]; lzs = [v[1] for v in lk["polygon"]]
    lk["_bbox"] = (min(lxs), max(lxs), min(lzs), max(lzs))
    if lk["name"] in dams and lk["name"] not in dam_at: dam_at[lk["name"]] = nearest_on_boundary(lk["polygon"], proj((dams[lk["name"]]["lon"], dams[lk["name"]]["lat"])))  # 壩的真實座標投到湖岸上
def wet(p, m=LAKE_GAP):
    """p 在湖裡，或離湖岸不到 m。"""
    for l in shown_lakes:
        x0, x1, z0, z1 = l["_bbox"]
        if x0 - m <= p[0] <= x1 + m and z0 - m <= p[1] <= z1 + m and (inside(l["polygon"], p) or boundary_dist(l["polygon"], p) < m): return True
    return False
def dry(q, did, others, gap, m=LAKE_GAP, margin=0.4, radius=5.0):
    """q 附近最近的乾地：在 did 區內、離區界 ≥ margin、離湖岸 ≥ m、離 others ≥ gap、離鐵路 ≥ 0.35。找不到回 None。"""
    poly = D[did]["poly"]; n = int(radius / 0.1)
    for c in sorted(((q[0] + i * 0.1, q[1] + j * 0.1) for i in range(-n, n + 1) for j in range(-n, n + 1)), key=lambda c: math.hypot(c[0] - q[0], c[1] - q[1])):
        if math.hypot(c[0] - q[0], c[1] - q[1]) > radius: break
        if not inside(poly, c) or boundary_dist(poly, c) < margin or wet(c, m): continue
        if any(math.hypot(c[0] - o[0], c[1] - o[1]) < gap for o in others): continue
        if any(seg_dist(c, a, b) < 0.35 for a, b in rail_segs): continue
        return c
    return None

# ── 景點、夜市、科學園區：投影、貼回陸地、彼此與車站保持距離 ──
poi_src = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "poi_source.json")))
pois = []
placed = list(station_pts)
def spread(q, did, placed, gap=1.3, floor=0.5, small_gap=0.6):
    """離其他點太近就往區中心推開（小區間距放寬）；推不開就在區內格點裡找離大家至少 floor、且最靠近原位的落點。
    回傳 (落點, 區, 是否成功)。"""
    small = D[did]["area"] < SMALL_AREA
    want = min(gap, small_gap) if small else gap  # 小區的模型也縮小，間距可以更近
    if small: floor = max(floor, min(gap, small_gap))
    q0, q = tuple(q), list(q)
    for _ in range(12):
        near = [r for r in placed if math.hypot(q[0] - r[0], q[1] - r[1]) < want]
        if not near: return q, did, True
        hub = D[did]["hub"]
        q = [q[0] + (hub[0] - q[0]) * 0.25 + (q[0] - near[0][0]) * 0.3, q[1] + (hub[1] - q[1]) * 0.25 + (q[1] - near[0][1]) * 0.3]
        q2, did = snap(tuple(q)); q = list(q2)
    poly = D[did]["poly"]; margin = 0.15 if D[did]["area"] < SMALL_AREA else 0.4  # 市中心的小區縮進後只剩細長一片，邊界餘裕放寬
    xs = [p[0] for p in poly]; zs = [p[1] for p in poly]
    best = None
    x = min(xs)
    while x <= max(xs):
        z = min(zs)
        while z <= max(zs):
            c = (x, z)
            if inside(poly, c) and boundary_dist(poly, c) >= margin:
                md = min((math.hypot(c[0] - r[0], c[1] - r[1]) for r in placed), default=9)
                if md >= floor:
                    score = math.hypot(c[0] - q0[0], c[1] - q0[1])
                    if best is None or score < best[0]: best = (score, c)
            z += 0.1
        x += 0.1
    return (list(best[1]), did, True) if best else (q, did, False)
poi_kept = []
for po in poi_src["pois"]:
    # 地理編碼：信心等級 district-match/bbox、落在預期的區（來源沒寫區就任一區）內，而且合理（離來源座標 3 公里內，
    # 或 Nominatim 回傳的名稱以景點名開頭）才採用，否則保留來源的經緯度
    e = geo_cache.get("poi:" + po["id"], {})
    ll = geo_lonlat("poi:" + po["id"]); used_geo = False
    if ll:
        gq = proj(ll); expect = po.get("district")
        in_district = any((not expect or d["name"] == expect) and inside(d["full"], gq) for d in D.values())
        dkm = math.hypot((ll[0] - po["lon"]) * km_x, (ll[1] - po["lat"]) * km_z)
        norm = lambda x: x.replace("臺", "台")
        used_geo = in_district and (dkm <= 3.0 or norm(po["name"]) in norm(e.get("display_name", "")).split(",")[0])
    if not used_geo: poi_kept.append(po["name"])
    q, did = snap(proj(ll if used_geo else (po["lon"], po["lat"])))
    q, did, ok = spread(q, did, placed, small_gap=SMALL_GAP)  # 景點先放，小區直接拉開到不重疊；建築之後由 relax 推開
    if not ok: print(f"WARN 景點 {po['name']} 在 {D[did]['name']} 找不到離其他點 0.5 以上的位置")
    placed.append(tuple(q))  # 用搬離湖面前的位置：後面的景點與建築取樣照舊，其他區的配置不會跟著變
    raw = (round(q[0], 3), round(q[1], 3))
    if wet(q):
        q2 = dry(q, did, [r for r in placed[:-1]] + [tuple(e["pos"]) for e in pois], 0.6)
        if q2: print(f"景點 {po['name']} 在湖裡，移到岸邊（{math.hypot(q2[0] - q[0], q2[1] - q[1]):.2f} 單位）"); q = list(q2)
        else: print(f"WARN 景點 {po['name']} 在湖裡，附近找不到乾地")
    entry = {k: v for k, v in po.items() if k not in ("lat", "lon")}
    entry.update({"pos": [round(q[0], 3), round(q[1], 3)], "district": did, "geocoded": used_geo})
    entry["_raw"] = raw
    pois.append(entry)
poi_pts = [tuple(po["pos"]) for po in pois]
poi_pts_raw = [po.pop("_raw") for po in pois]  # 取樣用（亂數消耗與改版前一致）；最後的位置是 poi_pts
poi_moved = [q for q, r in zip(poi_pts, poi_pts_raw) if q != r]
print(f"geocoded pois {sum(1 for po in pois if po['geocoded'])}/{len(pois)}；保留來源座標：{poi_kept}")

# ── 內容產生器：依區的面積與位置選模型與說明 ──
PALETTE = ["#3e7c8c", "#e8c547", "#71806a", "#db6a41", "#7a6fb5", "#4a7fc1", "#c58b6a", "#5f7fb5", "#a65a3a", "#3f9a6b", "#f1c232", "#8fa07a"]
URBAN = [("station", "{n}車站", "整合公車與鐵路的轉運節點。", ["尖峰 5 分鐘一班接駁", "站內設有寄物與托育空間"]),
         ("library", "{n}圖書館", "24 小時自習區與兒童故事屋。", ["館藏可跨區預約取書", "每週三場講座"]),
         ("coworking", "{n}共享辦公室", "低門檻的創業起點。", ["首年租金減半", "屋頂花園開放午休"]),
         ("theater", "{n}小劇場", "小型實驗演出的固定舞台。", ["200 席", "青年團隊優先檔期"]),
         ("apartment", "{n}社會住宅", "混居、可負擔、靠近車站。", ["租金為市價六折", "一樓保留社區空間"]),
         ("gym", "{n}運動中心", "白天給學校，晚上給社區。", ["羽球場 6 面", "銀髮運動課"]),
         ("bookshop", "{n}獨立書店", "書店同時是社區的客廳。", ["租金補貼方案", "每週讀書會"]),
         ("clinic", "{n}社區診所", "家庭醫師制度的第一線據點。", ["夜間門診到 21:00", "可預約到宅醫療"]),
         ("museum", "{n}記憶館", "用常設展與口述歷史保存地方故事。", ["免費入場", "每季一檔社區策展"]),
         ("bikehub", "{n}共享單車站", "最後一哩路的租還點。", ["電輔車佔三成", "與車站票證互通"])]
RURAL = [("greenhouse", "{n}溫室", "農業與環境教育基地。", ["雨水回收灌溉", "每月開放認養菜畦"]),
         ("market", "{n}市場", "小農直送與街坊早餐。", ["在地農產直供", "晚間轉為夜市"]),
         ("pavilion", "{n}涼亭", "可預約的戶外活動空間。", ["週末市集固定場地", "夜間基本照明"]),
         ("school", "{n}小學", "放學後開放操場與圖書室給社區使用。", ["每班 25 人以下", "校園農園由學生自主經營"]),
         ("eldercare", "{n}日照中心", "長者白天的第二個家。", ["交通車跨區接送", "每日健走處方"]),
         ("daycare", "{n}托嬰中心", "讓家長安心上班的第一步。", ["收托到 19:00", "與社宅同棟規劃"]),
         ("playground", "{n}共融遊戲場", "各年齡與身心狀況都能一起玩的遊具。", ["無障礙動線全覆蓋", "家長與孩子參與設計"]),
         ("pharmacy", "{n}健康藥局", "慢性處方箋與用藥諮詢。", ["藥師駐點衛教", "與診所電子處方互通"]),
         ("lab", "{n}農業實驗室", "品種改良與食品加工的共用研發空間。", ["設備以小時計費", "與小學合作的科學營"]),
         ("busstop", "{n}智慧候車亭", "即時到站顯示與遮陽座椅。", ["太陽能供電", "緊急求助按鈕"])]

real_src = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "buildings_source.json")))
pop_src = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "population.json")))
areas = sorted(d["area"] for d in D.values())
median = areas[len(areas) // 2]
def make_content(i, id_, d):
    n = d["name"].replace("區", "")
    real = real_src.get(d["name"])
    if real:  # 有真實建築清單就用清單
        buildings = [{"id": f"{id_}-{k}", "name": row[0], "model": row[1], "plain": row[2], "facts": row[3] if len(row) > 3 else []} for k, row in enumerate(real)]  # 第 4 欄（可省略）是重點清單
        return PALETTE[i % len(PALETTE)], f"台南市{d['name']}，面積約 {d['area'] / (k * k):.0f} 平方公里。", buildings
    urban = d["area"] < median * 0.8 or d["name"] in ("永康區", "新營區", "仁德區", "歸仁區", "善化區", "新市區", "麻豆區", "佳里區", "新化區")
    pool = URBAN if urban else RURAL
    count = 1 if d["hubClear"] < 0.9 else 2 if d["area"] < 10 else 3 if d["area"] < 30 else 4
    picks = rnd.sample(pool, count)
    buildings = [{"id": f"{id_}-{m}", "name": nm.format(n=n), "model": m, "plain": plain, "facts": facts} for m, nm, plain, facts in picks]
    kind = "市區" if urban else "鄉村"
    summary = f"台南市{d['name']}，{kind}型的區，面積約 {d['area'] / (k * k):.0f} 平方公里，示範內容由產生器配置。"
    return PALETTE[i % len(PALETTE)], summary, buildings

# ── 建築落點與樹 ──
def relax(pts, poly, fixed, segs, name, gap=SMALL_GAP, margin=0.15, rail_gap=0.35, iters=400):
    """小區建築彼此、與景點／車站／區中心推開到至少 gap：每輪把太近的兩點沿連線推開（固定點不動，只推建築），
    再拉一點回原位、推離軌道、留在區界內。偏移平均分攤到所有建築，而不是後放的被一路擠到遠處。"""
    orig = [tuple(p) for p in pts]; cur = [list(p) for p in pts]
    hub = fixed[0]  # 呼叫端第一個固定點是區中心
    near_fixed = [f for f in fixed if any(math.hypot(f[0] - p[0], f[1] - p[1]) < 4 for p in orig)]
    for _ in range(iters):
        moved = 0
        for i, p in enumerate(cur):
            dx = dz = 0.0
            for j, q in enumerate(cur):
                if j == i: continue
                d = math.hypot(p[0] - q[0], p[1] - q[1])
                if d < gap: k = (gap - d) / max(d, 1e-3) * 0.5; dx += (p[0] - q[0]) * k; dz += (p[1] - q[1]) * k
            for q in near_fixed:
                d = math.hypot(p[0] - q[0], p[1] - q[1])
                if d < gap: k = (gap - d) / max(d, 1e-3); dx += (p[0] - q[0]) * k; dz += (p[1] - q[1]) * k
            dx += (orig[i][0] - p[0]) * 0.02; dz += (orig[i][1] - p[1]) * 0.02  # 微弱拉回真實位置
            step = math.hypot(dx, dz)
            if step > 0.08: dx, dz = dx / step * 0.08, dz / step * 0.08
            q = (p[0] + dx, p[1] + dz)
            for a, b in segs:
                sd = seg_dist(q, a, b)
                if sd < rail_gap:
                    ax, az = a; bx, bz = b; L2 = (bx - ax) ** 2 + (bz - az) ** 2
                    tt = 0 if L2 == 0 else max(0, min(1, ((q[0] - ax) * (bx - ax) + (q[1] - az) * (bz - az)) / L2))
                    cx, cz = ax + tt * (bx - ax), az + tt * (bz - az)
                    if sd > 1e-4: q = (cx + (q[0] - cx) * rail_gap / sd, cz + (q[1] - cz) * rail_gap / sd)
            ok = lambda c: inside(poly, c) and boundary_dist(poly, c) >= margin
            if not ok(q):  # 推出區界：沿著往區中心的方向找最近的合法位置，邊界上的建築改成沿邊滑動
                q = next((c for t in (0.05, 0.1, 0.2, 0.35, 0.5) for c in [(q[0] + (hub[0] - q[0]) * t, q[1] + (hub[1] - q[1]) * t)] if ok(c)), None)
            if q is not None:
                moved = max(moved, math.hypot(q[0] - p[0], q[1] - p[1])); cur[i] = list(q)
        if moved < 1e-3: break
    allp = cur + near_fixed
    bad = sum(1 for i in range(len(cur)) for j in range(len(allp)) if j != i and (j > i or j >= len(cur)) and math.hypot(cur[i][0] - allp[j][0], cur[i][1] - allp[j][1]) < gap - 0.05)
    far = max((math.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(orig, cur)), default=0)
    print(f"relax {name}: 建築 {len(cur)} 棟，仍小於 {gap} 的組數 {bad}，最大偏移 {far:.2f} 單位")
    return [tuple(p) for p in cur]

def sample(poly, hub, avoid, paths, n, bd_min, bd_max, gap, path_gap, tries=3000):
    xs = [p[0] for p in poly]; zs = [p[1] for p in poly]
    out = []
    for relax in (1.0, 0.8, 0.6, 0.4):
        for _ in range(tries):
            if len(out) >= n: break
            p = (rnd.uniform(min(xs), max(xs)), rnd.uniform(min(zs), max(zs)))
            if not inside(poly, p): continue
            bd = boundary_dist(poly, p)
            if bd < bd_min * relax or (bd_max and bd > bd_max): continue
            if any(math.hypot(p[0] - q[0], p[1] - q[1]) < gap * relax for q in out + avoid): continue
            if any(seg_dist(p, a, b) < path_gap * relax for a, b in paths): continue
            out.append(p)
        if len(out) >= n: break
    if len(out) < n:  # 隨機取樣找不到就掃格點，用最寬鬆的條件補齊
        relax = 0.4; x = min(xs)
        while x <= max(xs) and len(out) < n:
            z = min(zs)
            while z <= max(zs) and len(out) < n:
                p = (x, z); z += 0.1
                if not inside(poly, p): continue
                bd = boundary_dist(poly, p)
                if bd < bd_min * relax or (bd_max and bd > bd_max): continue
                if any(math.hypot(p[0] - q[0], p[1] - q[1]) < gap * relax for q in out + avoid): continue
                if any(seg_dist(p, a, b) < path_gap * relax for a, b in paths): continue
                out.append(p)
            x += 0.1
    return out

districts, islands = [], []
geocoded_buildings = [0, 0]  # [地理編碼落點數, 建築總數]
for i, (id_, d) in enumerate(sorted(D.items(), key=lambda kv: (kv[1]["hub"][1], kv[1]["hub"][0]))):  # 由北到南編號
    color, summary, buildings = make_content(i, id_, d)
    hub = d["hub"]; ports = d.get("ports", [])
    paths = [(hub, p) for p in ports] + rail_segs
    small = d["area"] < SMALL_AREA  # 市中心的小區：間距放寬，否則塞不下真實建築
    # 有可靠地理編碼（district-match 且落在本區）的建築放在真實位置：貼回陸地、離其他點至少 0.6、避開軌道；其餘用隨機落點
    fixed = {}
    for bi, b in enumerate(buildings):
        ll = geo_lonlat(f"building:{d['name']}:{b['name']}", ok=("district-match",))
        if not ll or not inside(d["full"], proj(ll)): continue
        q, did = snap(proj(ll))
        if did != id_: continue
        others = [hub] + ports + station_pts + poi_pts_raw + list(fixed.values())
        q, did, ok = spread(q, did, others, gap=0.55 if small else 0.6, floor=0.5 if small else 0.6)
        if ok and did == id_ and not any(seg_dist(q, a, b2) < 0.35 for a, b2 in rail_segs): fixed[bi] = tuple(q)
    # 水庫的壩體建築最後才依壩的真實座標放到湖岸邊；沒有地理編碼的壩不參與隨機取樣（取樣的亂數消耗與改版前一致）
    dam_new = {bi for bi, b in enumerate(buildings) if b["model"] == "dam" and b["name"] in dam_at and bi not in fixed}
    dam_new |= {bi for bi, b in enumerate(buildings) if pins.get(f"{d['name']}:{b['name']}", {}).get("new") and bi not in fixed}  # 後加的真實位置建築同樣不參與取樣
    rand = sample(d["poly"], hub, [hub] + ports + station_pts + poi_pts_raw + list(fixed.values()), paths, len(buildings) - len(fixed) - len(dam_new), 0.32 if small else 0.6, None, 0.6 if small else 1.1, 0.35 if small else 0.6)
    slots, kept, dropped = [], [], []
    for bi, b in enumerate(buildings):
        if bi in fixed: slots.append(fixed[bi]); kept.append({**b, "geocoded": True})
        elif bi in dam_new: slots.append(None); kept.append({**b, "geocoded": True})
        elif rand: slots.append(rand.pop(0)); kept.append({**b, "geocoded": False})
        else: dropped.append(b["name"])
    if dropped: print(f"WARN {d['name']} 只放得下 {len(kept)}/{len(buildings)} 棟，略過：{dropped}")
    if small:  # 後放的建築（None）不參與推開
        moved_r = iter(relax([q for q in slots if q is not None], d["poly"], [hub] + ports + station_pts + poi_pts_raw, rail_segs, d["name"]))
        slots = [None if q is None else next(moved_r) for q in slots]
    buildings = kept
    geocoded_buildings[0] += len(fixed); geocoded_buildings[1] += len(kept)
    n_trees = max(2, min(16, int(d["area"] / 3.2)))
    slots_raw = [q for q in slots if q is not None]
    trees = sample(d["poly"], hub, [hub] + ports + slots_raw + station_pts + poi_pts_raw, paths, n_trees, 0.3, 0.9, 0.8, 0.5, tries=800)
    # ── 後處理（不動亂數）：壩放到湖岸、湖裡的建築推到岸邊、被搬走的景點或壩壓到的建築讓開；樹在湖裡或壓到建築就拿掉 ──
    gap = 0.55 if small else 0.6
    others = lambda k: [hub] + ports + station_pts + poi_pts + [q for j, q in enumerate(slots) if j != k and q is not None]
    # 注意：這裡在模組層級，迴圈變數不能叫 k（k 是投影比例尺，proj 會用到）
    dam_k = [bk for bk, b in enumerate(buildings) if b["model"] == "dam" and b["name"] in dam_at]
    for bk in dam_k:
        nm = buildings[bk]["name"]
        q = dry(dam_at[nm], id_, others(bk), gap, m=DAM_GAP, margin=0.3, radius=8)
        if q is None: raise SystemExit(f"{nm} 的壩找不到湖岸空地")
        print(f"壩 {nm}：{d['name']} ({q[0]:.2f}, {q[1]:.2f})，離湖岸上的壩址 {math.hypot(q[0] - dam_at[nm][0], q[1] - dam_at[nm][1]):.2f} 單位")
        slots[bk] = q
    pin_k = [bk for bk, b in enumerate(buildings) if f"{d['name']}:{b['name']}" in pins]
    pin_gap = {}  # 每棟真實位置建築實際用的間距（小區可能放寬），附近建築讓位時用同一個
    for bk in pin_k:
        nm = buildings[bk]["name"]; pin = pins[f"{d['name']}:{nm}"]
        want = proj((pin["lon"], pin["lat"]))
        # 先找不用推開別人的空地：市區小區的模型會依離鄰居的距離自動縮小（world.js 的 fitScale），所以間距可以從 gap 逐步放寬到 0.4；
        # 都離真實座標超過 1 單位，才讓它優先占位、附近的隨機落點建築讓開
        q = None
        for g2 in ([gap, 0.5, 0.45, 0.4] if small else [gap]):
            c2 = dry(want, id_, others(bk), g2, margin=0.15 if small else 0.4, radius=1.0)
            if c2 is not None: q = c2; pin_gap[bk] = g2; break
        if q is None:
            hard = [hub] + ports + station_pts + poi_pts + [slots[j] for j, bb in enumerate(buildings) if j != bk and slots[j] is not None and bb.get("geocoded")]
            q = dry(want, id_, hard, gap, margin=0.15 if small else 0.4, radius=6)
        if q is None: raise SystemExit(f"{nm} 找不到空地")
        print(f"真實位置 {d['name']} {nm}：離真實座標 {math.hypot(q[0] - want[0], q[1] - want[1]):.2f} 單位")
        slots[bk] = q; buildings[bk]["geocoded"] = True  # 卡片不再標「位置為區內示意」
    movers = [(m, gap) for m in poi_moved + [slots[bk] for bk in dam_k]] + [(slots[bk], pin_gap.get(bk, gap)) for bk in pin_k]
    for bk, q in enumerate(slots):
        if bk in dam_k or bk in pin_k: continue
        if wet(q) or any(math.hypot(q[0] - m[0], q[1] - m[1]) < g2 - 1e-6 for m, g2 in movers):
            q2 = dry(q, id_, others(bk), gap)
            if q2 is None: print(f"WARN {d['name']} {buildings[bk]['name']} 在湖裡，附近找不到乾地"); continue
            print(f"建築 {d['name']} {buildings[bk]['name']} {'在湖裡' if wet(q) else '讓位'}，移動 {math.hypot(q2[0] - q[0], q2[1] - q[1]):.2f} 單位")
            slots[bk] = q2
    trees_raw = trees
    tree_attr = [(round(rnd.uniform(0.35, 0.6), 2), "cone" if rnd.random() < 0.5 else "round") for _ in trees_raw]  # 先替每棵樹抽完大小與樹形，拿掉樹才不會影響後面的亂數
    moved = poi_moved + [q for q in slots if q not in slots_raw]  # 這次被搬動的建築與景點；其他的照舊，不重新檢查
    keep_t = [not wet(t, TREE_GAP) and all(math.hypot(t[0] - o[0], t[1] - o[1]) >= 0.45 for o in moved) for t in trees_raw]
    trees = [[t[0], t[1], a[0], a[1]] for t, a, ok in zip(trees_raw, tree_attr, keep_t) if ok]
    if len(trees) < len(trees_raw): print(f"樹 {d['name']}：拿掉 {len(trees_raw) - len(trees)} 棵（在湖裡或壓到建築）")
    districts.append({
        "id": id_, "name": d["name"],
        "polygon": [[round(x, 3), round(z, 3)] for x, z in d["poly"]],
        "hub": [round(hub[0], 3), round(hub[1], 3)], "hubClear": round(d["hubClear"], 3),
        "slots": [[round(x, 3), round(z, 3)] for x, z in slots],
        "trees": [[round(x, 3), round(z, 3), sz, kind] for x, z, sz, kind in trees],
        "neighbors": d.get("neighbors", []), "area": round(d["area"], 2),
        "population": pop_src.get(d["name"], 10),
        "_slots_raw": slots_raw, "_trees_raw": [tuple(t) for t in trees_raw], "_moved": moved,
    })
    islands.append({"id": id_, "number": i + 1, "name": d["name"], "color": color, "summary": summary, "buildings": buildings})
print(f"geocoded buildings {geocoded_buildings[0]}/{geocoded_buildings[1]}")

# ── 農田：郊區各放幾塊矩形田地 [x, z, 寬, 深, 旋轉]，顏色由 fields.js 依 data/crops.json 的作物與日期決定 ──
NO_FIELDS = ("中西區", "東區", "南區", "北區", "安平區", "安南區", "永康區", "仁德區", "歸仁區")  # 市區六區與都會化的區不放田
frnd = random.Random(11)  # 獨立的亂數序列，不影響建築與樹的 rnd
def rect_corners(x, z, w, d, ry):
    """矩形四角的世界座標（three.js 繞 y 軸旋轉 ry：x' = x·cos + z·sin，z' = −x·sin + z·cos）。"""
    c, s = math.cos(ry), math.sin(ry)
    return [(x + lx * c + lz * s, z - lx * s + lz * c) for lx, lz in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]
def rect_hits(x, z, w, d, ry, p, margin):
    """點 p 落在矩形往外擴 margin 的範圍內（換到矩形的局部座標判斷）。"""
    c, s = math.cos(ry), math.sin(ry); dx, dz = p[0] - x, p[1] - z
    return abs(dx * c - dz * s) < w / 2 + margin and abs(dx * s + dz * c) < d / 2 + margin
def sample_fields(dd, d):
    """在區內隨機放田：四角都在區內、中心離區界 ≥ 0.6、離建築／車站／景點 ≥ 1.2、離動線與鐵路 ≥ 0.8、
    避開 hub 廣場（world.js 的廣場半徑 min(hubClear·0.75, 1.1) 再加田的半寬）、田面不壓到樹（≥ 0.5）、田與田不重疊。找不到就逐步放寬距離。"""
    poly, hub = d["poly"], d["hub"]
    plaza = min(d["hubClear"] * 0.75, 1.1) + 1.0
    paths = [(hub, p) for p in d.get("ports", [])] + rail_segs
    avoid = [tuple(s) for s in dd["_slots_raw"]] + station_pts + poi_pts_raw  # 改版前的位置：田的亂數消耗不變，最後再濾掉壓到湖或建築的田
    trees = [(t[0], t[1]) for t in dd["_trees_raw"]]
    n = min(10, 4 + int((d["area"] - 20) / 25))  # 面積 20 → 4 塊，每多 25 單位² 多一塊，最多 10 塊
    xs = [p[0] for p in poly]; zs = [p[1] for p in poly]
    out = []
    for relax in (1.0, 0.8, 0.6, 0.45, 0.3):  # 細長的區放不下就逐步縮短距離，田也偏小
        for _ in range(3000):
            if len(out) >= n: break
            x, z = frnd.uniform(min(xs), max(xs)), frnd.uniform(min(zs), max(zs))
            w, dp_, ry = frnd.uniform(0.9, 0.9 + 0.7 * relax), frnd.uniform(0.7, 0.7 + 0.5 * relax), frnd.uniform(-0.35, 0.35)
            if not inside(poly, (x, z)) or boundary_dist(poly, (x, z)) < 0.6 * relax: continue
            corners = rect_corners(x, z, w, dp_, ry)
            if not all(inside(poly, c) for c in corners): continue
            if math.hypot(x - hub[0], z - hub[1]) < plaza * relax: continue
            if any(math.hypot(x - q[0], z - q[1]) < 1.2 * relax for q in avoid): continue
            if any(seg_dist((x, z), a, b) < 0.8 * relax or any(seg_dist(c, a, b) < 0.25 for c in corners) for a, b in paths): continue
            if any(rect_hits(x, z, w, dp_, ry, tq, 0.5 * relax) for tq in trees): continue
            if any(math.hypot(x - f[0], z - f[1]) < (math.hypot(w, dp_) + math.hypot(f[2], f[3])) / 2 + 0.15 for f in out): continue  # 半對角線相加：田不重疊
            out.append([round(x, 3), round(z, 3), round(w, 2), round(dp_, 2), round(ry, 3)])
        if len(out) >= n: break
    if len(out) < 4: print(f"WARN {dd['name']} 只放得下 {len(out)}/{n} 塊田")
    return out
for dd in districts:
    dsrc = D[dd["id"]]
    dd["fields"] = [] if dsrc["area"] < 20 or dd["name"] in NO_FIELDS else sample_fields(dd, dsrc)
    keep = [f for f in dd["fields"] if not any(wet(c, 0.15) for c in rect_corners(*f) + [(f[0], f[1])])
            and not any(rect_hits(*f, q, 0.3) for q in dd["_moved"])]
    if len(keep) < len(dd["fields"]): print(f"田 {dd['name']}：拿掉 {len(dd['fields']) - len(keep)} 塊（壓到湖或建築）")
    dd["fields"] = keep
    del dd["_slots_raw"], dd["_trees_raw"], dd["_moved"]
print("fields", sum(len(dd["fields"]) for dd in districts), "in", sum(1 for dd in districts if dd["fields"]), "districts")

# ── 動線：從相鄰的區挑 7 對，身分輪流 ──
ROLE_TEXT = [("student", "#f1c232", "通學：{a}的學生到{b}上課。"), ("commuter", "#3e7c8c", "通勤：住{a}、在{b}上班的上班族。"),
             ("elder", "#71806a", "健走處方：{a}的長者走到{b}。"), ("researcher", "#4a7fc1", "合作：{a}的研究員到{b}帶科學營。"),
             ("artist", "#7a6fb5", "展演：{a}的藝術家到{b}演出。"), ("family", "#c58b6a", "親子日：{a}的家庭到{b}逛市場。"),
             ("nurse", "#db6a41", "到宅照護：{a}的照護員走訪{b}的長者。")]
name_of = {dd["id"]: dd["name"] for dd in districts}
candidates = sorted(bridges, key=lambda b: -(D[b["a"]]["area"] + D[b["b"]]["area"]))
flows, used = [], set()
for br in candidates:
    if len(flows) == 7: break
    if br["a"] in used or br["b"] in used: continue
    used.update((br["a"], br["b"]))
    role, color, text = ROLE_TEXT[len(flows)]
    flows.append({"id": f"F{len(flows) + 1}", "from": br["a"], "to": br["b"], "walker": role, "carry": color, "text": text.format(a=name_of[br["a"]], b=name_of[br["b"]])})

# ── 活動：綁定景點或建築的位置 ──
events_src = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "events_source.json")))
poi_pos = {po["id"]: (po["pos"], po["district"]) for po in pois}
events = []
def resolve_at(at):
    if "poi" in at:
        return poi_pos[at["poi"]]
    dname, bname = at["building"]
    dd, isl = next((dd, isl) for dd, isl in zip(districts, islands) if dd["name"] == dname)
    idx = next((i for i, b in enumerate(isl["buildings"]) if b["name"] == bname), None)
    if idx is None or idx >= len(dd["slots"]):
        print(f"WARN 活動地點 {dname}{bname} 不在建築清單（可能被略過），改用區中心")
        return dd["hub"], dd["id"]
    return dd["slots"][idx], dd["id"]
for ev in events_src["events"]:
    pos, did = resolve_at(ev["at"])
    entry = {**{k: v for k, v in ev.items() if k not in ("at", "to")}, "pos": pos, "district": did, "hub": D[did]["hub"]}
    if "to" in ev:
        tpos, tdid = resolve_at(ev["to"])
        entry.update({"toPos": tpos, "toDistrict": tdid, "toHub": D[tdid]["hub"]})
    events.append(entry)
json.dump({"events": events}, open(OUT + "/events.json", "w"), ensure_ascii=False, indent=2)
print("events", [(ev["name"], D[ev["district"]]["name"], ev["pos"]) for ev in events])

allx = [p[0] for dd in districts for p in dd["polygon"]]; allz = [p[1] for dd in districts for p in dd["polygon"]]
city = {
    "name": "台南市",
    "source": "g0v/twgeojson twTown1982.topo.json（CC0），內政部 1982 版鄉鎮市區界線；鄉鎮市改稱區，投影後往內縮留水道",
    "unitsPerKm": round(k, 4),
    "projection": {"lon_c": lon_c, "lat_c": lat_c, "km_x": km_x, "km_z": km_z, "k": k, "note": "x = (lon - lon_c) * km_x * k；z = -(lat - lat_c) * km_z * k"},
    "bounds": {"minX": round(min(allx), 2), "maxX": round(max(allx), 2), "minZ": round(min(allz), 2), "maxZ": round(max(allz), 2)},
    "districts": districts, "bridges": bridges, "coast": coast,
}
json.dump(city, open(OUT + "/city.json", "w"), ensure_ascii=False)
json.dump(islands, open(OUT + "/islands.json", "w"), ensure_ascii=False, indent=2)
json.dump(flows, open(OUT + "/flows.json", "w"), ensure_ascii=False, indent=2)
services = []
for sv in rail_src.get("services", []):
    pts, stops = route_points(sv["stations"])
    services.append({**sv, "points": pts, "stops": stops})
json.dump({"stations": stations, "lines": lines, "services": services}, open(OUT + "/rail.json", "w"), ensure_ascii=False)
json.dump({"rivers": rivers, "lakes": [{k_: v for k_, v in lk.items() if k_ != "_bbox"} for lk in lakes]}, open(OUT + "/water_mrt.json", "w"), ensure_ascii=False)
json.dump({"note": poi_src["_note"], "pois": pois}, open(OUT + "/poi.json", "w"), ensure_ascii=False, indent=2)
print("pois", [(po["name"], D[po["district"]]["name"]) for po in pois])
print("stations", [(st["name"], D[st["district"]]["name"]) for st in stations])
for dd, isl in zip(districts, islands):
    print(f"{dd['number'] if 'number' in dd else isl['number']:2d} {dd['name']:4s} pts={len(dd['polygon']):3d} area={dd['area']:6.2f} hubClear={dd['hubClear']:.2f} buildings={len(isl['buildings'])} trees={len(dd['trees'])} nb={len(dd['neighbors'])}")
print("bridges", len(bridges), "bounds", city["bounds"], "flows", [(f['from'], f['to']) for f in flows])
