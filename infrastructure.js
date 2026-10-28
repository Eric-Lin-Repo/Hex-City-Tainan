// 基礎建設：鐵路（台鐵軌道、高鐵高架）、車站、河川、湖泊。資料來自 data/rail.json 與 data/water_mrt.json。
//
// app.js 的接線方式（必須在 kit.build 之前呼叫，因為這裡會往 kit 塞零件）：
//   const world = buildWorld(THREE, scene, D, kit, buildModel, tree);
//   const infra = buildInfrastructure(THREE, scene, world, kit, D, buildModel); // D.rail = rail.json、D.water = water_mrt.json
//   kit.build(scene);
// 原本從 world 拿的鐵路欄位改從 infra 拿：
//   world.stations → infra.stations、world.lines → infra.lines、world.services → infra.services、
//   world.stationById → infra.stationById、world.stationsIn → infra.stationsIn（people.js 也用到 stationsIn）
// 另外新增：infra.rivers、infra.lakes。
// 車站 hitbox（userData {type:"station", id}）會推進 world.pickables。
import { TOP } from "./world.js";

const WATER = 0x5f9bbf, SHORE = 0x3f6f8f;
const hex = (c) => (typeof c === "string" ? parseInt(c.slice(1), 16) : c);
const segDist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
};

export function buildInfrastructure(THREE, scene, world, kit, D, buildModel) {
  const rail = D.rail || { stations: [], lines: [], services: [] };
  const water = D.water || { rivers: [], lakes: [] };
  const onLand = world.onLand;
  const hiddenMat = new THREE.MeshBasicMaterial();
  const V = (x, z, y = TOP) => new THREE.Vector3(x, y, z);
  const hitbox = (pos, size, ry, userData) => {
    const hb = new THREE.Mesh(new THREE.BoxGeometry(...size), hiddenMat);
    hb.position.copy(pos);
    hb.rotation.y = ry;
    hb.visible = false;
    hb.userData = userData;
    scene.add(hb);
    world.pickables.push(hb);
    return hb;
  };
  // 沿線段擺零件用的小工具：ry 是線段方向（零件長邊沿本地 z），lateral 往左右偏移
  const segInfo = (a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    return { dx, dz, len, ry: Math.atan2(dx, dz), mx: (a[0] + b[0]) / 2, mz: (a[1] + b[1]) / 2 };
  };
  const lateral = (ry, s) => [Math.cos(ry) * s, -Math.sin(ry) * s];

  // ── 車站 ──
  const stations = [], stationById = new Map(), stationsByDistrict = new Map();
  for (const st of rail.stations) {
    const s = { ...st, pos: V(st.pos[0], st.pos[1]), ry: 0, neighbors: [] };
    stations.push(s);
    stationById.set(s.id, s);
    if (!stationsByDistrict.has(s.district)) stationsByDistrict.set(s.district, []);
    stationsByDistrict.get(s.district).push(s);
  }

  // ── 鐵路線 ──
  const lines = rail.lines.map((ln) => ({
    id: ln.id, name: ln.name, color: ln.color, kind: ln.kind || "tra", stations: ln.stations || [],
    points: (ln.points?.length ? ln.points : (ln.stations || []).map((id) => { const p = stationById.get(id).pos; return [p.x, p.z]; })).map(([x, z]) => V(x, z)),
    stops: ln.stops || [],
  }));

  // 畫軌道前先把幾乎共線的連續點合併（偏差小於 tol），密集折線在直線段就不會產生一堆小零件；火車行駛仍用原始密集點
  function simplify(pts, tol = 0.03) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      while (j + 1 < pts.length) {
        let ok = true;
        for (let k = i + 1; k <= j; k++) if (segDist(pts[k].x, pts[k].z, pts[i].x, pts[i].z, pts[j + 1].x, pts[j + 1].z) > tol) { ok = false; break; }
        if (!ok) break;
        j++;
      }
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
  // 沿折線每隔 gap 取一點（回傳 [x, z, ry]），枕木與橋柱用
  function alongPath(pts, gap) {
    const out = [];
    let carry = gap / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = [pts[i].x, pts[i].z], b = [pts[i + 1].x, pts[i + 1].z];
      const { dx, dz, len, ry } = segInfo(a, b);
      if (len < 1e-6) continue;
      for (let d = carry; d < len; d += gap) out.push([a[0] + (dx * d) / len, a[1] + (dz * d) / len, ry]);
      carry = ((carry - len) % gap + gap) % gap;
    }
    return out;
  }

  // 台鐵：道碴路基、兩條鐵軌、枕木，跨水道處加橋墩（與原本 world.js 一樣的樣子）
  function traTrack(rawPts) {
    const pts = simplify(rawPts);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = [pts[i].x, pts[i].z], b = [pts[i + 1].x, pts[i + 1].z];
      const { len, ry, mx, mz } = segInfo(a, b);
      if (len < 1e-4) continue;
      kit.part("box", [mx, TOP + 0.03, mz], [0.62, 0.06, len + 0.2], 0x8f877b, [0, ry, 0]); // 道碴路基（多伸 0.1 蓋住轉角縫）
      for (const s of [-1, 1]) {
        const [ox, oz] = lateral(ry, s * 0.1);
        kit.part("box", [mx + ox, TOP + 0.08, mz + oz], [0.035, 0.04, len + 0.1], 0x2e3136, [0, ry, 0]); // 鐵軌
      }
    }
    alongPath(pts, 0.26).forEach(([x, z, ry], k) => {
      kit.part("box", [x, TOP + 0.062, z], [0.34, 0.02, 0.09], 0x4a3626, [0, ry, 0]); // 枕木
      if (k % 3 === 0 && !onLand(x, z)) kit.part("box", [x, TOP - 0.25, z], [0.16, 0.5, 0.16], 0x8a6a4a); // 跨水道的橋墩
    });
  }

  // 高架橋：橋面在 deckY，每隔 pillarGap 一根柱子（陸地從地面起、水道從水面起），轉角處用多伸的橋面蓋縫
  function viaduct(rawPts, { deckY, width, deckColor, pillarColor, stripeColor = null, railColor = null, pillarW = 0.14, pillarGap = 0.9, skipPillarNear = [], skipSeg = null }) {
    const pts = simplify(rawPts);
    let segs = 0, pillars = 0;
    const kept = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = [pts[i].x, pts[i].z], b = [pts[i + 1].x, pts[i + 1].z];
      const { len, ry, mx, mz } = segInfo(a, b);
      if (len < 1e-4 || (skipSeg && skipSeg(a, b))) continue;
      segs++;
      kept.push([pts[i], pts[i + 1]]);
      kit.part("box", [mx, deckY, mz], [width, 0.08, len + width * 0.6], deckColor, [0, ry, 0]); // 橋面
      if (stripeColor != null) for (const s of [-1, 1]) {
        const [ox, oz] = lateral(ry, s * (width / 2 - 0.02));
        kit.part("box", [mx + ox, deckY + 0.06, mz + oz], [0.04, 0.05, len + width * 0.6], stripeColor, [0, ry, 0]); // 兩側護欄
      }
      if (railColor != null) for (const s of [-1, 1]) {
        const [ox, oz] = lateral(ry, s * 0.09);
        kit.part("box", [mx + ox, deckY + 0.05, mz + oz], [0.03, 0.02, len + 0.05], railColor, [0, ry, 0]); // 軌道
      }
    }
    for (const [p, q] of kept) for (const [x, z, ry] of alongPath([p, q], pillarGap)) {
      if (skipPillarNear.some(([sx, sz, r]) => Math.hypot(x - sx, z - sz) < r)) continue;
      const base = onLand(x, z) ? TOP : -0.35, top = deckY - 0.04;
      kit.part("box", [x, (base + top) / 2, z], [pillarW, top - base + 0.02, pillarW], pillarColor); // 橋柱
      kit.part("box", [x, top - 0.02, z], [width * 0.72, 0.05, pillarW * 1.4], pillarColor, [0, ry, 0]); // 柱頭橫梁
      pillars++;
    }
    return { segs, pillars };
  }

  // 高鐵的上下行軌道是兩條幾乎重疊的折線，畫高架橋前先把重疊的線段剔除，避免兩片橋面閃爍
  const drawnHsr = [], S = D.city?.scale ?? 1;
  const isDupSeg = (a, b) => {
    const [mx, mz] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    for (const [p, q] of drawnHsr) {
      if (segDist(mx, mz, p[0], p[1], q[0], q[1]) < 0.12 * S && segDist(a[0], a[1], p[0], p[1], q[0], q[1]) < 0.2 * S && segDist(b[0], b[1], p[0], p[1], q[0], q[1]) < 0.2 * S) return true; // 上下行的間距是真實距離，跟著地圖倍數
    }
    drawnHsr.push([a, b]);
    return false;
  };
  const hsrStationsXZ = stations.filter((s) => s.kind === "hsr").map((s) => [s.pos.x, s.pos.z, 1.0]);
  for (const ln of lines) {
    if (ln.kind === "hsr") viaduct(ln.points, { deckY: TOP + 0.45, width: 0.5, deckColor: 0xd9d9d3, pillarColor: 0xc6c6c0, stripeColor: 0xe58a3c, railColor: 0x4a4e55, skipPillarNear: hsrStationsXZ, skipSeg: isDupSeg });
    else traTrack(ln.points);
  }

  // ── 營運路線（火車實際行駛的站序與停靠點）──
  // 沒有 points 就用站點連線；沒有 stops 就以離各站最近的點當停靠點
  const services = (rail.services?.length ? rail.services : rail.lines.filter((l) => (l.stations || []).length > 1).map((l) => ({ ...l, cars: 4, trains: 1 }))).map((sv) => {
    const raw = sv.points?.length ? sv.points : sv.stations.map((id) => { const p = stationById.get(id).pos; return [p.x, p.z]; });
    const points = raw.map(([x, z]) => V(x, z));
    let stops = sv.stops;
    if (!stops || stops.length !== sv.stations.length) {
      stops = sv.stations.map((id) => {
        const p = stationById.get(id).pos;
        let best = 0, bd = Infinity;
        points.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bd) { bd = d; best = i; } });
        return best;
      });
    }
    return { id: sv.id, name: sv.name, color: sv.color, stations: sv.stations, cars: sv.cars ?? 4, trains: sv.trains ?? 1, points, stops };
  });
  // 相鄰站：依營運路線的站序，標上同時包含兩站的路線名（找不到就用營運路線名）
  const lineNameFor = (a, b, fallback) => {
    for (const ln of lines) {
      const i = ln.stations.indexOf(a), j = ln.stations.indexOf(b);
      if (i >= 0 && j >= 0 && Math.abs(i - j) === 1) return ln.name;
    }
    return fallback;
  };
  for (const sv of services) {
    for (let i = 0; i < sv.stations.length - 1; i++) {
      const sa = stationById.get(sv.stations[i]), sb = stationById.get(sv.stations[i + 1]);
      if (!sa || !sb) continue;
      const name = lineNameFor(sa.id, sb.id, sv.name);
      if (!sa.neighbors.some((n) => n.id === sb.id)) sa.neighbors.push({ id: sb.id, line: name });
      if (!sb.neighbors.some((n) => n.id === sa.id)) sb.neighbors.push({ id: sa.id, line: name });
    }
  }

  // 車站朝向：取離車站最近的台鐵線段方向（模型的軌道在本地 x 軸：ry = atan2(-dz, dx)）
  const islandsById = new Map((D.islands || []).map((i) => [i.id, i]));
  const traLines = lines.filter((l) => l.kind !== "hsr");
  for (const s of stations) {
    let bd = Infinity;
    for (const ln of traLines.length ? traLines : lines) {
      const p = ln.points;
      for (let i = 0; i < p.length - 1; i++) {
        const d = segDist(s.pos.x, s.pos.z, p[i].x, p[i].z, p[i + 1].x, p[i + 1].z);
        if (d < bd) { bd = d; s.ry = Math.atan2(-(p[i + 1].z - p[i].z), p[i + 1].x - p[i].x); }
      }
    }
    const isl = islandsById.get(s.district);
    const hsr = s.kind === "hsr";
    buildModel(kit, hsr ? "hsrstation" : "railstation", s.pos, hsr ? 0.8 : 0.7, isl ? isl.color : 0x3e7c8c, s.ry);
    hitbox(V(s.pos.x, s.pos.z, TOP + 0.45), [hsr ? 1.8 : 1.2, 0.9, hsr ? 1.4 : 1.0], s.ry, { type: "station", id: s.id });
  }
  world.registerStations?.(stations);

  // ── 河川：平貼在地面的水色帶子，只畫在陸地上（跨水道的段略過）──
  // 把折線切成「每一段都在陸地上」的連續片段，每片做成帶狀三角網格，拐角處用平均法向量接起來
  function ribbonRuns(pts, w) {
    const runs = [];
    let cur = [];
    const okSeg = (a, b) => onLand(a[0], a[1]) && onLand(b[0], b[1]) && onLand((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    for (let i = 0; i < pts.length - 1; i++) {
      if (okSeg(pts[i], pts[i + 1])) { if (!cur.length) cur.push(pts[i]); cur.push(pts[i + 1]); }
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    return runs.filter((r) => r.length >= 2).map((r) => ribbonStrip(r, w));
  }
  const hAt = world.heightAt || (() => 0);
  function ribbonStrip(pts, w, y = TOP + 0.022, follow = true) {
    const pos = [], idx = [], n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let nx = 0, nz = 0;
      const d1 = [p[0] - a[0], p[1] - a[1]], d2 = [b[0] - p[0], b[1] - p[1]];
      for (const [dx, dz] of [d1, d2]) { const L = Math.hypot(dx, dz); if (L > 1e-6) { nx += -dz / L; nz += dx / L; } }
      const L = Math.hypot(nx, nz) || 1;
      nx /= L; nz /= L;
      // 轉角的斜接：寬度除以半角餘弦，但最多放大到 1.8 倍避免尖角爆開
      const L1 = Math.hypot(...d1), L2 = Math.hypot(...d2);
      let miter = 1;
      if (L1 > 1e-6 && L2 > 1e-6) { const cosHalf = Math.abs((-d1[1] / L1) * nx + (d1[0] / L1) * nz); miter = Math.min(1.8, 1 / Math.max(cosHalf, 0.01)); }
      const h = (w / 2) * miter;
      const yy = y + (follow ? hAt(p[0], p[1]) : 0);
      pos.push(p[0] + nx * h, yy, p[1] + nz * h, p[0] - nx * h, yy, p[1] - nz * h);
      if (i < n - 1) idx.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
    }
    return { pos, idx };
  }
  function mergeStrips(strips) {
    const pos = [], idx = [];
    for (const s of strips) { const base = pos.length / 3; pos.push(...s.pos); for (const i of s.idx) idx.push(base + i); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const nrm = new Float32Array(pos.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    return g;
  }
  const waterMat = new THREE.MeshStandardMaterial({ color: WATER, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide });
  const rivers = [];
  const riverStrips = [];
  for (const rv of water.rivers || []) {
    rivers.push({ name: rv.name, points: rv.points.map(([x, z]) => V(x, z, TOP + 0.02 + hAt(x, z))) });
    riverStrips.push(...ribbonRuns(rv.points, 0.22));
  }
  let riverMesh = null;
  if (riverStrips.length) {
    riverMesh = new THREE.Mesh(mergeStrips(riverStrips), waterMat);
    riverMesh.receiveShadow = true;
    scene.add(riverMesh);
  }

  // ── 湖泊：平面多邊形加一圈較深的岸線 ──
  const lakeMat = new THREE.MeshStandardMaterial({ color: WATER, roughness: 0.3, metalness: 0.05, transparent: true, opacity: 0.88, side: THREE.DoubleSide });
  const shoreMat = new THREE.MeshStandardMaterial({ color: SHORE, roughness: 0.8, side: THREE.DoubleSide });
  const lakes = [];
  for (const lk of water.lakes || []) {
    if (!lk.polygon || lk.polygon.length < 3) continue;
    // 大半不在島上的湖（例如跨縣市的水庫、外海潟湖）會懸在水道上方，略過
    const landFrac = lk.polygon.filter(([x, z]) => onLand(x, z)).length / lk.polygon.length;
    if (landFrac < 0.5) { console.info(`[infrastructure] 略過湖泊 ${lk.name}：只有 ${Math.round(landFrac * 100)}% 在陸地上`); continue; }
    const lakeY = TOP + 0.02 + lk.polygon.reduce((a, [x, z]) => a + hAt(x, z), 0) / lk.polygon.length; // 湖面放在地形平均高度
    lakes.push({ name: lk.name, points: lk.polygon.map(([x, z]) => V(x, z, lakeY)) });
    const shape = new THREE.Shape(lk.polygon.map(([x, z]) => new THREE.Vector2(x, -z))); // 轉 −90° 後 shape 的 y 變成世界的 z
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.translate(0, lakeY, 0);
    const m = new THREE.Mesh(g, lakeMat);
    m.receiveShadow = true;
    scene.add(m);
    const loop = [...lk.polygon, lk.polygon[0]];
    const shore = new THREE.Mesh(mergeStrips([ribbonStrip(loop, 0.07, lakeY + 0.004, false)]), shoreMat);
    scene.add(shore);
  }

  const stationsIn = (districtId) => stationsByDistrict.get(districtId) || [];
  return { stations, stationById, stationsIn, lines, services, rivers, lakes, riverMesh };
}
