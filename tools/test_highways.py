"""高速公路資料檢查：data/highways.json 的路段鏈是否接得起來、在台南陸地上，各路線長度合理，交流道有名稱，
建築、景點、樹、田、區中心都沒有壓到公路。從專案根目錄執行：python3 -I tools/test_highways.py"""
import collections, json, math, os, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def load(n):
    with open(os.path.join(ROOT, "data", n), encoding="utf-8") as fp: return json.load(fp)
KM = {"nh1": (50, 75), "nh3": (50, 80), "nh8": (10, 20), "pr61": (15, 45), "pr84": (25, 45), "pr86": (10, 25), "ring": (2, 12)}  # 台南境內大約幾公里（單向）


def inside(poly, p):
    x, z = p; c = False; n = len(poly)
    for i in range(n):
        x0, z0 = poly[i]; x1, z1 = poly[(i + 1) % n]
        if (z0 > z) != (z1 > z) and x < (x1 - x0) * (z - z0) / (z1 - z0) + x0: c = not c
    return c


def seg_dist(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dz * dz
    t = 0 if L2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)


class HighwaysTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hw, cls.city = load("highways.json"), load("city.json")
        cls.S = cls.city.get("scale", 1.0)
        segs = [(p[:2], q[:2]) for c in cls.hw["chains"] for p, q in zip(c["pts"], c["pts"][1:])]
        cls.grid = collections.defaultdict(list)
        for a, b in segs:
            for i in range(int(min(a[0], b[0]) // 4) - 1, int(max(a[0], b[0]) // 4) + 2):
                for j in range(int(min(a[1], b[1]) // 4) - 1, int(max(a[1], b[1]) // 4) + 2): cls.grid[(i, j)].append((a, b))
        cls.road = lambda self_, p: min((seg_dist(p, a, b) for a, b in cls.grid.get((int(p[0] // 4), int(p[1] // 4)), [])), default=99)

    def test_routes(self):
        self.assertEqual({r["id"] for r in self.hw["routes"]}, set(KM))
        for r in self.hw["routes"]:
            for k in ("name", "en", "ja", "color", "kind"): self.assertTrue(r.get(k), f"{r['id']} 缺 {k}")

    def test_chains_connect(self):
        ch = self.hw["chains"]; ids = {r["id"] for r in self.hw["routes"]}
        for i, c in enumerate(ch):
            self.assertIn(c["route"], ids)
            self.assertGreaterEqual(len(c["pts"]), 2)
            for j in c["next"]:
                self.assertTrue(0 <= j < len(ch))
                self.assertLess(math.dist(c["pts"][-1][:2], ch[j]["pts"][0][:2]), 1e-3, f"鏈 {i} 的終點接不上鏈 {j} 的起點")
            for p, q in zip(c["pts"], c["pts"][1:]): self.assertLessEqual(math.dist(p[:2], q[:2]), 0.5 + 1e-3, "點距太大，前端貼地形會穿進山坡")
        dead_main = sum(1 for c in ch if not c["link"] and not c["next"])
        self.assertLessEqual(dead_main, 15, "主線斷頭太多：路網可能沒接好")

    def test_on_land(self):
        polys = [d["polygon"] for d in self.city["districts"]]
        pts = [p for c in self.hw["chains"] for p in c["pts"][::5]]
        off = [p for p in pts if not any(inside(poly, p[:2]) for poly in polys)]
        self.assertLess(len(off) / len(pts), 0.02, f"{len(off)} 個點在台南陸地外")

    def test_route_lengths(self):
        k = self.city["unitsPerKm"]
        for rid, (lo, hi) in KM.items():
            units = sum(math.dist(p[:2], q[:2]) for c in self.hw["chains"] if c["route"] == rid and not c["link"] for p, q in zip(c["pts"], c["pts"][1:]))
            km = units / 2 / k
            self.assertTrue(lo <= km <= hi, f"{rid} 台南境內約 {km:.1f} 公里，預期 {lo}～{hi}")

    def test_junctions(self):
        js = self.hw["junctions"]
        self.assertGreaterEqual(len(js), 40)
        for j in js:
            self.assertTrue(j["name"] and j["en"] and j["ja"])
            self.assertLess(self.road(j["pos"]), 0.5, f"{j['name']} 不在公路上")

    def test_nothing_on_road(self):
        poi = load("poi.json")["pois"]
        isl = {i["id"]: i for i in load("islands.json")}
        checks = [("建築", isl[d["id"]]["buildings"][i]["name"], s, 0.5) for d in self.city["districts"] for i, s in enumerate(d["slots"])]
        checks += [("景點", p["name"], p["pos"], 0.5) for p in poi]
        checks += [("樹", d["name"], t[:2], 0.4) for d in self.city["districts"] for t in d["trees"]]
        checks += [("田", d["name"], f[:2], 0.4 + math.hypot(f[2], f[3]) / 2 * 0.5) for d in self.city["districts"] for f in d["fields"]]
        checks += [("區中心", d["name"], d["hub"], 1.0) for d in self.city["districts"]]
        bad = [(kind, name, round(self.road(p), 2)) for kind, name, p, gap in checks if self.road(p) < gap]
        self.assertEqual(bad, [], "壓到公路")


if __name__ == "__main__":
    unittest.main()
