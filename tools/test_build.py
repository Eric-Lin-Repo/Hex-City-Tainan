"""build_city.py 的輸出檢查。從專案根目錄執行：python3 -I -m unittest tools/test_build.py
會把整條管線跑進暫存資料夾，不碰 data/。"""
import json, math, os, shutil, subprocess, sys, tempfile, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")


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


def dist_to_land(p, polys):
    """在某區多邊形內回 0，否則回到最近區邊界的距離。"""
    best = math.inf
    for poly in polys:
        if inside(poly, p): return 0.0
        best = min(best, min(seg_dist(p, poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly))))
    return best


class BuildCityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="hex-city-test-")
        r = subprocess.run([sys.executable, "-I", os.path.join(TOOLS, "build_city.py"), os.path.join(TOOLS, "raw", "twTown1982.topo.json"), cls.tmp],
                           cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0: raise RuntimeError("build_city.py 失敗：\n" + r.stderr)
        cls.log = r.stdout
        load = lambda n: json.load(open(os.path.join(cls.tmp, n), encoding="utf-8"))
        cls.city, cls.islands, cls.rail = load("city.json"), load("islands.json"), load("rail.json")
        cls.poi, cls.events, cls.water = load("poi.json"), load("events.json"), load("water_mrt.json")
        cls.polys = [d["polygon"] for d in cls.city["districts"]]

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_37_districts(self):
        self.assertEqual(len(self.city["districts"]), 37)
        self.assertEqual(len(self.islands), 37)
        self.assertEqual([d["id"] for d in self.city["districts"]], [i["id"] for i in self.islands])

    def test_points_on_land(self):
        items = [("station", s["id"], s["pos"]) for s in self.rail["stations"]] + \
                [("poi", p["id"], p["pos"]) for p in self.poi["pois"]] + \
                [("event", e["id"], e["pos"]) for e in self.events["events"]]
        far = [(kind, id_, round(dist_to_land(pos, self.polys), 3)) for kind, id_, pos in items if dist_to_land(pos, self.polys) > 0.3]
        self.assertEqual(far, [], f"離陸地超過 0.3：{far}")

    def test_building_slots(self):
        for d, isl in zip(self.city["districts"], self.islands):
            self.assertLessEqual(len(isl["buildings"]), len(d["slots"]), d["name"])
            for b in isl["buildings"]: self.assertIn("geocoded", b)
            for s in d["slots"]: self.assertTrue(inside(d["polygon"], s), f"{d['name']} 的落點 {s} 不在區內")

    def test_bridges_only_between_neighbors(self):
        nb = {d["id"]: set(d["neighbors"]) for d in self.city["districts"]}
        for br in self.city["bridges"]:
            self.assertIn(br["b"], nb[br["a"]], br)
            self.assertIn(br["a"], nb[br["b"]], br)

    def test_main_service_route(self):
        sv = self.rail["services"][0]
        self.assertEqual(len(sv["stations"]), 17)
        self.assertEqual(len(sv["stops"]), 17)
        self.assertGreater(len(sv["points"]), 100)
        self.assertEqual(sv["stops"], sorted(set(sv["stops"])), "stops 必須嚴格遞增")
        self.assertEqual(sv["stops"][0], 0)
        self.assertEqual(sv["stops"][-1], len(sv["points"]) - 1)
        pos = {s["id"]: s["pos"] for s in self.rail["stations"]}
        for sid, i in zip(sv["stations"], sv["stops"]):
            p = sv["points"][i]
            self.assertLess(math.hypot(p[0] - pos[sid][0], p[1] - pos[sid][1]), 0.01, f"{sid} 的停靠點不在車站位置")
        self.assertNotIn("WARN rail", self.log, "有站對沒走真實軌道")

    def test_poi_spacing(self):
        pts = [(p["name"], p["pos"]) for p in self.poi["pois"]]
        close = [(a, b, round(math.hypot(pa[0] - pb[0], pa[1] - pb[1]), 3)) for i, (a, pa) in enumerate(pts) for b, pb in pts[i + 1:]
                 if math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 0.45]
        self.assertEqual(close, [], f"景點太近：{close}")
        for p in self.poi["pois"]: self.assertIn("geocoded", p)

    def test_lakes(self):
        names = {l["name"] for l in self.water["lakes"]}
        for want in ("曾文水庫", "烏山頭水庫", "南化水庫", "七股潟湖", "虎頭埤"): self.assertIn(want, names)
        for l in self.water["lakes"]: self.assertGreaterEqual(len(l["polygon"]), 3)

    def shown_lakes(self):
        """前端會畫的湖（大半在陸地上），跟 infrastructure.js、world.js 同一個標準。"""
        return [l for l in self.water["lakes"] if sum(1 for p in l["polygon"] if dist_to_land(p, self.polys) == 0) / len(l["polygon"]) >= 0.5]

    def test_nothing_in_lakes(self):
        lakes = self.shown_lakes()
        self.assertIn("曾文水庫", {l["name"] for l in lakes}, "曾文水庫的示意湖要畫在陸地上")
        items = [("station", s["id"], s["pos"]) for s in self.rail["stations"]] + \
                [("poi", p["name"], p["pos"]) for p in self.poi["pois"]] + \
                [("event", e["id"], e["pos"]) for e in self.events["events"]]
        for d, isl in zip(self.city["districts"], self.islands):
            items += [("building", b["name"], s) for b, s in zip(isl["buildings"], d["slots"])]
            items += [("tree", d["name"], t[:2]) for t in d["trees"]]
            items += [("field", d["name"], f[:2]) for f in d["fields"]]
        wet = [(kind, name, l["name"]) for kind, name, p in items for l in lakes if inside(l["polygon"], p)]
        self.assertEqual(wet, [], f"落在湖裡：{wet}")

    def test_reservoir_dams(self):
        lakes = {l["name"]: l for l in self.shown_lakes()}
        zw = lakes["曾文水庫"]
        self.assertTrue(zw.get("schematic"))
        nanxi = next(d for d in self.city["districts"] if d["name"] == "楠西區")
        self.assertEqual(zw["district"], nanxi["id"])
        self.assertTrue(all(inside(nanxi["polygon"], p) for p in zw["polygon"]), "示意湖要整片在楠西區內")
        slot = {b["name"]: s for d, isl in zip(self.city["districts"], self.islands) for b, s in zip(isl["buildings"], d["slots"]) if b["model"] == "dam"}
        for name in ("曾文水庫", "南化水庫", "白河水庫", "鏡面水庫"):
            self.assertIn(name, slot, f"缺少 {name} 的壩體建築")
            poly = lakes[name]["polygon"]
            shore = min(seg_dist(slot[name], poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))
            self.assertLess(shore, 0.8, f"{name} 的壩離湖岸 {shore:.2f}")

    def test_universities(self):
        """台南招生中的 11 所大學、科技大學、學院加台南神學院都在地圖上；tools/pinned_buildings.json 的建築離真實座標 1 單位內。"""
        names = {b["name"] for isl in self.islands for b in isl["buildings"]}
        for want in ("國立成功大學", "國立臺南大學", "國立臺南藝術大學", "長榮大學", "南臺科技大學", "崑山科技大學", "台南應用科技大學",
                     "嘉南藥理大學", "中信科技大學", "中華醫事科技大學", "中信金融管理學院", "台南神學院"):
            self.assertIn(want, names)
        pins = json.load(open(os.path.join(TOOLS, "pinned_buildings.json"), encoding="utf-8"))["pins"]
        P = self.city["projection"]
        slot = {f"{d['name']}:{b['name']}": s for d, isl in zip(self.city["districts"], self.islands) for b, s in zip(isl["buildings"], d["slots"])}
        for key, pin in pins.items():
            self.assertIn(key, slot, f"{key} 沒有放進地圖")
            x, z = (pin["lon"] - P["lon_c"]) * P["km_x"] * P["k"], -(pin["lat"] - P["lat_c"]) * P["km_z"] * P["k"]
            self.assertLess(math.hypot(slot[key][0] - x, slot[key][1] - z), 1.0, f"{key} 離真實座標太遠")

    def test_minor_buildings(self):
        """settings.json 的 minorBuildings（拉近才出現的次要建築）每一棟都要存在，而且不是該區唯一的建築。"""
        settings = json.load(open(os.path.join(ROOT, "data", "settings.json"), encoding="utf-8"))
        by = {i["name"]: {b["name"] for b in i["buildings"]} for i in self.islands}
        for dn, names in settings.get("minorBuildings", {}).items():
            if dn.startswith("_"): continue
            self.assertIn(dn, by)
            for n in names: self.assertIn(n, by[dn], f"{dn} 沒有 {n}")
            self.assertLess(len(names), len(by[dn]), f"{dn} 不能整區都是次要建築")


if __name__ == "__main__":
    unittest.main()
