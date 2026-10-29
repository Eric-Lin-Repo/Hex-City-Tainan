#!/usr/bin/env python3
"""國道即時路況的路段對照：把高公局「交通資料庫」的路段（Section.xml、SectionShape.xml）轉成地圖座標，只留台南境內國道 1、3、8 號的分向路段。

來源：https://tisvcloud.freeway.gov.tw/history/motc20/ 的 Section.xml 與 SectionShape.xml（每天更新；存在 tools/raw/freeway_*.xml），
資料來源標示「交通部高速公路局『交通資料庫』」。SectionShape 的 LINESTRING 點序就是行車方向（南下的緯度遞減，已驗證）。
輸出 data/freeway_sections.json：[{ id, name, route, dir, limit, pts: [[x, z], ...] }]。
路段怎麼對上 data/highways.json 的路段鏈（逐段找最近、方向相同的路段）在前端 traffic.js 的 matchSections，
即時車速由 Worker 的 /api/freeway 抓 LiveTraffic.xml。

用法：python3 -I tools/build_traffic.py（要先有 data/city.json 與 data/highways.json）
"""
import json, math, os, xml.etree.ElementTree as ET

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
RAW = os.path.join(ROOT, "tools", "raw")
NS = {"t": "http://traffic.transportdata.tw/standard/traffic/schema/"}
ROUTES = {"國道1號": "nh1", "國道3號": "nh3", "國道8號": "nh8"}
NEAR = 1.5  # 路段要有點離同一條路的路段鏈這麼近（地圖單位）才算台南境內
CLIP = 3.0  # 路段的點離路段鏈超過這個距離就剪掉（跨出台南的部分）
STEP = 0.25  # 簡化：相鄰兩點至少隔這麼遠


def main():
    city = json.load(open(os.path.join(ROOT, "data", "city.json"), encoding="utf-8"))
    hw = json.load(open(os.path.join(ROOT, "data", "highways.json"), encoding="utf-8"))
    P = city["projection"]
    proj = lambda lon, lat: ((lon - P["lon_c"]) * P["km_x"] * P["k"], -(lat - P["lat_c"]) * P["km_z"] * P["k"])

    # 每條路的路段鏈點放進格子，查最近距離用
    grid = {}
    for c in hw["chains"]:
        if c["route"] not in ROUTES.values():
            continue
        for x, z, _ in c["pts"]:
            grid.setdefault((c["route"], math.floor(x), math.floor(z)), []).append((x, z))

    def dist(route, x, z):
        best = math.inf
        for i in range(-3, 4):
            for j in range(-3, 4):
                for px, pz in grid.get((route, math.floor(x) + i, math.floor(z) + j), ()):
                    best = min(best, math.hypot(px - x, pz - z))
        return best

    sec = {e.findtext("t:SectionID", namespaces=NS): e for e in ET.parse(os.path.join(RAW, "freeway_Section.xml")).getroot().iter(f"{{{NS['t']}}}Section")}
    out = []
    for e in ET.parse(os.path.join(RAW, "freeway_SectionShape.xml")).getroot().iter(f"{{{NS['t']}}}SectionShape"):
        sid, geo = e.findtext("t:SectionID", namespaces=NS), e.findtext("t:Geometry", namespaces=NS) or ""
        s = sec.get(sid)
        route = s is not None and ROUTES.get(s.findtext("t:RoadName", namespaces=NS))
        if not route or "(" not in geo:
            continue
        pts = [proj(*map(float, p.split())) for p in geo[geo.index("(") + 1:geo.rindex(")")].split(",")]
        if min(dist(route, x, z) for x, z in pts) > NEAR:
            continue
        keep = []
        for x, z in pts:
            if dist(route, x, z) > CLIP:
                continue
            if not keep or math.hypot(x - keep[-1][0], z - keep[-1][1]) >= STEP:
                keep.append((x, z))
        if len(keep) >= 2:
            out.append({"id": sid, "name": s.findtext("t:SectionName", namespaces=NS), "route": route, "dir": s.findtext("t:RoadDirection", namespaces=NS),
                        "limit": int(s.findtext("t:SpeedLimit", namespaces=NS) or 0), "pts": [[round(x, 3), round(z, 3)] for x, z in keep]})
    out.sort(key=lambda r: r["id"])
    body = {"note": "國道 1、3、8 號台南境內的分向路段（交通部高速公路局『交通資料庫』Section.xml／SectionShape.xml），座標投影同 city.json；pts 依行車方向。由 tools/build_traffic.py 產生", "sections": out}
    with open(os.path.join(ROOT, "data", "freeway_sections.json"), "w", encoding="utf-8") as f:
        json.dump(body, f, ensure_ascii=False, separators=(",", ":"))
    per = {}
    for r in out:
        per[r["route"]] = per.get(r["route"], 0) + 1
    print(f"freeway_sections: {len(out)} 個路段", per, f"{sum(len(r['pts']) for r in out)} 點")


if __name__ == "__main__":
    main()
