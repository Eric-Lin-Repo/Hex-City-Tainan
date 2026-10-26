"""用 Overpass API 抓山海圳國家綠道（上行）與幾條代表性自行車道的 relation（含成員 way 幾何），存成 tools/raw/osm_trails.json。
執行：python3 -I tools/fetch_trails.py（需要網路；Overpass 要帶 User-Agent 否則回 406）"""
import json, os, subprocess
here = os.path.dirname(os.path.abspath(__file__))
BBOX = "22.85,120.0,23.45,120.75"
UA = "hex-city-demo/1.0 (personal demo)"
# 要抓的路線：山海圳用「上行」那條 relation；自行車道用 route=bicycle 的 name 精準比對
CYCLEWAYS = ["八田自行車道", "西拉雅自行車道", "台江大道", "黃金海岸自行車道", "北門自行車道", "新營菁寮自行車道"]
QUERY = (f'[out:json][timeout:180];('
         f'relation["name"~"山海圳"]["name"~"上行"]({BBOX});'
         f'relation["route"="bicycle"]["name"~"^({"|".join(CYCLEWAYS)})$"]({BBOX});'
         f');out geom;')

def http_get(url, data=None, timeout=300):
    """用 curl 取代 urllib（本機 Python 沒有 SSL 憑證）。"""
    cmd = ["curl", "-sL", "--max-time", str(timeout), "-A", UA, url]
    if data is not None: cmd += ["--data-urlencode", "data=" + data]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0: raise RuntimeError("curl failed " + str(r.returncode))
    return r.stdout

# 公用 Overpass 常常滿載回 502：輪流試幾個鏡像，失敗就指數退避重試
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://lz4.overpass-api.de/api/interpreter"]
import time
data, j = b"", None
for attempt in range(6):
    url = ENDPOINTS[attempt % len(ENDPOINTS)]
    try:
        data = http_get(url, data=QUERY, timeout=300)
        j = json.loads(data)
        break
    except (RuntimeError, ValueError) as e:
        wait = 5 * 2 ** attempt
        print(f"{url} 失敗（{type(e).__name__}：{data[:80].decode('utf-8', 'replace').strip()!r}），{wait}s 後重試", flush=True)
        time.sleep(wait)
if j is None: raise SystemExit("Overpass 多次重試仍失敗")
rels = [e for e in j.get("elements", []) if e.get("type") == "relation"]
if not rels: raise SystemExit("Overpass 沒回任何 relation：\n" + data[:300].decode("utf-8", "replace"))
out = os.path.join(here, "raw", "osm_trails.json")
open(out, "wb").write(data)
print("trails", len(data) // 1024, "KB", len(rels), "relations", flush=True)
for r in rels:
    ways = [m for m in r.get("members", []) if m.get("type") == "way" and m.get("geometry")]
    print(f'  {r["id"]:>10} {r["tags"].get("name", "?")}  ways={len(ways)} pts={sum(len(m["geometry"]) for m in ways)}')
