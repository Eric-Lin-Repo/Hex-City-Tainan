"""把資料校對頁（tools/review.html）匯出的 review.json 寫回資料，然後重跑產生器與測試。
用法：python3 -I tools/apply_review.py ~/Downloads/review.json
- geo：手動經緯度寫進 tools/geocode_cache.json（confidence 標 district-match，build_city 會採用；不在該區內仍會退回示意位置）
- desc：改 tools/buildings_source.json 的中文介紹（英日文翻譯不會自動改，腳本會列出要補翻的項目）
- spec：保留／刪除／改名 data/specialties.json 的農特產（data/spec_seasons.json 的產季跟著改名；沒有區再用的就刪掉）
- season：寫回 data/spec_seasons.json 的月份，並拿掉 unsure 標記
- food：data/food.json 的小吃保留／刪除、改中文介紹（確認無誤就拿掉 unsure；改了介紹要補英日文）
"""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
rev = json.load(open(sys.argv[1]))
p = lambda *a: os.path.join(ROOT, *a)

cache = json.load(open(p("tools", "geocode_cache.json")))
for k, ll in (rev.get("geo") or {}).items():
    if not ll: continue
    d, n = k.split("|", 1)
    cache[f"building:{d}:{n}"] = {"lat": ll[0], "lon": ll[1], "display_name": "手動校對", "type": "manual", "confidence": "district-match", "query": "manual"}
    print("座標", d, n, ll)
json.dump(cache, open(p("tools", "geocode_cache.json"), "w"), ensure_ascii=False, indent=1)

src = json.load(open(p("tools", "buildings_source.json")))
retranslate = []
for k, text in (rev.get("desc") or {}).items():
    d, n = k.split("|", 1)
    for item in src.get(d, []):
        if item[0] == n: item[2] = text; retranslate.append(n); print("介紹", d, n, "→", text)
json.dump(src, open(p("tools", "buildings_source.json"), "w"), ensure_ascii=False, indent=1)

spec = json.load(open(p("data", "specialties.json")))
city = json.load(open(p("data", "city.json")))
did = {x["name"]: x["id"] for x in city["districts"]}
tr = {l: json.load(open(p("data", "i18n", f"data.{l}.json"))) for l in ("en", "ja")}
for k, v in (rev.get("spec") or {}).items():
    d, item = k.split("|", 1)
    lst = spec["byDistrict"].get(did[d], [])
    idx = next((i for i, x in enumerate(lst) if x["name"] == item), None)
    if idx is None: continue
    if not v.get("keep"):
        lst.pop(idx)
        for l in tr: tr[l].get("specialties", {}).get(did[d], [None] * (idx + 1)).pop(idx)
        print("刪除特產", d, item)
    elif v.get("name") and v["name"] != item:
        lst[idx]["name"] = v["name"]; retranslate.append(v["name"]); print("改名特產", d, item, "→", v["name"])
json.dump(spec, open(p("data", "specialties.json"), "w"), ensure_ascii=False, indent=1)

seasons = json.load(open(p("data", "spec_seasons.json")))
by = seasons["byName"]
for k, v in (rev.get("spec") or {}).items():  # 改名：產季跟著搬過去
    item = k.split("|", 1)[1]
    if v.get("keep") and v.get("name") and v["name"] != item and item in by and v["name"] not in by: by[v["name"]] = dict(by[item])
for name, months in (rev.get("season") or {}).items():
    if name in by and months:
        by[name]["months"] = sorted(months); by[name].pop("unsure", None); print("產季", name, "→", sorted(months))
used = {it["name"] for items in spec["byDistrict"].values() for it in items}
for name in [n for n in by if n not in used]: by.pop(name); print("產季刪除（沒有區再用）", name)
json.dump(seasons, open(p("data", "spec_seasons.json"), "w"), ensure_ascii=False, indent=1)
for l in tr: json.dump(tr[l], open(p("data", "i18n", f"data.{l}.json"), "w"), ensure_ascii=False, indent=2)

foods = json.load(open(p("data", "food.json")))
for fid, v in (rev.get("food") or {}).items():
    it = next((x for x in foods["items"] if x["id"] == fid), None)
    if not it: continue
    if not v.get("keep", True):
        foods["items"].remove(it)
        for l in tr: tr[l].get("foods", {}).pop(fid, None)
        print("刪除小吃", it["district"], it["name"]); continue
    if v.get("desc") and v["desc"] != it["desc"]: it["desc"] = v["desc"]; retranslate.append(it["name"]); print("小吃介紹", it["name"], "→", v["desc"])
    if v.get("ok"): it.pop("unsure", None); print("小吃確認", it["name"])
json.dump(foods, open(p("data", "food.json"), "w"), ensure_ascii=False, indent=1)
for l in tr: json.dump(tr[l], open(p("data", "i18n", f"data.{l}.json"), "w"), ensure_ascii=False, indent=2)

run = lambda *a: subprocess.run([sys.executable, "-I", *a], cwd=ROOT)
run("tools/build_city.py", "tools/raw/twTown1982.topo.json", "data")
run("tools/build_hsr.py")
for t in ("build", "fields", "i18n", "specs", "food"): run(f"tools/test_{t}.py")
if retranslate: print("\n英日文翻譯需要補：", "、".join(retranslate))
