"""用 Open-Meteo Elevation API 抓台南範圍的高程格點，存成 tools/raw/elevation_grid.json。"""
import json, os, time, urllib.parse
UA = "hex-city-demo/1.0"
import subprocess
def http_get(url, data=None, timeout=300):
    """用 curl 取代 urllib（本機 Python 沒有 SSL 憑證）。"""
    cmd = ["curl", "-sL", "--max-time", str(timeout), "-A", UA, url]
    if data is not None: cmd += ["--data-urlencode", "data=" + data]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0: raise RuntimeError("curl failed " + str(r.returncode))
    return r.stdout

here = os.path.dirname(os.path.abspath(__file__))
LON0, LON1, LAT0, LAT1, STEP = 120.0, 0, 0, 0, 0.01
LON0, LON1 = 120.02, 120.72
LAT0, LAT1 = 22.88, 23.42
lons = [round(LON0 + i * STEP, 4) for i in range(int(round((LON1 - LON0) / STEP)) + 1)]
lats = [round(LAT0 + j * STEP, 4) for j in range(int(round((LAT1 - LAT0) / STEP)) + 1)]
pts = [(la, lo) for la in lats for lo in lons]
elev = []
for k in range(0, len(pts), 100):
    chunk = pts[k:k + 100]
    url = "https://api.open-meteo.com/v1/elevation?" + urllib.parse.urlencode({"latitude": ",".join(str(p[0]) for p in chunk), "longitude": ",".join(str(p[1]) for p in chunk)})
    for attempt in range(3):
        try:
            elev.extend(json.loads(http_get(url, timeout=60))["elevation"]); break
        except Exception as e:
            print("retry", k, e, flush=True); time.sleep(3)
    else:
        elev.extend([0] * len(chunk))
    time.sleep(0.3)
json.dump({"lons": lons, "lats": lats, "step": STEP, "elevation": elev}, open(os.path.join(here, "raw", "elevation_grid.json"), "w"))
print("elevation grid", len(lons), "x", len(lats), "max", max(elev), "m", flush=True)
