"""吃遍台南資料檢查：data/food.json 每樣小吃的地點都存在、id 不重複、有出處，英日文翻譯齊全。
用法：python3 -I tools/test_food.py"""
import json, os, re, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load = lambda *p: json.load(open(os.path.join(ROOT, *p), encoding="utf-8"))


class TestFood(unittest.TestCase):
    def setUp(self):
        self.items = load("data", "food.json")["items"]
        self.islands = {i["name"]: i for i in load("data", "islands.json")}
        self.pois = {p["id"]: p for p in load("data", "poi.json")["pois"]}
        self.district_of = {d["id"]: d["name"] for d in load("data", "city.json")["districts"]}

    def test_ids(self):
        ids = [it["id"] for it in self.items]
        self.assertEqual(len(ids), len(set(ids)), "id 重複")
        for i in ids:
            self.assertRegex(i, r"^[a-z0-9]+(-[a-z0-9]+)*$")

    def test_anchor_exists_in_same_district(self):
        for it in self.items:
            with self.subTest(food=it["name"]):
                at = it["at"]
                if "poi" in at:
                    self.assertIn(at["poi"], self.pois)
                    self.assertEqual(self.district_of[self.pois[at["poi"]]["district"]], it["district"])
                else:
                    d, b = at["building"]
                    self.assertEqual(d, it["district"])
                    self.assertIn(b, [x["name"] for x in self.islands[d]["buildings"]])

    def test_fields(self):
        for it in self.items:
            with self.subTest(food=it["name"]):
                for k in ("name", "icon", "desc", "source"):
                    self.assertTrue(str(it.get(k, "")).strip(), f"缺 {k}")
                self.assertTrue(it["source"].startswith("http"))

    def test_translations(self):
        for lang in ("en", "ja"):
            tr = load("data", "i18n", f"data.{lang}.json").get("foods", {})
            with self.subTest(lang=lang):
                self.assertEqual(set(tr), {it["id"] for it in self.items})
                for v in tr.values():
                    self.assertTrue(v["name"].strip() and v["desc"].strip())


if __name__ == "__main__":
    unittest.main(verbosity=1)
