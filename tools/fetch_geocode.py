"""用 OpenStreetMap Nominatim 把車站、景點、各區建築地理編碼，結果寫到 tools/geocode_cache.json（可重跑，已有的不再查）。"""
import json, os, sys, time, urllib.parse
here = os.path.dirname(os.path.abspath(__file__))
cache_p = os.path.join(here, "geocode_cache.json")
cache = json.load(open(cache_p)) if os.path.exists(cache_p) else {}
UA = "hex-city-demo/1.0 (personal demo; contact: local)"
import subprocess
def http_get(url, data=None, timeout=300):
    """用 curl 取代 urllib（本機 Python 沒有 SSL 憑證）。"""
    cmd = ["curl", "-sL", "--max-time", str(timeout), "-A", UA, url]
    if data is not None: cmd += ["--data-urlencode", "data=" + data]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0: raise RuntimeError("curl failed " + str(r.returncode))
    return r.stdout

BBOX = (120.0, 22.85, 120.75, 23.45)  # lon_min, lat_min, lon_max, lat_max（台南市範圍）

def query(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "jsonv2", "limit": 5, "countrycodes": "tw", "accept-language": "zh-TW"})
    return json.loads(http_get(url, timeout=30))

def inside(lat, lon):
    return BBOX[1] <= lat <= BBOX[3] and BBOX[0] <= lon <= BBOX[2]

def best(results, district):
    for r in results:
        lat, lon = float(r["lat"]), float(r["lon"])
        if not inside(lat, lon): continue
        name = r.get("display_name", "")
        if district and district[:-1] not in name and district not in name: continue
        return {"lat": lat, "lon": lon, "display_name": name, "type": r.get("type"), "confidence": "district-match" if district else "bbox"}
    for r in results:
        lat, lon = float(r["lat"]), float(r["lon"])
        if inside(lat, lon):
            return {"lat": lat, "lon": lon, "display_name": r.get("display_name", ""), "type": r.get("type"), "confidence": "bbox-only"}
    return None

items = []
rail = json.load(open(os.path.join(here, "rail_source.json")))
for s in rail["stations"]:
    nm = s["name"].split("／")[0]
    items.append(("station:" + s["id"], [f"{nm}車站 台南", f"台鐵{nm}站"], None))
poi = json.load(open(os.path.join(here, "poi_source.json")))
for p in poi["pois"]:
    items.append(("poi:" + p["id"], [f"{p['name']} 台南市", p["name"]], None))
bld = json.load(open(os.path.join(here, "buildings_source.json")))
for district, lst in bld.items():
    if district.startswith("_"): continue
    for nm, model, plain in lst:
        items.append((f"building:{district}:{nm}", [f"{nm} 台南市{district}", f"{nm} 台南市", nm], district))

done = 0
for key, queries, district in items:
    if key in cache: continue
    found, tried = None, []
    for q in queries:
        try:
            res = query(q)
        except Exception as e:
            res = []; tried.append(f"{q}: {e}")
        time.sleep(1.1)
        found = best(res, district)
        tried.append(q)
        if found: found["query"] = q; break
    cache[key] = found or {"query": tried, "confidence": "none"}
    done += 1
    json.dump(cache, open(cache_p, "w"), ensure_ascii=False, indent=1)
    print(key, "->", (found or {}).get("confidence"), flush=True)
print("done", done, "queried;", sum(1 for v in cache.values() if v.get("confidence") != "none"), "/", len(cache), "found")
