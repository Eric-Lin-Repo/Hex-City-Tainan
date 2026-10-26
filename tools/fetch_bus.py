"""用 Overpass API 抓台南六色公車（藍、綠、紅、橘、黃、棕的幹線與支線，含往返程、繞駛、延駛）的 route relation，
存成 tools/raw/osm_bus.json。之後由 build_bus.py 離線讀 raw 檔產出 data/bus.json 與 data/bus_branches.json。
用法：python3 -I tools/fetch_bus.py"""
import json, os, subprocess, time
here = os.path.dirname(os.path.abspath(__file__))
BBOX = "22.85,120.0,23.45,120.75"
UA = "hex-city-demo/1.0 (personal demo)"
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

URL = "https://overpass-api.de/api/interpreter"
# ref 以顏色開頭、後面接數字或「幹」：藍幹線、綠17、黃10-1……（高雄的紅 6x／7x 線也會被抓到，build_bus.py 再依 network 與落在台南的比例排除）
SEL = f'relation["route"="bus"]["ref"~"^(藍|綠|紅|橘|黃|棕)([0-9]|幹)"]({BBOX})'
# 第一次：relation 本體。out geom 會把成員 way 的座標附上，成員順序即路線順序；role=stop/platform 的 node 是站牌
rels = overpass(f"[out:json][timeout:240];{SEL};out geom;")
time.sleep(5)
# 第二次：站牌節點的 tags（out geom 不含成員 node 的 name），之後用 id 對回去
nodes = overpass(f"[out:json][timeout:240];{SEL};node(r);out;")
merged = {"version": rels.get("version"), "generator": rels.get("generator"), "osm3s": rels.get("osm3s"), "elements": rels["elements"] + nodes["elements"]}
out = os.path.join(here, "raw", "osm_bus.json")
data = json.dumps(merged, ensure_ascii=False).encode("utf-8")
open(out, "wb").write(data)
relations = [e for e in rels["elements"] if e.get("type") == "relation"]
print("bus", len(data) // 1024, "KB", len(relations), "relations", len(nodes["elements"]), "stop nodes", flush=True)
