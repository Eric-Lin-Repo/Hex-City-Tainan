"""把 Open-Meteo 的經緯度高程格點（tools/raw/elevation_grid.json）重新取樣成世界座標的高度場，寫到 data/terrain.json。

用法（在專案根目錄）：python3 -I tools/build_terrain.py

步驟：
1. 檢查原始格點有沒有被 API 限流而補零的 100 點區塊（對齊 100 的整段零），有就用 curl 重抓那幾塊並改寫原始檔。
2. 依 data/city.json 的投影把世界座標對回經緯度，雙線性取樣公尺高程。
3. 公尺 → 世界高度：40 m 以下為 0，以上用 1.6 * ((m - 40) / 1200) ** 0.7，上限 2.4。
4. 不在任何行政區輪廓內的點高度歸 0；輪廓內離邊界 0.8 單位以內線性漸弱，避免島緣出現垂直落差。
"""
import json, os, subprocess, sys, time, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GRID_PATH = os.path.join(HERE, "raw", "elevation_grid.json")
CITY_PATH = os.path.join(ROOT, "data", "city.json")
OUT_PATH = os.path.join(ROOT, "data", "terrain.json")

SPACING = 0.9        # 高度場格距（世界單位）
MARGIN = 1.8         # 高度場比城市 bounds 多留的邊
FLOOR_M = 40.0       # 這個高度以下視為平原
SCALE_M = 750.0      # 曲線的分母（調小讓台南的淺山更明顯）
CURVE_GAIN = 2.9     # 曲線的倍率
CURVE_POW = 0.7      # 曲線的指數（<1：低山也看得見）
MAX_H = 4.4          # 世界高度上限
FEATHER = 1.45       # 輪廓邊界內的漸弱距離
CHUNK = 100          # Open-Meteo 每次最多 100 點
UA = "hex-city-demo/1.0"


# ── 原始格點的缺口偵測與補抓 ──
def http_get(url, timeout=60):
    """用 curl 取代 urllib（本機 Python 沒有 SSL 憑證）。"""
    r = subprocess.run(["curl", "-sL", "--max-time", str(timeout), "-A", UA, url], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError("curl failed " + str(r.returncode))
    return r.stdout


def find_gaps(elev):
    """回傳被補零的區塊起點：對齊 100 的整段都是 0（或 None）。每列橫跨整個東西向，東側必有山，整段零不可能是真的海。"""
    gaps = []
    for k in range(0, len(elev), CHUNK):
        chunk = elev[k:k + CHUNK]
        if all(v is None or v == 0 for v in chunk):
            gaps.append(k)
    return gaps


def refetch_gaps(grid):
    lons, lats, elev = grid["lons"], grid["lats"], grid["elevation"]
    pts = [(la, lo) for la in lats for lo in lons]
    gaps = find_gaps(elev)
    if not gaps:
        return 0
    print(f"raw grid: {len(gaps)} zero-filled chunk(s) at {gaps}, refetching", flush=True)
    done = 0
    for k in gaps:
        chunk = pts[k:k + CHUNK]
        url = "https://api.open-meteo.com/v1/elevation?" + urllib.parse.urlencode({
            "latitude": ",".join(str(p[0]) for p in chunk),
            "longitude": ",".join(str(p[1]) for p in chunk),
        })
        delay = 3
        for attempt in range(5):
            try:
                body = json.loads(http_get(url))
                vals = body["elevation"]
                if len(vals) != len(chunk):
                    raise RuntimeError(f"got {len(vals)} values for {len(chunk)} points")
                elev[k:k + CHUNK] = [0.0 if v is None else float(v) for v in vals]
                done += 1
                print(f"  chunk {k}: ok, max {max(elev[k:k + CHUNK])} m", flush=True)
                break
            except Exception as e:
                print(f"  chunk {k}: retry {attempt + 1} ({e}), waiting {delay}s", flush=True)
                time.sleep(delay)
                delay *= 2
        else:
            print(f"  chunk {k}: FAILED, left as zeros", flush=True)
        time.sleep(2)
    if done:
        with open(GRID_PATH, "w") as f:
            json.dump(grid, f)
        print(f"rewrote {GRID_PATH}", flush=True)
    return done


# ── 幾何工具 ──
def point_in_poly(poly, x, z):
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            c = not c
        j = i
    return c


def seg_dist(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2)) if l2 else 0.0
    return ((px - (ax + t * dx)) ** 2 + (pz - (az + t * dz)) ** 2) ** 0.5


def boundary_dist(poly, x, z):
    d = float("inf")
    j = len(poly) - 1
    for i in range(len(poly)):
        d = min(d, seg_dist(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]))
        j = i
    return d


class DistrictMask:
    """查一個世界座標點落在哪個行政區、離該區邊界多遠；用 bbox 先篩掉不相干的區。"""

    def __init__(self, districts, coast=None):
        self.items = []
        for d in districts:
            poly = d["polygon"]
            xs = [p[0] for p in poly]
            zs = [p[1] for p in poly]
            self.items.append((min(xs), max(xs), min(zs), max(zs), poly))
        # 區與區貼合時只在海岸線漸弱，內陸的區界不留溝；coast 是只屬於一個區的邊界折線
        self.coast = []
        for line in coast or []:
            for a, b in zip(line, line[1:]):
                self.coast.append((min(a[0], b[0]) - FEATHER, max(a[0], b[0]) + FEATHER, min(a[1], b[1]) - FEATHER, max(a[1], b[1]) + FEATHER, a, b))

    def coast_dist(self, x, z):
        best = FEATHER
        for x0, x1, z0, z1, a, b in self.coast:
            if x < x0 or x > x1 or z < z0 or z > z1:
                continue
            d = seg_dist(x, z, a[0], a[1], b[0], b[1])
            if d < best: best = d
        return best

    def weight(self, x, z):
        for x0, x1, z0, z1, poly in self.items:
            if x < x0 or x > x1 or z < z0 or z > z1:
                continue
            if point_in_poly(poly, x, z):
                dist = self.coast_dist(x, z) if self.coast else boundary_dist(poly, x, z)
                return max(0.0, min(1.0, dist / FEATHER))
        return 0.0


class ElevationGrid:
    """經緯度格點的雙線性取樣（公尺）。"""

    def __init__(self, grid):
        self.lons, self.lats, self.e = grid["lons"], grid["lats"], grid["elevation"]
        self.w, self.h = len(self.lons), len(self.lats)
        self.lon0, self.lat0 = self.lons[0], self.lats[0]
        self.dlon = (self.lons[-1] - self.lon0) / (self.w - 1)
        self.dlat = (self.lats[-1] - self.lat0) / (self.h - 1)

    def at(self, i, j):
        i = max(0, min(self.w - 1, i))
        j = max(0, min(self.h - 1, j))
        v = self.e[j * self.w + i]
        return 0.0 if v is None else max(0.0, float(v))

    def sample(self, lon, lat):
        fi = (lon - self.lon0) / self.dlon
        fj = (lat - self.lat0) / self.dlat
        if fi < 0 or fj < 0 or fi > self.w - 1 or fj > self.h - 1:
            return 0.0
        i, j = int(fi), int(fj)
        tx, tz = fi - i, fj - j
        a = self.at(i, j) * (1 - tx) + self.at(i + 1, j) * tx
        b = self.at(i, j + 1) * (1 - tx) + self.at(i + 1, j + 1) * tx
        return a * (1 - tz) + b * tz


def metres_to_world(m):
    if m <= FLOOR_M:
        return 0.0
    return min(MAX_H, CURVE_GAIN * ((m - FLOOR_M) / SCALE_M) ** CURVE_POW)


def main():
    with open(GRID_PATH) as f:
        grid = json.load(f)
    refetched = refetch_gaps(grid)
    with open(CITY_PATH) as f:
        city = json.load(f)
    P, B = city["projection"], city["bounds"]
    kx, kz = P["km_x"] * P["k"], P["km_z"] * P["k"]
    to_lon = lambda x: x / kx + P["lon_c"]
    to_lat = lambda z: -z / kz + P["lat_c"]

    x0, z0 = B["minX"] - MARGIN, B["minZ"] - MARGIN
    nx = int((B["maxX"] + MARGIN - x0) / SPACING) + 2
    nz = int((B["maxZ"] + MARGIN - z0) / SPACING) + 2
    grid_m = ElevationGrid(grid)
    mask = DistrictMask(city["districts"], city.get("coast"))

    heights = []
    max_h = 0.0
    for jz in range(nz):
        z = z0 + jz * SPACING
        for ix in range(nx):
            x = x0 + ix * SPACING
            w = mask.weight(x, z)
            h = metres_to_world(grid_m.sample(to_lon(x), to_lat(z))) * w if w > 0 else 0.0
            h = round(h, 3)
            heights.append(h)
            max_h = max(max_h, h)

    out = {"x0": round(x0, 3), "z0": round(z0, 3), "dx": SPACING, "dz": SPACING, "nx": nx, "nz": nz, "maxH": max_h, "heights": heights}
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    raised = sum(1 for h in heights if h > 0)
    print(f"terrain {nx} x {nz} (dx={SPACING}) maxH={max_h} raised={raised}/{len(heights)} refetched_chunks={refetched} -> {OUT_PATH}", flush=True)


if __name__ == "__main__":
    main()
