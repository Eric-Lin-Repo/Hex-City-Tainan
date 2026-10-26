"""補公車路線缺口：OSM 的公車 relation 有時少收幾段路，build_bus.py 會把缺口（起點、途經站牌、終點的經緯度）
寫到 tools/raw/bus_gaps_todo.json。這支程式用 OSRM 公開路徑規劃（router.project-osrm.org，資料也是 OSM）查沿道路的路線，
存到 tools/raw/bus_gap_routes.json，之後 build_bus.py 離線讀快取。用法：
  python3 -I tools/build_bus.py && python3 -I tools/fetch_bus_gaps.py && python3 -I tools/build_bus.py"""
import json, os, subprocess, time
here = os.path.dirname(os.path.abspath(__file__))
TODO = os.path.join(here, "raw", "bus_gaps_todo.json")
CACHE = os.path.join(here, "raw", "bus_gap_routes.json")
UA = "hex-city-demo/1.0 (personal demo)"
todo = json.load(open(TODO, encoding="utf-8"))
cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}
ok = fail = 0
for key, way in todo.items():
    if cache.get(key): continue
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lon, lat in way)
    url = f"https://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=geojson"
    r = subprocess.run(["curl", "-sL", "--max-time", "60", "-A", UA, url], capture_output=True)  # 本機 Python 沒有 SSL 憑證，用 curl
    try:
        d = json.loads(r.stdout)
        line = d["routes"][0]["geometry"]["coordinates"] if d.get("code") == "Ok" else None
    except (ValueError, KeyError, IndexError):
        line = None
    if line: cache[key] = [way[0]] + [[round(x, 6), round(y, 6)] for x, y in line] + [way[-1]]; ok += 1
    else: fail += 1; print("  查不到：", key[:80], r.stdout[:80])
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    time.sleep(1.1)  # OSRM 公開伺服器的使用規範：每秒最多一次
print(f"缺口路線：新查 {ok} 段，失敗 {fail} 段，快取共 {len(cache)} 段")
