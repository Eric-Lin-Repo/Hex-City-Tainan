"""data/sugar.json 的檢查。從專案根目錄執行：python3 -I tools/test_sugar.py"""
import json, math, os, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class SugarDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        def load(n):
            with open(os.path.join(ROOT, "data", n), encoding="utf-8") as f: return json.load(f)
        cls.sugar, cls.city = load("sugar.json"), load("city.json")
        cls.line = cls.sugar["lines"][0]

    def test_one_line(self):
        self.assertEqual(len(self.sugar["lines"]), 1)
        for k in ("id", "name", "district", "color", "desc", "points", "stops"): self.assertIn(k, self.line)
        self.assertIn(self.line["district"], {d["id"] for d in self.city["districts"]})

    def test_points_in_bounds(self):
        pts, B = self.line["points"], self.city["bounds"]
        self.assertGreaterEqual(len(pts), 20)
        for x, z in pts:
            self.assertTrue(B["minX"] <= x <= B["maxX"] and B["minZ"] <= z <= B["maxZ"], f"點 {[x, z]} 超出範圍")

    def test_stops(self):
        n, stops = len(self.line["points"]), self.line["stops"]
        self.assertGreaterEqual(len(stops), 2)
        for st in stops:
            self.assertTrue(0 <= st["i"] < n, f"停靠點索引 {st['i']} 不合法")
            self.assertTrue(st["name"])
        self.assertEqual([stops[0]["i"], stops[-1]["i"]], [0, n - 1])

    def test_length(self):
        pts = self.line["points"]
        L = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))
        self.assertTrue(2 <= L <= 12, f"總長度 {L:.2f} 不在 2～12 單位之間")


if __name__ == "__main__":
    unittest.main()
