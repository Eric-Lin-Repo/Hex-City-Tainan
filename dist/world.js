// 以真實行政區輪廓擠出成島、區與區之間架橋、行人用的鄰接圖與路線。資料來自 data/city.json。
export const TOP = 0.6; // 地面高度
export const DEPTH = 1.4;
const SMALL_AREA_1X = 24; // 1 倍地圖時，面積（世界單位²）小於此的市區：建築與景點縮小（與 tools/build_city.py 的 SMALL_AREA 一致，實際乘 scale²）

// 固定種子亂數，讓裝飾每次重整都長一樣
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 把 2D 輪廓擠出成島體：上蓋是陸地色，側面與斜坡是沙灘色
function landMass(THREE, pts, depth, topColor, sideColor, bevel = 0.12) {
  const shape = new THREE.Shape(pts);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 1.5, bevelSegments: 3 });
  g.rotateX(Math.PI / 2); // 擠出方向 +z 轉成 −y，輪廓的 y 變成世界的 z
  g.translate(0, -bevel, 0); // 旋轉後上蓋在 y = +bevel，往下移讓上蓋對齊 y = 0，斜坡從陸地往海面降
  const mesh = new THREE.Mesh(g, [
    new THREE.MeshStandardMaterial({ color: topColor, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.95 }),
  ]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// 海岸線（裝飾小島用）：圓形乘上幾個頻率的正弦波
function coastline(THREE, rnd, radius, n = 28, amp = 0.3) {
  const ph = [rnd() * 6.283, rnd() * 6.283, rnd() * 6.283];
  const pts = [];
  for (let k = 0; k < n; k++) {
    const th = (k / n) * Math.PI * 2;
    const nz = 0.55 * Math.sin(2 * th + ph[0]) + 0.3 * Math.sin(5 * th + ph[1]) + 0.15 * Math.sin(9 * th + ph[2]);
    const r = radius * (1 + amp * nz);
    pts.push(new THREE.Vector2(Math.cos(th) * r, Math.sin(th) * r));
  }
  return pts;
}

const pointInPoly = (poly, x, z) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const segDist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
};
const boundaryDist = (poly, x, z) => {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]));
  return d;
};

export function buildWorld(THREE, scene, D, kit, buildModel, tree) {
  const T = D.city;
  const S = T.scale ?? 1, SMALL_AREA = SMALL_AREA_1X * S * S; // 地圖放大倍數；面積門檻跟著乘 S²
  const islandsById = new Map(D.islands.map((i) => [i.id, i]));
  const centers = new Map(), adjacency = new Map(), buildingPos = new Map(), pickables = [], buildingHit = new Map();
  const polys = new Map(), slotsOf = new Map(), areaOf = new Map(), ports = new Map();
  const cream = 0xfff8f4, ink = new THREE.Color(0x211d1d), creamC = new THREE.Color(cream), sand = new THREE.Color(0xd9c4a3);
  const hiddenMat = new THREE.MeshBasicMaterial();

  // 市區四區建築擠：每棟依「離最近的建築或景點多遠」個別縮小，讓兩棟各占一半距離、屋簷不相碰。
  // 區的大小不變，只縮太寬又靠太近的模型；上限仍是原本的 0.58（建築）／0.62（景點），下限 0.4 免得縮成一點。
  const spanAt1 = new Map(); // 模型在比例 1 時離中心最遠的水平距離
  const halfSpan = (kind) => {
    if (!spanAt1.has(kind)) {
      let h = 0;
      buildModel({ part: (k, pos, size) => { h = Math.max(h, Math.abs(pos[0]) + size[0] / 2, Math.abs(pos[2]) + size[2] / 2); }, composeRot: (ry, rot) => rot }, kind, { x: 0, y: 0, z: 0 }, 1, 0x3e7c8c, 0);
      spanAt1.set(kind, h || 0.5);
    }
    return spanAt1.get(kind);
  };
  const modelScale = new Map(); // "building:id"／"poi:id" → 實際比例，鏡頭飛過去時依此拉近
  const smallIds = new Set(T.districts.filter((d) => d.area < SMALL_AREA).map((d) => d.id));
  const coreSpots = [...T.districts.filter((d) => smallIds.has(d.id)).flatMap((d) => d.slots), ...(D.poi?.pois || []).filter((p) => smallIds.has(p.district)).map((p) => p.pos)];
  const fitScale = (kind, x, z, max) => {
    let d = Infinity;
    for (const [sx, sz] of coreSpots) { const dd = Math.hypot(x - sx, z - sz); if (dd > 1e-3 && dd < d) d = dd; }
    return Math.max(0.4, Math.min(max, d / 2 / halfSpan(kind)));
  };
  const rnd = mulberry(7);
  // 地形：有高度場就把所有東西放在坡面上，沒有就全在 TOP
  const heightAt = D.heightAt || (() => 0);
  const groundY = (x, z) => TOP + heightAt(x, z);

  for (const dist of T.districts) {
    const isl = islandsById.get(dist.id);
    if (!isl) continue;
    polys.set(dist.id, dist.polygon);
    areaOf.set(dist.id, dist.area);
    const col = new THREE.Color(isl.color);
    const land = landMass(THREE, dist.polygon.map(([x, z]) => new THREE.Vector2(x, z)), DEPTH, col.clone().lerp(creamC, 0.6), col.clone().lerp(sand, 0.75), 0.08); // 斜坡縮小，區界只剩一條淺溝
    land.position.y = TOP;
    land.userData = { type: "island", id: dist.id };
    scene.add(land);
    pickables.push(land);

    // 區界線：沿輪廓畫貼地的深色細線，每 0.5 單位一段，跟著地形起伏
    const edgeColor = col.clone().lerp(ink, 0.55).getHex();
    const poly = dist.polygon;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / 0.5)), ry = Math.atan2(bx - ax, bz - az);
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n, mx = ax + (bx - ax) * (t0 + t1) / 2, mz = az + (bz - az) * (t0 + t1) / 2;
        kit.part("box", [mx, groundY(mx, mz) + 0.02, mz], [0.07, 0.025, len / n + 0.02], edgeColor, [0, ry, 0]);
      }
    }
    const hub = new THREE.Vector3(dist.hub[0], 0, dist.hub[1]);
    centers.set(dist.id, hub);
    const plazaR = Math.min(dist.hubClear * 0.75, 1.1);
    kit.part("cylinder", [hub.x, groundY(hub.x, hub.z) + 0.01, hub.z], [plazaR * 2, 0.02, plazaR * 2], cream); // 區中心廣場
    adjacency.set(dist.id, dist.neighbors);

    const slots = [];
    isl.buildings.forEach((b, i) => {
      const s = dist.slots[i];
      if (!s) { console.warn(`[hex-city] ${dist.id} 沒有第 ${i + 1} 個建築落點，略過 ${b.id}`); return; }
      const p = new THREE.Vector3(s[0], groundY(s[0], s[1]), s[1]);
      slots.push(s);
      buildingPos.set(b.id, p);
      // 建築正面朝向區中心（走廊所在），模型的正面在 +z
      const face = Math.atan2(hub.x - p.x, hub.z - p.z);
      const small = dist.area < SMALL_AREA; // 市區四區（中西、北、東、安平）建築多、面積小：模型縮成 0.58（間距見 build_city.py 的 SMALL_GAP）
      const sc = small ? fitScale(b.model, p.x, p.z, 0.58) : 0.75;
      modelScale.set("building:" + b.id, sc);
      kit.beginGroup("building:" + b.id, p); // 群組：中西區的次要建築要能整棟縮放（kit.setGroupScale）
      buildModel(kit, b.model, p, sc, isl.color, face);
      kit.endGroup();
      const hb = new THREE.Mesh(new THREE.BoxGeometry(small ? 0.75 : 0.85, small ? 1.0 : 1.2, small ? 0.75 : 0.85), hiddenMat);
      hb.position.set(p.x, p.y + 0.6, p.z);
      hb.visible = false;
      hb.userData = { type: "building", id: b.id, island: dist.id };
      scene.add(hb);
      pickables.push(hb);
      buildingHit.set(b.id, hb);
    });
    slotsOf.set(dist.id, slots);
    kit.beginGroup("trees:" + dist.id);
    for (const [x, z, s, kind] of dist.trees) tree(kit, x, groundY(x, z), z, s, kind);
    kit.endGroup();
  }

  // 區與區之間的橋頭（不畫橋，只給行人路線當跨區點）
  for (const br of T.bridges) {
    const a = new THREE.Vector3(br.from[0], TOP, br.from[1]), b = new THREE.Vector3(br.to[0], TOP, br.to[1]);
    ports.set(`${br.a}|${br.b}`, [a, b]);
    ports.set(`${br.b}|${br.a}`, [b, a]);
    // 橋梁已移除：只保留橋頭座標給行人路線使用
  }

  // ── 陸地判斷、活動地點、障礙物 ──
  const isLand = (x, z) => { for (const poly of polys.values()) if (pointInPoly(poly, x, z)) return true; return false; };
  // 湖面（大半在陸地上的，跟 infrastructure.js 畫的同一批）：行人與阿明不走進湖裡，岸邊留 0.2
  const lakes = (D.water?.lakes || []).filter((lk) => lk.polygon?.length >= 3 && lk.polygon.filter(([x, z]) => isLand(x, z)).length / lk.polygon.length >= 0.5)
    .map((lk) => { const xs = lk.polygon.map((p) => p[0]), zs = lk.polygon.map((p) => p[1]); return { poly: lk.polygon, box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)] }; });
  const inLake = (x, z, m = 0.2) => lakes.some(({ poly, box: [x0, x1, z0, z1] }) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m && (pointInPoly(poly, x, z) || boundaryDist(poly, x, z) < m));
  // 活動地點：行人會被吸引過去，散步時避開活動本體
  const eventsByDistrict = new Map();
  for (const ev of (D.events?.events || [])) {
    if (!eventsByDistrict.has(ev.district)) eventsByDistrict.set(ev.district, []);
    eventsByDistrict.get(ev.district).push({ ...ev, pos: new THREE.Vector3(ev.pos[0], groundY(ev.pos[0], ev.pos[1]), ev.pos[1]), active: true });
  }
  const eventsIn = (id) => (eventsByDistrict.get(id) || []).filter((e) => e.active); // 只有進行中的活動會吸引人
  function setEventActive(id, on) { for (const l of eventsByDistrict.values()) for (const e of l) if (e.id === id) e.active = on; }
  // 整區的樹換色（木棉花季），color 為 null 恢復
  const setTreeColor = (districtId, color) => kit.setGroupColor("trees:" + districtId, color, ["sphere", "cone"]);
  // 活動效果（炮城、王船、蜈蚣陣路線）登記成障礙物，行人散步時避開
  const obstacles = new Map();
  function addObstacle(districtId, x, z, r) {
    if (!obstacles.has(districtId)) obstacles.set(districtId, []);
    obstacles.get(districtId).push([x, z, r]);
  }
  // 鐵路與車站改由 infrastructure.js 建；車站建好後用 registerStations 登記進來，行人散步時才會避開
  const stationsByDistrict = new Map();
  function registerStations(list) {
    stationsByDistrict.clear();
    for (const s of list) {
      if (!stationsByDistrict.has(s.district)) stationsByDistrict.set(s.district, []);
      stationsByDistrict.get(s.district).push(s);
    }
  }

  // ── 景點、夜市、科學園區 ──
  const pois = [], poisByDistrict = new Map(), poiById = new Map();
  for (const po of (D.poi?.pois || [])) {
    const p = { ...po, pos: new THREE.Vector3(po.pos[0], groundY(po.pos[0], po.pos[1]), po.pos[1]), open: true };
    pois.push(p);
    poiById.set(p.id, p);
    if (!poisByDistrict.has(p.district)) poisByDistrict.set(p.district, []);
    poisByDistrict.get(p.district).push(p);
    const isl = islandsById.get(p.district);
    const ry = ((p.id.length * 37) % 6) * (Math.PI / 6) - Math.PI / 4; // 固定但各自不同的朝向
    kit.beginGroup("poi:" + p.id);
    const smallPoi = (areaOf.get(p.district) || 99) < SMALL_AREA;
    const psc = p.type === "sciencepark" ? 0.9 : smallPoi ? fitScale(p.model, p.pos.x, p.pos.z, 0.62) : 0.8;
    modelScale.set("poi:" + p.id, psc);
    if (p.model !== "none") buildModel(kit, p.model, p.pos, psc, isl ? isl.color : 0x3e7c8c, ry); // model "none"：模型由別處畫（例如四草綠色隧道由 scenery.js 畫在景點位置）
    kit.endGroup();
    const hb = new THREE.Mesh(new THREE.BoxGeometry(smallPoi ? 0.9 : 1.4, smallPoi ? 0.7 : 1.0, smallPoi ? 0.7 : 1.1), hiddenMat);
    hb.position.set(p.pos.x, p.pos.y + 0.5, p.pos.z);
    hb.rotation.y = ry;
    hb.visible = false;
    hb.userData = { type: "poi", id: p.id };
    scene.add(hb);
    pickables.push(hb);
  }
  // 科學園區：用圍籬框住所有園區點
  const park = pois.filter((p) => p.type === "sciencepark");
  if (park.length) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of park) { minX = Math.min(minX, p.pos.x); maxX = Math.max(maxX, p.pos.x); minZ = Math.min(minZ, p.pos.z); maxZ = Math.max(maxZ, p.pos.z); }
    minX -= 1.1; maxX += 1.1; minZ -= 1.1; maxZ += 1.1;
    const edges = [[[minX, minZ], [maxX, minZ]], [[maxX, minZ], [maxX, maxZ]], [[maxX, maxZ], [minX, maxZ]], [[minX, maxZ], [minX, minZ]]];
    for (const [[ax, az], [bx, bz]] of edges) {
      const n = Math.max(2, Math.round(Math.hypot(bx - ax, bz - az) / 0.6));
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (isLand(x, z)) kit.part("box", [x, groundY(x, z) + 0.12, z], [0.04, 0.24, 0.04], 0x9aa4b2);
      }
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, len = Math.hypot(bx - ax, bz - az), ry = Math.atan2(bx - ax, bz - az);
      kit.part("box", [mx, TOP + 0.2, mz], [0.02, 0.02, len], 0x9aa4b2, [0, ry, 0]);
    }
    kit.part("box", [(minX + maxX) / 2, TOP + 0.45, maxZ], [1.2, 0.3, 0.06], 0x2f6f9f); // 園區門牌
    kit.part("glow", [(minX + maxX) / 2, TOP + 0.45, maxZ + 0.035], [1.0, 0.18, 0.01], 0xffffff);
    for (const x of [(minX + maxX) / 2 - 0.6, (minX + maxX) / 2 + 0.6]) kit.part("box", [x, TOP + 0.3, maxZ], [0.08, 0.6, 0.08], 0x2f6f9f);
  }

  // 外圍裝飾小島
  const B = T.bounds, cx = (B.minX + B.maxX) / 2, cz = (B.minZ + B.maxZ) / 2;
  const R0 = Math.max(B.maxX - B.minX, B.maxZ - B.minZ) / 2 + 4 * S;
  for (let i = 0; i < 18; i++) {
    const a = rnd() * Math.PI * 2, d = R0 + rnd() * 9 * S;
    const x = cx + Math.cos(a) * d * 1.1, z = cz + Math.sin(a) * d, s = 0.6 + rnd() * 1.1;
    const islet = landMass(THREE, coastline(THREE, rnd, s), 0.7, rnd() > 0.5 ? 0x8fa07a : 0xa8b58c, 0xd9c4a3, 0.08);
    islet.position.set(x, 0, z);
    scene.add(islet);
    tree(kit, x, 0, z, 0.4 + rnd() * 0.5, rnd() > 0.5 ? "round" : "cone");
    if (s > 1.2) tree(kit, x + s * 0.5, 0, z - s * 0.3, 0.35, "cone");
  }

  // 最短路徑（BFS）
  function pathBetween(a, b) {
    const prev = new Map([[a, null]]), queue = [a];
    while (queue.length) {
      const cur = queue.shift();
      if (cur === b) break;
      for (const n of adjacency.get(cur) || []) if (!prev.has(n)) { prev.set(n, cur); queue.push(n); }
    }
    if (!prev.has(b)) return [a, b];
    const out = [];
    for (let n = b; n !== null; n = prev.get(n)) out.unshift(n);
    return out;
  }
  // 路線點：區中心 → 本區橋頭 → 對岸橋頭 → 下一區中心 …
  function route(a, b) {
    const ids = pathBetween(a, b);
    const lift = (v) => v.clone().setY(groundY(v.x, v.z));
    const pts = [lift(centers.get(ids[0]))];
    for (let i = 1; i < ids.length; i++) {
      const pair = ports.get(`${ids[i - 1]}|${ids[i]}`);
      if (pair) pts.push(pair[0].clone(), pair[1].clone());
      pts.push(lift(centers.get(ids[i])));
    }
    return pts;
  }

  // 公路（highways.js 建好後由 app 呼叫 setRoads）：用格子索引查，行人散步不停在公路上
  const ROAD_CELL = 4, roadGrid = new Map();
  function setRoads(lines) {
    roadGrid.clear();
    for (const pts of lines) for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      for (let gx = Math.floor(Math.min(ax, bx) / ROAD_CELL); gx <= Math.floor(Math.max(ax, bx) / ROAD_CELL); gx++)
        for (let gz = Math.floor(Math.min(az, bz) / ROAD_CELL); gz <= Math.floor(Math.max(az, bz) / ROAD_CELL); gz++) {
          const key = gx + "," + gz; if (!roadGrid.has(key)) roadGrid.set(key, []); roadGrid.get(key).push([ax, az, bx, bz]);
        }
    }
  }
  function nearRoad(x, z, m = 0.3) {
    const gx0 = Math.floor(x / ROAD_CELL), gz0 = Math.floor(z / ROAD_CELL);
    for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) for (let gz = gz0 - 1; gz <= gz0 + 1; gz++) // 鄰格也查：線段可能剛好在格子邊外
      for (const [ax, az, bx, bz] of roadGrid.get(gx + "," + gz) || []) {
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
        if (Math.hypot(ax + dx * t - x, az + dz * t - z) < m) return true;
      }
    return false;
  }
  // 每區的田 [x, z, 寬, 深, 旋轉]（行人與景觀都不走、不放在田上）
  const fieldsOf = new Map(T.districts.map((d) => [d.id, d.fields || []]));
  const inField = (id, x, z, m = 0.1) => fieldsOf.get(id).some(([fx, fz, w, d, ry]) => { const c = Math.cos(ry), s = Math.sin(ry), dx = x - fx, dz = z - fz; return Math.abs(dx * c - dz * s) < w / 2 + m && Math.abs(dx * s + dz * c) < d / 2 + m; });
  // 區內空地判斷：在輪廓內、離岸邊有距離、離建築有距離、不在田上
  function clear(id, x, z, margin = 0.6) {
    const poly = polys.get(id);
    if (!poly || !pointInPoly(poly, x, z) || boundaryDist(poly, x, z) < 0.3) return false;
    if ((stationsByDistrict.get(id) || []).some((s) => Math.hypot(x - s.pos.x, z - s.pos.z) < 0.85)) return false;
    const poiMargin = (areaOf.get(id) || 99) < SMALL_AREA ? 0.6 : 0.95;
    if ((poisByDistrict.get(id) || []).some((p) => Math.hypot(x - p.pos.x, z - p.pos.z) < poiMargin)) return false;
    if ((obstacles.get(id) || []).some(([ox, oz, r]) => Math.hypot(x - ox, z - oz) < r)) return false;
    if (inLake(x, z) || inField(id, x, z) || nearRoad(x, z)) return false;
    return slotsOf.get(id).every(([sx, sz]) => Math.hypot(x - sx, z - sz) > margin);
  }
  // 在某點附近找一個空地（行人去車站時用）
  function randomPointNear(id, p, r) {
    for (let k = 0; k < 16; k++) {
      const a = r() * Math.PI * 2, d = 1.0 + r() * 1.0;
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (clear(id, x, z)) return new THREE.Vector3(x, groundY(x, z), z);
    }
    return randomPoint(id, r);
  }
  const poisIn = (id) => poisByDistrict.get(id) || [];
  // 依星期切換夜市營業狀態：休市的燈籠與招牌變暗、行人不再聚集
  function setToday(weekday) {
    for (const p of pois) {
      if (p.type !== "nightmarket") continue;
      p.open = (p.days || []).includes(weekday);
      kit.setGroupDim("poi:" + p.id, !p.open);
    }
  }
  function segmentClear(id, p, q) {
    const n = Math.max(10, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.3)); // 每 0.3 單位查一次：田約 1 單位寬，固定 11 點在地圖放大後會漏掉
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!clear(id, p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t, 0.55)) return false;
    }
    return true;
  }
  function randomPoint(id, r) {
    const poly = polys.get(id);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    for (let k = 0; k < 30; k++) {
      const x = minX + r() * (maxX - minX), z = minZ + r() * (maxZ - minZ);
      if (clear(id, x, z)) return new THREE.Vector3(x, groundY(x, z), z);
    }
    const c = centers.get(id);
    return c.clone().setY(groundY(c.x, c.z));
  }
  const radiusOf = (id) => Math.sqrt((areaOf.get(id) || 10) / Math.PI);
  // 某個世界座標落在哪一區（沒有就 null）
  // 市區四區的建築被縮小過：算出每區建築與景點的平均縮放相對郊區（建築 0.75）的比例，行人走進去時跟著縮（people.js）
  const zoneScale = new Map();
  for (const id of smallIds) {
    const ks = [...(islandsById.get(id)?.buildings || []).map((b) => modelScale.get("building:" + b.id)), ...pois.filter((p) => p.district === id).map((p) => modelScale.get("poi:" + p.id))].filter((v) => v != null);
    if (ks.length) zoneScale.set(id, Math.max(0.6, Math.min(1, ks.reduce((a, b) => a + b, 0) / ks.length / 0.75)));
  }
  function districtAt(x, z) { for (const [id, poly] of polys) if (pointInPoly(poly, x, z)) return id; return null; }
  // 世界座標 → 經緯度（用前處理寫進 city.json 的投影常數）
  const P = T.projection;
  const toLonLat = (x, z) => (P ? [x / (P.km_x * P.k) + P.lon_c, -z / (P.km_z * P.k) + P.lat_c] : null);
  const areaKm2 = (id) => (P ? (areaOf.get(id) || 0) / (P.k * P.k) : null);

  return { centers, adjacency, buildingPos, pickables, pathBetween, route, randomPoint, randomPointNear, segmentClear, radiusOf, districtAt, isCore: (id) => smallIds.has(id), scaleOf: (key) => modelScale.get(key), zoneScale: (id) => zoneScale.get(id) ?? 1, toLonLat, areaKm2, bounds: T.bounds, registerStations, setRoads, onRoad: (x, z) => nearRoad(x, z, 0.3), heightAt, groundY, pois, poiById, poisIn, setToday, eventsIn, setEventActive, setTreeColor, addObstacle, onLand: isLand,
    // 整棟建築縮放（0 隱藏、1 原尺寸）；縮到一半以下就不能點
    // 附近 r 以內有沒有建築（任何區）：放大型景觀時避開建築用
    nearBuilding: (x, z, r) => { for (const slots of slotsOf.values()) for (const [sx, sz] of slots) if (Math.hypot(x - sx, z - sz) < r) return true; return false; },
    setBuildingScale: (id, k) => { kit.setGroupScale("building:" + id, k); const hb = buildingHit.get(id); if (hb) hb.userData.hidden = k < 0.5; }, isClear: (x, z, margin = 0.6) => { const id = districtAt(x, z); return !!id && clear(id, x, z, margin); }, inLake };
}
