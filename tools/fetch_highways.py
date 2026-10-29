"""用 Overpass API 抓台南一帶的高速公路與快速道路（國道 1、3、8 號，台 61、84、86 線，臺南都會區北外環道路）與匝道，
連同交流道節點（highway=motorway_junction 的名稱）存成 tools/raw/osm_highways.json。之後由 build_city.py 離線讀 raw 檔產出 data/highways.json。
way 用 out body geom：有節點編號（匝道和主線靠共用節點接起來，車才能從匝道開上主線）也有座標。
用法：python3 -I tools/fetch_highways.py"""
import json, os, subprocess, time
here = os.path.dirname(os.path.abspath(__file__))
BBOX = "22.85,120.0,23.45,120.75"
UA = "hex-city-demo/1.0 (personal demo)"
URL = "https://overpass-api.de/api/interpreter"
def http_get(url, data=None, timeout=300):
    """用 curl 取代 urllib（本機 Python 沒有 SSL 憑證）；Overpass 沒帶 User-Agent 會回 406。"""
    cmd = ["curl", "-sL", "--max-time", str(timeout), "-A", UA, url]
    if data is not None: cmd += ["--data-urlencode", "data=" + data]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0: raise RuntimeError("curl failed " + str(r.returncode))
    return r.stdout
def overpass(q, tries=6):
    """Overpass 滿載時回 HTML（502／429）：指數退避重試。"""
    wait = 15
    for k in range(tries):
        body = http_get(URL, data=q, timeout=300)
        try: return json.loads(body)
        except ValueError:
            print(f"  Overpass 忙線（第 {k + 1} 次），{wait} 秒後重試：{body[:60]!r}", flush=True)
            time.sleep(wait); wait *= 2
    raise RuntimeError("Overpass 一直忙線，稍後再跑")

ways = overpass(f'[out:json][timeout:240];way["highway"~"^(motorway|motorway_link|trunk|trunk_link)$"]({BBOX});out body geom;')
time.sleep(5)
junctions = overpass(f'[out:json][timeout:240];node["highway"="motorway_junction"]({BBOX});out;')
merged = {"version": ways.get("version"), "osm3s": ways.get("osm3s"), "elements": ways["elements"] + junctions["elements"]}
out = os.path.join(here, "raw", "osm_highways.json")
data = json.dumps(merged, ensure_ascii=False).encode("utf-8")
open(out, "wb").write(data)
print("highways", len(data) // 1024, "KB", len(ways["elements"]), "ways", len(junctions["elements"]), "junctions", flush=True)
