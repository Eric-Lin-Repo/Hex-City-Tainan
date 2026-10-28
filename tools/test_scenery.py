"""data/scenery.json（山海景觀、找獼猴）與翻譯的檢查。從專案根目錄執行：python3 -I tools/test_scenery.py"""
import json, os, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KINDS = {"clouds", "badlands", "steam", "peak", "stars", "orchard", "fishponds", "lagoon", "tunnel", "noodles", "caltrop", "dairy",
         "harvest", "sugar", "kilns", "lotus", "bamboo", "wetland", "chickens",
         "boat", "trail", "beehives", "farmhouses", "trucks", "magpies"}
load = lambda *p: json.load(open(os.path.join(ROOT, *p), encoding="utf-8"))
in_tainan = lambda lat, lon: 22.85 <= lat <= 23.45 and 120.0 <= lon <= 120.75


class SceneryTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sc, cls.islands, cls.poi = load("data", "scenery.json"), load("data", "islands.json"), load("data", "poi.json")
        cls.tr = {lang: load("data", "i18n", f"data.{lang}.json").get("scenery", {}) for lang in ("en", "ja")}

    def test_items(self):
        ids = [it["id"] for it in self.sc["items"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual({it["kind"] for it in self.sc["items"]}, KINDS, "每一種景觀都要有")
        for it in self.sc["items"]:
            with self.subTest(id=it["id"]):
                self.assertTrue(it["name"] and it["desc"] and it["icon"])
                self.assertTrue(it["source"] and all(u.startswith("https://") for u in it["source"]))
                coords = it.get("spots", []) + it.get("route", []) + it.get("trail", []) + ([it["racks"]] if "racks" in it else []) + [a["at"] for a in it.get("areas", []) if a["at"]] + [it[k] for k in ("yard", "mangrove", "birds") if k in it]
                self.assertTrue(coords or it.get("anchor") or it.get("crop") or it.get("districts"), "要有座標，或掛在地標／農田／區上")
                for lat, lon in coords: self.assertTrue(in_tainan(lat, lon), f"({lat}, {lon}) 不在台南範圍")
                for k in ("months", "fruitMonths", "flowerMonths", "growMonths", "harvestMonths", "jacanaMonths"):
                    for m in it.get(k, []): self.assertIn(m, range(1, 13))
                if it["kind"] == "orchard": self.assertTrue(it.get("fruitMonths"))
                if it["kind"] == "peak": self.assertGreater(it["elevation"], 500)

    def test_anchors_exist(self):
        names = {(i["name"], b["name"]) for i in self.islands for b in i["buildings"]}
        pois = {p["id"] for p in self.poi["pois"]}
        for it in self.sc["items"]:
            a = it.get("anchor")
            if not a: continue
            with self.subTest(id=it["id"]):
                if "poi" in a: self.assertIn(a["poi"], pois)
                else: self.assertIn(tuple(a["building"]), names)

    def test_monkeys(self):
        m = self.sc["monkeys"]
        ids = [t["id"] for t in m["troops"]]
        self.assertEqual(len(ids), 10); self.assertEqual(len(set(ids)), 10)
        self.assertEqual(sum(1 for t in m["troops"] if t.get("verified")), 1, "只有南化烏山是查證過的棲地")
        for t in m["troops"]: self.assertTrue(in_tainan(*t["at"]))

    def test_translations(self):
        for lang, tr in self.tr.items():
            for it in self.sc["items"]:
                with self.subTest(lang=lang, id=it["id"]):
                    t = tr[it["id"]]
                    self.assertTrue(t["name"] and t["desc"])
                    self.assertEqual(len(t["facts"]), len(it["facts"]))
                    self.assertEqual("note" in t, "note" in it)
            self.assertTrue(tr["monkeys"]["name"] and tr["monkeys"]["desc"])

    def test_crop_stage_indexes(self):
        """scenery.js 用產季階段的序號判斷（英文版的階段名稱會被翻譯）：水稻 3、6 是收割，蓮花 0 休耕、1 展葉、2 花期、3 採蓮子、4 休耕。改 crops.json 時要一起改 scenery.js。"""
        crops = load("data", "crops.json")["crops"]
        rice = [s["label"] for s in crops["rice"]["stages"]]
        self.assertIn("收割", rice[3]); self.assertIn("收割", rice[6])
        lotus = [s["label"] for s in crops["lotus"]["stages"]]
        self.assertEqual(len(lotus), 5)
        self.assertIn("休耕", lotus[0]); self.assertIn("展葉", lotus[1]); self.assertIn("花期", lotus[2]); self.assertIn("蓮子", lotus[3]); self.assertIn("休耕", lotus[4])
        for it in self.sc["items"]:
            if "crop" in it: self.assertIn(it["crop"], crops, it["id"])

    def test_light_festival(self):
        ev = next(e for e in load("data", "events.json")["events"] if e["id"] == "longqi")
        self.assertEqual(ev["effect"], "lightfest")
        self.assertEqual(ev["schedule"], {"solar": [12, 24], "solarEnd": [2, 16]})
        self.assertFalse(any(e["id"] == "longqi-light" for e in load("data", "events.json")["events"]), "不能重複")


if __name__ == "__main__":
    unittest.main()
