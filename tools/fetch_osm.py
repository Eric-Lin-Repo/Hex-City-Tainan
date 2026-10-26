"""用 Overpass API 抓台南範圍的鐵路、河流、水域幾何，存成 tools/raw/osm_*.json。"""
import json, os
here = os.path.dirname(os.path.abspath(__file__))
BBOX = "22.85,120.0,23.45,120.75"
UA = "hex-city-demo/1.0 (personal demo)"
import subprocess
def http_get(url, data=None, timeout=300):
    """用 curl 取代 urllib（本機 Python 沒有 SSL 憑證）。"""
    cmd = ["curl", "-sL", "--max-time", str(timeout), "-A", UA, url]
    if data is not None: cmd += ["--data-urlencode", "data=" + data]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0: raise RuntimeError("curl failed " + str(r.returncode))
    return r.stdout

QUERIES = {
  "rail": f'[out:json][timeout:120];(way["railway"~"^(rail|light_rail|narrow_gauge)$"]({BBOX}););out geom;',
  "water": f'[out:json][timeout:180];(way["waterway"~"^(river|canal)$"]({BBOX});way["natural"="water"]["water"~"^(reservoir|lake|pond|lagoon)$"]({BBOX});relation["natural"="water"]["water"~"^(reservoir|lake|lagoon)$"]({BBOX}););out geom;',
}
for name, q in QUERIES.items():
    url = "https://overpass-api.de/api/interpreter"
    data = http_get(url, data=q, timeout=300)
    out = os.path.join(here, "raw", f"osm_{name}.json")
    open(out, "wb").write(data)
    j = json.loads(data)
    print(name, len(data) // 1024, "KB", len(j.get("elements", [])), "elements", flush=True)
