"""農田資料檢查：data/crops.json 的產季是否切滿一整年、data/city.json 的田地是否都落在該區內。
從專案根目錄執行：python3 -I tools/test_fields.py"""
import json, math, os, re, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DAYS = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]  # 各月第一天的年內序（二月算 29 天）
HEX = re.compile(r"^#[0-9a-f]{6}$")


def doy(md):
    return DAYS[int(md[:2]) - 1] + int(md[3:])


def inside(poly, p):
    x, z = p; c = False; n = len(poly)
    for i in range(n):
        x0, z0 = poly[i]; x1, z1 = poly[(i + 1) % n]
        if (z0 > z) != (z1 > z) and x < (x1 - x0) * (z - z0) / (z1 - z0) + x0: c = not c
    return c


def corners(x, z, w, d, ry):
    c, s = math.cos(ry), math.sin(ry)
    return [(x + lx * c + lz * s, z - lx * s + lz * c) for lx, lz in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]


class FieldsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        def load(n):
            with open(os.path.join(ROOT, "data", n), encoding="utf-8") as fp: return json.load(fp)
        cls.crops, cls.city = load("crops.json"), load("city.json")
        cls.districts = {d["id"]: d for d in cls.city["districts"]}

    def test_stages_cover_year(self):
        for cid, crop in self.crops["crops"].items():
            self.assertTrue(crop.get("name"), cid)
            for s in crop["stages"]:
                self.assertRegex(s["color"], HEX, f"{cid} 顏色要是 #rrggbb：{s['color']}")
                self.assertTrue(s.get("label"), f"{cid} 缺 label")
                self.assertLessEqual(doy(s["from"]), doy(s["to"]), f"{cid} 階段 {s['from']}~{s['to']} 起迄顛倒")
            for day in range(1, 367):
                hits = [s for s in crop["stages"] if doy(s["from"]) <= day <= doy(s["to"])]
                self.assertEqual(len(hits), 1, f"{cid} 第 {day} 天對到 {len(hits)} 個階段（要剛好 1 個）")

    def test_by_district_refs(self):
        for did, kinds in self.crops["byDistrict"].items():
            self.assertIn(did, self.districts, f"byDistrict 的 {did} 不在 city.json")
            self.assertTrue(kinds, f"{did} 沒有作物")
            for k in kinds: self.assertIn(k, self.crops["crops"], f"{did} 的作物 {k} 沒有定義")
            self.assertTrue(self.districts[did]["fields"], f"{self.districts[did]['name']} 有作物卻沒有田")

    def test_fields_inside_district(self):
        for d in self.city["districts"]:
            self.assertIn("fields", d, d["name"])
            for f in d["fields"]:
                x, z, w, dep, ry = f
                self.assertTrue(inside(d["polygon"], (x, z)), f"{d['name']} 的田 {f} 中心不在區內")
                for c in corners(x, z, w, dep, ry): self.assertTrue(inside(d["polygon"], c), f"{d['name']} 的田 {f} 有角落在區外")
                self.assertTrue(0.9 <= w <= 1.6 and 0.7 <= dep <= 1.2 and abs(ry) <= 0.35, f"{d['name']} 的田 {f} 尺寸或角度超出範圍")
            for i, a in enumerate(d["fields"]):
                for b in d["fields"][i + 1:]:
                    gap = (math.hypot(a[2], a[3]) + math.hypot(b[2], b[3])) / 2
                    self.assertGreaterEqual(math.hypot(a[0] - b[0], a[1] - b[1]), gap, f"{d['name']} 的田 {a} 與 {b} 重疊")

    def test_enough_districts_have_fields(self):
        farmed = [d for d in self.city["districts"] if d["fields"]]
        self.assertGreaterEqual(len(farmed), 20, f"只有 {len(farmed)} 區有田")
        for d in farmed:
            self.assertTrue(4 <= len(d["fields"]) <= 10, f"{d['name']} 有 {len(d['fields'])} 塊田（要 4～10）")
            self.assertIn(d["id"], self.crops["byDistrict"], f"{d['name']} 有田但 crops.json 沒指定作物")


if __name__ == "__main__":
    unittest.main()
