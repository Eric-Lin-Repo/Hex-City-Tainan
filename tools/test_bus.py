"""data/bus.json（幹線）與 data/bus_branches.json（支線）的檢查（build_bus.py 的輸出）。
從專案根目錄執行：python3 -I tools/test_bus.py"""
import json, math, os, re, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COLOR_IDS = {"blue", "green", "red", "orange", "yellow", "brown"}
KINDS = {"main", "detour", "extension", "reserve", "special", "loop"}



class BusDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        load = lambda n: json.load(open(os.path.join(ROOT, "data", n), encoding="utf-8"))
        cls.trunk, cls.branch, cls.city = load("bus.json"), load("bus_branches.json"), load("city.json")
        cls.files = (("bus.json", cls.trunk), ("bus_branches.json", cls.branch))

    def test_trunks_and_branches(self):
        self.assertEqual([r["id"] for r in self.trunk["routes"]], ["藍幹線", "綠幹線", "紅幹線", "橘幹線", "黃幹線", "棕幹線"])
        self.assertTrue(all(r["trunk"] for r in self.trunk["routes"]))
        self.assertGreaterEqual(len(self.branch["routes"]), 110, "六色支線應該有一百多條")
        self.assertFalse(any(r["trunk"] for r in self.branch["routes"]))
        ids = [r["id"] for _, d in self.files for r in d["routes"]]
        self.assertEqual(len(ids), len(set(ids)), "路線 id 重複")
        for _, d in self.files:
            self.assertEqual(set(d["colors"]), COLOR_IDS)
            self.assertIn("OpenStreetMap", d["note"])
        self.assertEqual({r["color"] for r in self.branch["routes"]}, COLOR_IDS, "每個顏色都要有支線")

    def test_no_kaohsiung_lines(self):
        """高雄的紅 6x／7x 線（紅67B、紅70A、紅71A……）不能混進來。"""
        bad = [r["id"] for _, d in self.files for r in d["routes"] if re.match(r"^紅(6|7)\d", r["id"])]
        self.assertEqual(bad, [])

    def test_route_fields(self):
        for _, d in self.files:
            for r in d["routes"]:
                with self.subTest(route=r["id"]):
                    self.assertIn(r["color"], COLOR_IDS)
                    self.assertTrue(r["id"].startswith(d["colors"][r["color"]]["zh"]))
                    self.assertRegex(r["hex"], r"^#[0-9a-fA-F]{6}$")
                    self.assertTrue(r["en"])
                    self.assertTrue(r["patterns"])
                    self.assertTrue(any(p["kind"] in ("main", "loop") for p in r["patterns"]) or len(r["patterns"]) <= 2, "要有正線")

    def test_both_directions(self):
        """幹線與絕大多數支線的正線都有往返兩個方向。"""
        for r in self.trunk["routes"]:
            self.assertEqual({p["dir"] for p in r["patterns"] if p["kind"] == "main"}, {0, 1}, r["id"])
        both = sum(1 for r in self.branch["routes"] if {p["dir"] for p in r["patterns"]} == {0, 1})
        self.assertGreaterEqual(both / len(self.branch["routes"]), 0.9)

    def test_points(self):
        b = self.city["bounds"]
        for _, d in self.files:
            for r in d["routes"]:
                for p in r["patterns"]:
                    with self.subTest(route=r["id"], pattern=p["label"]):
                        self.assertIn(p["kind"], KINDS)
                        self.assertIn(p["dir"], (0, 1))
                        self.assertGreaterEqual(len(p["points"]), 2)
                        S = self.city.get("scale", 1.0)  # 地圖放大倍數
                        m = 0.5 * S  # 區界是簡化過的多邊形，路線可以貼著邊界外一點點（build_bus.py 的 LAND_TOL）
                        for x, z in p["points"]: self.assertTrue(b["minX"] - m <= x <= b["maxX"] + m and b["minZ"] - m <= z <= b["maxZ"] + m, f"({x}, {z}) 超出地圖")
                        longest = max(math.dist(a, c) for a, c in zip(p["points"], p["points"][1:]))
                        self.assertLess(longest, 7 * S, "有一段直線太長，可能是路段沒接好")
                        length = sum(math.dist(a, c) for a, c in zip(p["points"], p["points"][1:]))
                        self.assertAlmostEqual(length, p["length"], delta=0.05)

    def test_stops(self):
        for name, d in self.files:
            n = len(d["stops"])
            for s in d["stops"]: self.assertTrue(s["name"])
            for r in d["routes"]:
                for p in r["patterns"]:
                    with self.subTest(file=name, route=r["id"], pattern=p["label"]):
                        ds = [dd for _, dd in p["stops"]]
                        self.assertTrue(all(0 <= i < n for i, _ in p["stops"]))
                        self.assertEqual(ds, sorted(ds), "站牌要依行駛順序排列")
                        self.assertTrue(all(0 <= dd <= p["length"] + 0.01 for dd in ds))
        # 幹線的往程站數接近真實（每條幹線往程有 45 站以上）
        for r in self.trunk["routes"]:
            main0 = next(p for p in r["patterns"] if p["kind"] == "main" and p["dir"] == 0)
            self.assertGreaterEqual(len(main0["stops"]), 40, r["id"])

    def test_gaps_filled(self):
        """build_bus.py 會把沒補到的缺口寫進 bus_gaps_todo.json；正式資料應該全部補好。"""
        todo = os.path.join(ROOT, "tools", "raw", "bus_gaps_todo.json")
        self.assertEqual(json.load(open(todo, encoding="utf-8")) if os.path.exists(todo) else {}, {}, "還有缺口沒查：跑 tools/fetch_bus_gaps.py")


if __name__ == "__main__":
    unittest.main()
