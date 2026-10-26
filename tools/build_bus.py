"""把 tools/raw/osm_bus.json（fetch_bus.py 抓的 OSM 六色公車 relation）轉成 HEX CITY 用的公車資料：
  data/bus.json           6 條幹線（首頁就載入）
  data/bus_branches.json  其餘支線（側欄打開該顏色時才載入）
只讀 raw 檔與 data/city.json 的投影參數，可離線重跑。用法：python3 -I tools/build_bus.py

每條路線（ref，例如「藍幹線」「綠17」「黃10-1」）底下有多個行駛型態（pattern）：正線往返程、繞駛、延駛、預約、環狀。
每個 pattern 是一條折線（世界座標）＋依序停靠的站牌；站牌保留 OSM 的全部真實站位（同站的 stop／platform 只留一個）。
出了台南的路段（例如往高鐵嘉義站）在區界外會懸在海上，只保留落在陸地上最長的一段；大半不在台南的路線（高雄的紅 6x、7x）整條排除。"""
import json, math, os, re, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "tools", "raw", "osm_bus.json")
CITY = os.path.join(ROOT, "data", "city.json")
OUT_TRUNK = os.path.join(ROOT, "data", "bus.json")
OUT_BRANCH = os.path.join(ROOT, "data", "bus_branches.json")
# 六色：顏色代號、中文字、英文、路線色（幹線與支線同色系）
COLORS = {"藍": ("blue", "Blue", "#1f6fd1"), "綠": ("green", "Green", "#2e9e4f"), "紅": ("red", "Red", "#d8342c"),
          "橘": ("orange", "Orange", "#ef8a1e"), "黃": ("yellow", "Yellow", "#e3b91c"), "棕": ("brown", "Brown", "#8a5a2b")}
EN_PREFIX = {"藍": "B", "綠": "G", "紅": "R", "橘": "O", "黃": "Y", "棕": "BR"}  # 跟 TDX 的 RouteName.En 一致（B1、G17、BR1）
DP_EPS = 0.03        # Douglas–Peucker 容許誤差（世界單位，約 30 公尺）
LAND_TOL = 0.4       # 區界是簡化過的多邊形，離區界 0.4 以內的路段仍算在陸地上
MIN_LAND = 0.5       # 落在台南陸地上的比例低於此就整條排除（高雄公車）
STOP_SNAP = 0.35     # 站牌離路線超過這個距離就不收（OSM 偶爾把對向或別條路的站牌掛進來）

raw = json.load(open(RAW, encoding="utf-8"))
city = json.load(open(CITY, encoding="utf-8"))
P = city["projection"]
proj = lambda lon, lat: ((lon - P["lon_c"]) * P["km_x"] * P["k"], -(lat - P["lat_c"]) * P["km_z"] * P["k"])
polys = [d["polygon"] for d in city["districts"]]
relations = [e for e in raw["elements"] if e["type"] == "relation"]
node_tags = {e["id"]: e.get("tags", {}) for e in raw["elements"] if e["type"] == "node"}

def inside(poly, p):
    x, z = p; c = False; n = len(poly)
    for i in range(n):
        x0, z0 = poly[i]; x1, z1 = poly[(i + 1) % n]
        if (z0 > z) != (z1 > z) and x < (x1 - x0) * (z - z0) / (z1 - z0) + x0: c = not c
    return c
def seg_proj(p, a, b):
    """p 投到線段 ab 上：回 (距離, t)。"""
    dx, dz = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dz * dz
    t = 0 if L2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz), t
def on_land(p):
    if any(inside(poly, p) for poly in polys): return True
    return any(seg_proj(p, poly[i], poly[(i + 1) % len(poly)])[0] < LAND_TOL for poly in polys for i in range(len(poly)))

def dp(points, eps):
    """Douglas–Peucker 簡化，保留端點（迭代版，長路線不會遞迴太深）。"""
    if len(points) < 3: return points
    keep = [False] * len(points); keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        best, bi = 0, -1
        for i in range(a + 1, b):
            d = seg_proj(points[i], points[a], points[b])[0]
            if d > best: best, bi = d, i
        if best > eps: keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(points, keep) if k]

def chain_ways(members, window=15):
    """把成員 way 串成一條折線，用共用節點接：
    - 下一條 way 含有目前尾端的節點才接，從那個節點往「能接到再下一條」的方向走（中途接入、圓環都能處理）；
    - 成員順序有小錯亂時，往後 window 條找含尾端節點的 way 先接；
    - 真的接不上（OSM 缺路段）才直線跳過，回報缺口。
    回傳 (經緯度折線, 缺口公里數列表)。"""
    ways = [[(p["lon"], p["lat"]) for p in m["geometry"]] for m in members if m["type"] == "way" and m.get("geometry")]
    if not ways: return [], []
    km = lambda a, b: math.hypot((a[0] - b[0]) * P["km_x"], (a[1] - b[1]) * P["km_z"])
    def walk(w, i, nxt):
        """從 w 的第 i 個節點出發，回傳往下走的節點序列（不含起點）。nxt 是再下一條 way（決定方向），閉合的 way 繞到接得上 nxt 的節點為止。"""
        closed = len(w) > 2 and w[0] == w[-1]
        ring = w[:-1] if closed else w
        targets = set(nxt) if nxt else set()
        if closed:
            n = len(ring); i %= n
            fwd = [ring[(i + k) % n] for k in range(1, n + 1)]
            bwd = [ring[(i - k) % n] for k in range(1, n + 1)]
            cut = lambda seq: next((seq[:k + 1] for k, q in enumerate(seq) if q in targets), seq)
            a, b = cut(fwd), cut(bwd)
            return a if len(a) <= len(b) else b  # 圓環取較短的那一邊（順向行駛的那邊通常較短）
        fwd, bwd = w[i + 1:], w[:i][::-1]
        if not fwd: return bwd
        if not bwd: return fwd
        if targets:  # 中途接入：往接得到下一條的那頭走
            if fwd[-1] in targets or any(q in targets for q in fwd): return fwd
            if bwd[-1] in targets or any(q in targets for q in bwd): return bwd
        return fwd if len(fwd) >= len(bwd) else bwd
    # 先把接得上的 way 串成幾段（run）：OSM 的成員常整段倒序或前後段對調，段內用共用節點接
    runs, rest = [], list(ways)
    while rest:
        w0 = rest.pop(0); nxt = rest[0] if rest else None
        if nxt and w0[0] in nxt and w0[-1] not in nxt: w0 = w0[::-1]
        run = list(w0)
        while rest:
            k = next((k for k in range(min(window, len(rest))) if run[-1] in rest[k]), None)
            if k is None: break
            w = rest.pop(k)
            run += walk(w, w.index(run[-1]), rest[0] if rest else None)
        runs.append(run)
    # 再把各段拼起來：每個端點都試著當起點，貪婪接上端點最近的下一段（必要時反轉），取缺口總長最短的接法；
    # 平手時取起點離第一個站牌近的（OSM 的站牌順序通常是對的）
    stops = [(m["lon"], m["lat"]) for m in members if m["type"] == "node" and m.get("role", "").startswith(("stop", "platform"))]
    def assemble(i, e):
        left = [r for j, r in enumerate(runs) if j != i]
        pts = list(runs[i] if e == 0 else runs[i][::-1]); gaps = []
        while left:
            _, j, e2 = min(((km(pts[-1], r[x]), j, x) for j, r in enumerate(left) for x in (0, -1)))
            r = left.pop(j); r = r if e2 == 0 else r[::-1]
            g = km(pts[-1], r[0])
            if g > 0.02: gaps.append((len(pts) - 1, g))  # (缺口前一點的索引, 公里)
            pts += r[1:] if r[0] == pts[-1] else r
        return pts, gaps
    tries = [(assemble(i, e), (km(stops[0], runs[i][e]) if stops else 0)) for i in range(len(runs)) for e in (0, -1)]
    (pts, gaps), _ = min(tries, key=lambda t: (round(sum(g for _, g in t[0][1]), 1), t[1]))
    return pts, gaps

# ── 補缺口：OSM 的 relation 少收了路段（缺口附近通常還有站牌），用 OSRM 沿道路補起來。
#    build_bus.py 把需要的缺口寫到 tools/raw/bus_gaps_todo.json，tools/fetch_bus_gaps.py 查好存在 bus_gap_routes.json，之後離線重跑。
GAP_MIN = 0.3  # 公里，小於這個的缺口直接直線接
GAP_CACHE = os.path.join(ROOT, "tools", "raw", "bus_gap_routes.json")
GAP_TODO = os.path.join(ROOT, "tools", "raw", "bus_gaps_todo.json")
gap_cache = json.load(open(GAP_CACHE, encoding="utf-8")) if os.path.exists(GAP_CACHE) else {}
gap_todo = {}
def gap_key(way):
    return "|".join(f"{lon:.6f},{lat:.6f}" for lon, lat in way)
def fill_gaps(lonlat, gaps, stop_ll):
    """把大缺口換成沿道路的路線；途經缺口範圍內、離已知路段較遠的站牌（依在缺口上的位置排序）。回傳 (折線, 沒補到的缺口)。"""
    out, last, missing = [], 0, []
    km = lambda a, b: math.hypot((a[0] - b[0]) * P["km_x"], (a[1] - b[1]) * P["km_z"])
    for idx, g in gaps:
        out += lonlat[last:idx + 1]; last = idx + 1
        if g < GAP_MIN: continue
        a, b = lonlat[idx], lonlat[idx + 1]
        ax, az, bx, bz = a[0] * P["km_x"], a[1] * P["km_z"], b[0] * P["km_x"], b[1] * P["km_z"]
        via = []
        for s in stop_ll:
            d, t = seg_proj((s[0] * P["km_x"], s[1] * P["km_z"]), (ax, az), (bx, bz))
            if 0.02 < t < 0.98 and d < max(1.5, g * 0.4) and min(km(s, q) for q in lonlat[::3]) > 0.15: via.append((t, s))
        way = [a] + [s for _, s in sorted(via)] + [b]
        key = gap_key(way)
        if key in gap_cache and gap_cache[key]: out += [tuple(q) for q in gap_cache[key][1:-1]]
        else: gap_todo[key] = way; missing.append(g)
    out += lonlat[last:]
    return out, missing

def longest_land_run(world):
    """只留落在陸地上最長的連續一段（出了台南的頭尾切掉），回傳 (起, 迄) 索引與陸地比例。"""
    flags = [on_land(p) for p in world]
    best, cur = (0, -1), None
    for i, f in enumerate(flags + [False]):
        if f and cur is None: cur = i
        if not f and cur is not None:
            if i - 1 - cur > best[1] - best[0]: best = (cur, i - 1)
            cur = None
    return best, sum(flags) / max(1, len(flags))

def kind_of(name):
    """行駛型態：main 正線、detour 繞駛、extension 延駛、reserve 預約、special 假日／小黃、loop 環狀。"""
    inner = re.search(r"\((.*)\)", name); s = inner.group(1) if inner else name
    if "預約" in s: return "reserve"
    if "假日" in s: return "special"
    if "時針" in s: return "loop"
    if "繞" in s: return "detour"
    if "延駛" in s: return "extension"
    return "main"
def dir_of(name):
    if "返程" in name or "逆時針" in name: return 1
    m = re.search(r":\s*(.+?)\s*=>", name)  # 「紅70A: 捷運南岡山站 => 田寮區公所」這種寫法（高雄線，會被排除）
    return 0

def label_of(name, tags):
    """卡片用的型態說明：括號內去掉「_往程」等方向字。"""
    inner = re.search(r"\((.*)\)", name)
    s = inner.group(1) if inner else ""
    s = re.sub(r"_(往|去|返)程$", "", s)
    return s or f"{tags.get('from', '')}→{tags.get('to', '')}"

def terminal(n):
    """「佳里站」→「佳里」；轉運站、車站保留原名。"""
    return n[:-1] if n.endswith("站") and not n.endswith(("轉運站", "車站")) else n

# ── 站牌表：OSM node id → 全域編號；同名而且很近的 stop／platform 合併成一站 ──
stop_list, stop_index = [], {}
def stop_id(ref, lon, lat):
    if ref in stop_index: return stop_index[ref]
    t = node_tags.get(ref, {})
    x, z = proj(lon, lat)
    name = t.get("name") or t.get("name:zh") or "站牌"
    stop_index[ref] = len(stop_list)
    stop_list.append({"name": name, "en": t.get("name:en") or "", "x": round(x, 3), "z": round(z, 3)})
    return stop_index[ref]

VIA_MIN = 0.9  # 台南境內的站牌收不到這個比例，表示 OSM 路段順序亂了，改用 OSRM 依序經過每個站牌重畫
def build_pattern(rel, via=False):
    tags = rel.get("tags", {}); name = tags.get("name", "")
    stop_ll = [(m["lon"], m["lat"]) for m in rel["members"] if m["type"] == "node" and m.get("role", "").startswith(("stop", "platform"))]
    if via:  # 經過台南境內每個站牌（同名相鄰的只取一個）的道路路線
        seq = []
        for m in rel["members"]:
            if m["type"] != "node" or not m.get("role", "").startswith(("stop", "platform")) or not on_land(proj(m["lon"], m["lat"])): continue
            nm = node_tags.get(m["ref"], {}).get("name")
            if seq and seq[-1][0] == nm: continue
            seq.append((nm, (m["lon"], m["lat"])))
        way = [q for _, q in seq]
        key = "via|" + gap_key(way)
        if not gap_cache.get(key): gap_todo[key] = way; return None, "待查 OSRM"
        lonlat, gaps, missing, filled = [tuple(q) for q in gap_cache[key]], [], [], []
    else:
        lonlat, gaps = chain_ways(rel["members"])
        if len(lonlat) < 2: return None, "沒有路段"
        filled = [g for _, g in gaps if g >= GAP_MIN]
        lonlat, missing = fill_gaps(lonlat, gaps, stop_ll)
    world = [proj(lon, lat) for lon, lat in lonlat]
    (a, b), land = longest_land_run(world)
    if land < MIN_LAND: return None, f"只有 {land:.0%} 在台南"
    pts = dp(world[a:b + 1], DP_EPS)
    if len(pts) < 2: return None, "陸地上的路段太短"
    # 方向檢查：站牌依 OSM 順序投到線上，若大多是往回走，表示整條接反了，翻過來
    def along(q):
        (dd, t), i = min(((seg_proj(q, pts[i], pts[i + 1]), i) for i in range(len(pts) - 1)), key=lambda x: x[0][0])
        return None if dd > STOP_SNAP else i + t
    ds = [d for d in (along(proj(lon, lat)) for lon, lat in stop_ll) if d is not None]
    if sum(1 for u, v in zip(ds, ds[1:]) if v < u) > sum(1 for u, v in zip(ds, ds[1:]) if v > u): pts = pts[::-1]
    cum = [0.0]
    for p, q in zip(pts, pts[1:]): cum.append(cum[-1] + math.dist(p, q))
    # 站牌：依成員順序，投到折線上取沿線距離 d。折返路段（進村再原路出來）同一點會對到兩段，
    # 所以只在「前一站之後」的路段裡找最近的；離線太遠的不收；同名 60 公尺內只留一個
    stops, last_d = [], 0.0
    for m in rel["members"]:
        if m["type"] != "node" or not m.get("role", "").startswith(("stop", "platform")): continue
        sp = proj(m["lon"], m["lat"])
        cands = []
        for i in range(len(pts) - 1):
            if cum[i + 1] < last_d - 0.05: continue
            dist, t = seg_proj(sp, pts[i], pts[i + 1])
            if dist <= STOP_SNAP: cands.append((cum[i] + t * (cum[i + 1] - cum[i]), dist))
        if not cands: continue
        d = min(cands, key=lambda c: (c[1] > 0.08, c[0]))[0]  # 夠近（8 公尺級）的取最前面那段，否則取最近
        sid = stop_id(m["ref"], m["lon"], m["lat"])
        if stops and (sid == stops[-1][0] or stop_list[stops[-1][0]]["name"] == stop_list[sid]["name"] and d - stops[-1][1] < 0.06): continue
        d = max(d, last_d)
        stops.append([sid, round(d, 3)]); last_d = d
    big_gaps = missing
    land_stops = []
    for m in rel["members"]:
        if m["type"] == "node" and m.get("role", "").startswith(("stop", "platform")) and on_land(proj(m["lon"], m["lat"])):
            nm = node_tags.get(m["ref"], {}).get("name")
            if not land_stops or land_stops[-1] != nm: land_stops.append(nm)
    if not via and len(stops) < VIA_MIN * len(land_stops):
        alt, why = build_pattern(rel, via=True)
        if alt: alt["_via"] = f"OSM 路段只收到 {len(stops)}/{len(land_stops)} 站，改依站牌重畫"; return alt, None
        print(f"  {name}：只收到 {len(stops)}/{len(land_stops)} 站，{why}")
    return {"rel": rel["id"], "kind": kind_of(name), "dir": dir_of(name), "label": label_of(name, tags),
            "from": terminal(tags.get("from", "")), "to": terminal(tags.get("to", "")),
            "points": [[round(x, 3), round(z, 3)] for x, z in pts], "length": round(cum[-1], 2), "stops": stops,
            "_via": None, "_gaps": big_gaps, "_filled": len(filled) - len(missing), "_land": land, "_cut": a > 0 or b < len(world) - 1}, None

def ref_key(ref):
    """排序：幹線在前，再依號碼、副線。"""
    if ref.endswith("幹線"): return (0, 0, 0)
    m = re.match(r"^.(\d+)(?:-(\d+))?([A-Z]?)$", ref)
    return (1, int(m.group(1)), int(m.group(2) or 0)) if m else (2, 0, 0)

by_ref = defaultdict(list)
for rel in relations:
    t = rel.get("tags", {})
    if "高雄" in (t.get("network", "") + t.get("operator", "")): continue
    by_ref[t.get("ref", "")].append(rel)

routes, skipped, report = [], [], []
for ref in sorted(by_ref, key=lambda r: (list(COLORS).index(r[0]), ref_key(r))):
    pats = []
    for rel in sorted(by_ref[ref], key=lambda r: r["id"]):
        pat, why = build_pattern(rel)
        if pat: pats.append(pat)
        else: skipped.append(f"{rel['tags'].get('name')}（{why}）")
    if not pats: continue
    pats.sort(key=lambda p: (p["kind"] != "main", p["kind"], p["dir"], p["rel"]))
    mains = [p for p in pats if p["kind"] in ("main", "loop")] or pats[:1]
    p0 = next((p for p in mains if p["dir"] == 0), mains[0])
    color = ref[0]; cid, cen, hexc = COLORS[color]
    trunk = ref.endswith("幹線")
    en = f"{cen} Trunk" if trunk else EN_PREFIX[color] + ref[1:]
    for p in pats:
        if p["_gaps"]: report.append(f"{ref} {p['label']}：OSM 路段缺口 {len(p['_gaps'])} 處沒補到（最大 {max(p['_gaps']):.2f} km，暫以直線接上；跑 tools/fetch_bus_gaps.py）")
        if p["_via"]: report.append(f"{ref} {p['label']}：{p['_via']}")
        if p["_cut"]: report.append(f"{ref} {p['label']}：出了台南的路段已切掉（陸地上 {p['_land']:.0%}）")
    routes.append({"id": ref, "color": cid, "hex": hexc, "trunk": trunk, "name": ref, "en": en,
                   "from": p0["from"], "to": p0["to"],
                   "patterns": [{k: v for k, v in p.items() if not k.startswith("_")} for p in pats]})

# 只輸出用到的站牌，兩個檔各自編號
def pack(rs):
    used = sorted({s for r in rs for p in r["patterns"] for s, _ in p["stops"]})
    remap = {old: new for new, old in enumerate(used)}
    for r in rs:
        for p in r["patterns"]: p["stops"] = [[remap[s], d] for s, d in p["stops"]]
    return [stop_list[i] for i in used]
note = "台南市六色公車（幹線與支線）路線與站牌，資料來自 OpenStreetMap（© OpenStreetMap contributors, ODbL），由 tools/build_bus.py 投影到世界座標。"
colors = {cid: {"zh": zh, "en": en, "hex": hexc} for zh, (cid, en, hexc) in COLORS.items()}
trunks = [r for r in routes if r["trunk"]]; branches = [r for r in routes if not r["trunk"]]
for path, rs in ((OUT_TRUNK, trunks), (OUT_BRANCH, branches)):
    out = {"note": note, "colors": colors, "stops": pack(rs), "routes": rs}
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("寫入", os.path.relpath(path, ROOT), os.path.getsize(path) // 1024, "KB", len(rs), "條路線",
          sum(len(r["patterns"]) for r in rs), "個型態", len(out["stops"]), "個站牌")
json.dump(gap_todo, open(GAP_TODO, "w", encoding="utf-8"), ensure_ascii=False)
print(f"缺口：沿道路補上 {sum(1 for k in gap_cache if gap_cache[k])} 段（快取），待查 {len(gap_todo)} 段（{os.path.relpath(GAP_TODO, ROOT)}）")
print("排除：", len(skipped)); [print("  ", s) for s in skipped]
print("備註：", len(report)); [print("  ", s) for s in report]
