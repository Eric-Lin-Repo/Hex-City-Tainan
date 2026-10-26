"""data/trails.json 的檢查。從專案根目錄執行：python3 -I tools/test_trails.py
只讀現有的 data/trails.json 與 data/city.json，不重跑抓取。"""
import json, os, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXPECTED = {"shanhaijun", "batian", "siraya", "taijiang", "goldcoast", "beimen", "jingliao"}


class TrailsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        def load(n):
            with open(os.path.join(ROOT, "data", n), encoding="utf-8") as f: return json.load(f)
        cls.trails = load("trails.json")["trails"]
        cls.bounds = load("city.json")["bounds"]

    def test_seven_trails(self):
        self.assertEqual(len(self.trails), 7)
        self.assertEqual({t["id"] for t in self.trails}, EXPECTED)
        self.assertEqual(sum(t["kind"] == "greenway" for t in self.trails), 1)

    def test_fields(self):
        for t in self.trails:
            with self.subTest(t["id"]):
                for k in ("id", "name", "kind", "color", "lengthKm", "desc", "segments"): self.assertIn(k, t)
                self.assertIn(t["kind"], ("greenway", "cycleway"))
                self.assertRegex(t["color"], r"^#[0-9a-f]{6}$")
                self.assertTrue(t["desc"])

    def test_segments_and_length(self):
        for t in self.trails:
            with self.subTest(t["id"]):
                self.assertGreaterEqual(len(t["segments"]), 1)
                self.assertGreater(t["lengthKm"], 0)
                for seg in t["segments"]: self.assertGreaterEqual(len(seg), 2)

    def test_points_in_bounds(self):
        b = self.bounds
        for t in self.trails:
            for seg in t["segments"]:
                for x, z in seg:
                    self.assertTrue(b["minX"] <= x <= b["maxX"] and b["minZ"] <= z <= b["maxZ"], f"{t['id']} 點 ({x}, {z}) 超出範圍")

    def test_densified(self):
        """加密後相鄰點距不超過 0.3 單位（留一點浮點餘裕）。"""
        for t in self.trails:
            for seg in t["segments"]:
                for (x0, z0), (x1, z1) in zip(seg, seg[1:]):
                    self.assertLessEqual(((x1 - x0) ** 2 + (z1 - z0) ** 2) ** 0.5, 0.3 + 1e-3, t["id"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
