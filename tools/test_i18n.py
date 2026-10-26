"""i18n 翻譯檔檢查：data/i18n/*.json 與原始資料的 id 集合、筆數、空字串、ui key 集合。

執行：python3 -I tools/test_i18n.py
"""
import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
I18N = os.path.join(DATA, "i18n")
LANGS = ("en", "ja")


def load(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return json.load(f)


def walk_strings(node, path=""):
    """遍歷巢狀 dict/list，yield (path, value) 的所有字串葉節點。"""
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk_strings(v, f"{path}.{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_strings(v, f"{path}[{i}]")
    else:
        yield path, node


class Source:
    """原始資料的 id 集合與數量（只讀一次）。"""

    islands = load(DATA, "islands.json")
    district_ids = {d["id"] for d in islands}
    building_ids = {b["id"] for d in islands for b in d["buildings"]}
    poi_ids = {p["id"] for p in load(DATA, "poi.json")["pois"]}
    events = load(DATA, "events.json")["events"]
    event_ids = {e["id"] for e in events}
    rail = load(DATA, "rail.json")
    station_ids = {s["id"] for s in rail["stations"]}
    line_ids = {l["id"] for l in rail["lines"]} | {s["id"] for s in rail["services"]}
    role_keys = set(load(DATA, "roles.json")["roles"])
    day_cycle_len = len(load(DATA, "settings.json")["dayCycle"])
    tours = load(DATA, "tours.json")["tours"]
    crops = load(DATA, "crops.json")["crops"] if os.path.exists(os.path.join(DATA, "crops.json")) else None
    flow_ids = {f["id"] for f in load(DATA, "flows.json")}


class TestDataTranslations(unittest.TestCase):
    def setUp(self):
        self.tr = {lang: load(I18N, f"data.{lang}.json") for lang in LANGS}

    def _assert_ids(self, section, expected):
        for lang in LANGS:
            with self.subTest(lang=lang, section=section):
                self.assertEqual(set(self.tr[lang][section]), expected)

    def test_district_ids(self):
        self._assert_ids("districts", Source.district_ids)
        self.assertEqual(len(Source.district_ids), 37)

    def test_building_ids(self):
        self._assert_ids("buildings", Source.building_ids)
        self.assertGreaterEqual(len(Source.building_ids), 136)  # 2026-10 加入 85 處後為 221

    def test_poi_ids(self):
        self._assert_ids("pois", Source.poi_ids)
        self.assertEqual(len(Source.poi_ids), 33)

    def test_event_ids(self):
        self._assert_ids("events", Source.event_ids)
        self.assertGreaterEqual(len(Source.event_ids), 23)  # 含頭社太祖夜祭共 24

    def test_station_ids(self):
        self._assert_ids("stations", Source.station_ids)
        self.assertEqual(len(Source.station_ids), 17)

    def test_line_ids(self):
        self._assert_ids("lines", Source.line_ids)

    def test_role_keys(self):
        self._assert_ids("roles", Source.role_keys)
        self._assert_ids("roleDescriptions", Source.role_keys)

    def test_flow_ids(self):
        self._assert_ids("flows", Source.flow_ids)

    def test_required_fields(self):
        for lang in LANGS:
            t = self.tr[lang]
            for sec, fields in (("districts", ("name", "summary")), ("buildings", ("name", "desc")),
                                ("pois", ("name", "desc")), ("events", ("name", "desc", "when")),
                                ("stations", ("name",)), ("lines", ("name",))):
                for id_, item in t[sec].items():
                    for f in fields:
                        with self.subTest(lang=lang, section=sec, id=id_, field=f):
                            self.assertIn(f, item)

    def test_event_schedule_labels(self):
        """多段排程且有 label 的活動（東山迎佛祖、安平跨年）要有同數量的 labels。"""
        for e in Source.events:
            sched = e["schedule"] if isinstance(e["schedule"], list) else [e["schedule"]]
            labels = [s.get("label") for s in sched]
            if not any(labels):
                continue
            for lang in LANGS:
                with self.subTest(lang=lang, event=e["id"]):
                    self.assertEqual(len(self.tr[lang]["events"][e["id"]]["labels"]), len(labels))

    def test_day_cycle_length(self):
        for lang in LANGS:
            with self.subTest(lang=lang):
                dc = self.tr[lang]["dayCycle"]
                self.assertEqual(len(dc), Source.day_cycle_len)
                for p in dc:
                    self.assertIn("label", p)
                    self.assertIn("note", p)

    def test_tours(self):
        for lang in LANGS:
            t = self.tr[lang]["tours"]
            self.assertEqual(set(t), {x["id"] for x in Source.tours})
            for tour in Source.tours:
                with self.subTest(lang=lang, tour=tour["id"]):
                    self.assertEqual(len(t[tour["id"]]["captions"]), len(tour["cues"]))
                    self.assertIn("name", t[tour["id"]])
                    self.assertIn("blurb", t[tour["id"]])

    def test_crops(self):
        if Source.crops is None:
            self.skipTest("data/crops.json 不存在")
        for lang in LANGS:
            c = self.tr[lang]["crops"]
            self.assertEqual(set(c), set(Source.crops))
            for key, crop in Source.crops.items():
                with self.subTest(lang=lang, crop=key):
                    self.assertEqual(len(c[key]["stages"]), len(crop["stages"]))

    def test_no_empty_strings(self):
        for lang in LANGS:
            for path, value in walk_strings(self.tr[lang]):
                with self.subTest(lang=lang, path=path):
                    self.assertIsInstance(value, str)
                    self.assertTrue(value.strip(), f"空字串：{path}")


class TestUiTranslations(unittest.TestCase):
    def setUp(self):
        self.zh = load(I18N, "ui.zh.json")
        self.tr = {lang: load(I18N, f"ui.{lang}.json") for lang in LANGS}

    def test_key_sets_match(self):
        for lang in LANGS:
            with self.subTest(lang=lang):
                self.assertEqual(set(self.tr[lang]), set(self.zh))

    def test_no_empty_strings(self):
        for lang, d in [("zh", self.zh), *self.tr.items()]:
            for k, v in d.items():
                with self.subTest(lang=lang, key=k):
                    self.assertIsInstance(v, str)
                    self.assertTrue(v.strip(), f"空字串：{k}")

    def test_placeholders_preserved(self):
        """zh 裡的 {n}、{label} 等佔位符在 en/ja 都要出現。"""
        import re
        for k, v in self.zh.items():
            ph = set(re.findall(r"\{\w+\}", v))
            if not ph:
                continue
            for lang in LANGS:
                with self.subTest(lang=lang, key=k):
                    self.assertEqual(set(re.findall(r"\{\w+\}", self.tr[lang][k])), ph)


class TestUi2Translations(TestUiTranslations):
    """後加功能的字串（ui2.*.json）：同樣要三語 key 一致、沒有空字串、佔位符保留。"""
    def setUp(self):
        self.zh = load(I18N, "ui2.zh.json")
        self.tr = {lang: load(I18N, f"ui2.{lang}.json") for lang in LANGS}


def print_counts():
    print("=== 筆數統計 ===")
    for lang in LANGS:
        t = load(I18N, f"data.{lang}.json")
        parts = [f"{sec}={len(t[sec])}" for sec in ("districts", "buildings", "pois", "events", "stations", "lines", "roles", "flows")]
        parts.append(f"dayCycle={len(t['dayCycle'])}")
        parts.append(f"tours={len(t['tours'])}(captions={sum(len(x['captions']) for x in t['tours'].values())})")
        if "crops" in t:
            parts.append(f"crops={len(t['crops'])}(stages={sum(len(x['stages']) for x in t['crops'].values())})")
        print(f"data.{lang}.json: " + ", ".join(parts))
    for lang in ("zh", *LANGS):
        print(f"ui.{lang}.json: keys={len(load(I18N, f'ui.{lang}.json'))}")


if __name__ == "__main__":
    print_counts()
    unittest.main(argv=sys.argv[:1], verbosity=1)
