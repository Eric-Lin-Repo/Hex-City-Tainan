"""農特產產季資料檢查：data/spec_seasons.json 要涵蓋 data/specialties.json 的每一項，月份 1–12 不重複，顏色是 #rrggbb。
用法：python3 -I tools/test_specs.py"""
import json, os, re, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load = lambda name: json.load(open(os.path.join(ROOT, "data", name), encoding="utf-8"))


class TestSpecSeasons(unittest.TestCase):
    def setUp(self):
        self.spec = load("specialties.json")["byDistrict"]
        self.seasons = load("spec_seasons.json")["byName"]

    def test_every_specialty_has_season(self):
        names = {it["name"] for items in self.spec.values() for it in items}
        self.assertEqual(names - set(self.seasons), set(), "有特產沒有產季")
        self.assertEqual(set(self.seasons) - names, set(), "產季檔有多餘的特產")

    def test_months_valid(self):
        for name, s in self.seasons.items():
            with self.subTest(name=name):
                ms = s["months"]
                self.assertTrue(ms, "月份不可為空")
                self.assertTrue(all(isinstance(m, int) and 1 <= m <= 12 for m in ms))
                self.assertEqual(len(ms), len(set(ms)), "月份重複")

    def test_color(self):
        for name, s in self.seasons.items():
            with self.subTest(name=name):
                self.assertRegex(s["color"], r"^#[0-9a-f]{6}$")

    def test_every_month_has_something(self):
        """每個月至少有 5 項當季，「當季」開關才不會空蕩蕩。"""
        for m in range(1, 13):
            with self.subTest(month=m):
                self.assertGreaterEqual(sum(1 for s in self.seasons.values() if m in s["months"]), 5)


if __name__ == "__main__":
    unittest.main(verbosity=1)
