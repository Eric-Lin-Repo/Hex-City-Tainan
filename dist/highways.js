// 高速公路與快速道路：國道 1、3、8 號，台 61、84、86 線，臺南都會區北外環道路（data/highways.json，來源 OpenStreetMap）。
// 資料是有向的路段鏈（chain）：每條是單向車道（雙向各一條），匝道靠共用的端點接上主線。
//   路面：依地形高度畫，OSM 標示的橋段架高（層數越高越高），橋與地面之間用平順的坡道接起來；主線有白色邊線與車道虛線，橋上有護欄與橋柱。
//   車：小客車、貨車、聯結車、客運沿鏈開，到端點挑下一條（大多留在主線，偶爾下匝道）；開出地圖或匝道盡頭就從入口重新進來。
//       數量依時段（尖峰多、半夜少）與畫質；入夜亮車頭燈與尾燈。
//   交流道：綠色路牌，拉近才顯示名稱。
//   即時車速（traffic.js）：addSections 把高公局／TDX 的分向路段對上路段鏈，setSpeeds 依真實車速把路面染成綠黃橘紅、那一段的車跟著變慢。
// createHighways(THREE, scene, data, { heightAt, CSS2DObject, scale, unitsPerKm, quality, lang, rnd })
//   → { update(dt, speedMul, timeScale, minute), setNight, addSections(list), setSpeeds(map|null), setVisible, setQuality, pick(hit), pickables, routeInfo(id), routeList(), carInfo(i), carPos(i), junctionPos(i), segments(), state() }
import { TOP } from "./world.js";
import { matchSections, speedColor } from "./traffic.js";

const GROUND = 0.035, BRIDGE = 0.22, LAYER_STEP = 0.16, SLOPE = 0.1; // 路面離地高度、一層橋的高度、每多一層再加多少、坡道每單位升多少
const WIDTH = { main: 0.26, link: 0.15 }; // 單向車道的路面寬（雙向兩條並排就是整條公路）
const PILLAR_GAP = 0.9;
const MAX_CARS = { high: 300, med: 200, low: 100 };
const SPEED = 3.15 * 1.5; // 1 倍地圖的車速（單位／秒），公車的 1.5 倍；實際再乘地圖倍數
const CAR_K = 1.3; // 車整體放大（行人畫得比真實大，車要跟市區公車差不多比例）
const KINDS = [ // 車種：權重、零件 [寬, 高, 長, 中心 y, 中心 z, 顏色（null = 車身色）]，最後乘 CAR_K
  { id: "car", w: 0.62, parts: [[0.13, 0.06, 0.28, 0.045, 0, null], [0.11, 0.05, 0.14, 0.095, -0.01, 0x2b3440]] },
  { id: "truck", w: 0.18, parts: [[0.15, 0.11, 0.12, 0.075, 0.16, null], [0.16, 0.14, 0.3, 0.09, -0.07, 0xeeeeea]] },
  { id: "semi", w: 0.12, parts: [[0.15, 0.12, 0.13, 0.08, 0.31, null], [0.16, 0.15, 0.52, 0.095, -0.05, 0xd8d8d2]] },
  { id: "coach", w: 0.08, parts: [[0.16, 0.15, 0.56, 0.095, 0, null], [0.165, 0.05, 0.48, 0.12, 0.01, 0x24303c]] },
].map((k) => ({ ...k, parts: k.parts.map(([w, h, l, y, z, c]) => [w * CAR_K, h * CAR_K, l * CAR_K, y * CAR_K, z * CAR_K, c]) }));
const PAINT = [0xf4f4f0, 0x2b2f36, 0xb7bcc4, 0x9a2b2b, 0x2f5d8a, 0x6d6f73, 0xe8e2d0, 0x3f6f4f, 0xc9a227]; // 車身色
const TRAFFIC = [0.25, 0.2, 0.2, 0.2, 0.3, 0.45, 0.7, 1, 1, 0.85, 0.75, 0.75, 0.75, 0.75, 0.75, 0.8, 0.9, 1, 1, 0.8, 0.6, 0.5, 0.4, 0.3]; // 各小時的車流比例（尖峰 7–8、17–18 點最多）

export function createHighways(THREE, scene, data, { heightAt = () => 0, CSS2DObject = null, scale: S = 1, unitsPerKm = 1, quality = "high", lang = "zh", rnd = Math.random } = {}) {
  const groundY = (x, z) => TOP + heightAt(x, z);
  const root = new THREE.Group(); scene.add(root);
  const routes = new Map((data?.routes || []).map((r) => [r.id, r]));
  const nameOf = (r) => (lang === "en" ? r.en : lang === "ja" ? r.ja : r.name);

  // ── 路段鏈：座標、累積長度、每點的路面高度 ──
  const chains = (data?.chains || []).map((c, i) => {
    const pts = c.pts.map(([x, z, layer]) => ({ x, z, layer }));
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
    const target = pts.map((p, k) => { const l = Math.max(p.layer, k > 0 ? pts[k - 1].layer : 0); return l ? BRIDGE + (l - 1) * LAYER_STEP : GROUND; }); // 橋段兩端的點都算橋
    return { i, route: c.route, link: !!c.link, pts, cum, len: cum.at(-1), next: c.next, prev: [], target, off: target.slice() };
  });
  for (const c of chains) for (const j of c.next) chains[j]?.prev.push(c.i);
  // 坡道：每點的高度取「附近每個點的目標高度減去距離 × SLOPE」的最大值，橋就會往兩邊平順地降到地面；鏈與鏈接頭處互相帶過去，來回算三次
  const reach = (BRIDGE + 3 * LAYER_STEP) / SLOPE;
  for (const c of chains) {
    for (let a = 0; a < c.pts.length; a++) {
      let best = c.target[a];
      for (let b = a - 1; b >= 0 && c.cum[a] - c.cum[b] < reach; b--) best = Math.max(best, c.target[b] - SLOPE * (c.cum[a] - c.cum[b]));
      for (let b = a + 1; b < c.pts.length && c.cum[b] - c.cum[a] < reach; b++) best = Math.max(best, c.target[b] - SLOPE * (c.cum[b] - c.cum[a]));
      c.off[a] = best;
    }
  }
  for (let pass = 0; pass < 3; pass++) for (const c of chains) {
    const start = Math.max(c.off[0], ...c.prev.map((j) => chains[j].off.at(-1))), end = Math.max(c.off.at(-1), ...c.next.map((j) => chains[j].off[0]));
    for (let a = 0; a < c.pts.length; a++) c.off[a] = Math.max(c.off[a], start - SLOPE * c.cum[a], end - SLOPE * (c.len - c.cum[a]));
  }
  for (const c of chains) c.y = c.pts.map((p, a) => groundY(p.x, p.z) + c.off[a]);

  // ── 路面、標線、護欄、橋柱：各一個 InstancedMesh ──
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e3 = new THREE.Euler(0, 0, 0, "YXZ"), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  const lists = { deck: [], line: [], dash: [], rail: [], pillar: [] }, deckChain = [], deckSeg = [];
  const put = (list, x, y, z, w, h, l, yaw, pitch = 0) => list.push([x, y, z, w, h, l, yaw, pitch]);
  for (const c of chains) {
    const W = c.link ? WIDTH.link : WIDTH.main;
    let dashCarry = 0.1, pillarCarry = PILLAR_GAP / 2;
    for (let k = 0; k < c.pts.length - 1; k++) {
      const a = c.pts[k], b = c.pts[k + 1], ya = c.y[k], yb = c.y[k + 1];
      const dx = b.x - a.x, dz = b.z - a.z, dy = yb - ya, h = Math.hypot(dx, dz);
      if (h < 1e-4) continue;
      const yaw = Math.atan2(dx, dz), pitch = -Math.atan2(dy, h), L = Math.hypot(h, dy), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, my = (ya + yb) / 2;
      const nx = Math.cos(yaw), nz = -Math.sin(yaw); // 路面的橫向（往右）
      put(lists.deck, mx, my, mz, W, 0.035, L + 0.05, yaw, pitch); deckChain.push(c.i); deckSeg.push(k);
      const bridge = a.layer > 0;
      if (!c.link) for (const sd of [-1, 1]) put(lists.line, mx + nx * sd * (W / 2 - 0.018), my + 0.019, mz + nz * sd * (W / 2 - 0.018), 0.01, 0.004, L + 0.04, yaw, pitch); // 白色邊線
      if (bridge) for (const sd of [-1, 1]) put(lists.rail, mx + nx * sd * (W / 2 - 0.005), my + 0.035, mz + nz * sd * (W / 2 - 0.005), 0.012, 0.04, L + 0.04, yaw, pitch); // 橋上護欄
      if (!c.link) { // 車道虛線
        for (let t = dashCarry; t < h; t += 0.32) { const f = t / h; put(lists.dash, a.x + dx * f, ya + dy * f + 0.019, a.z + dz * f, 0.01, 0.004, 0.12, yaw, pitch); }
        dashCarry = ((dashCarry - h) % 0.32 + 0.32) % 0.32;
      }
      if (bridge) { // 橋柱：從地面立到橋面底下
        for (let t = pillarCarry; t < h; t += PILLAR_GAP) {
          const f = t / h, x = a.x + dx * f, z = a.z + dz * f, top = ya + dy * f - 0.02, base = Math.min(groundY(x, z), top) - 0.3;
          if (top - groundY(x, z) > 0.05) put(lists.pillar, x, (top + base) / 2, z, 0.06, top - base, 0.06, yaw);
        }
        pillarCarry = ((pillarCarry - h) % PILLAR_GAP + PILLAR_GAP) % PILLAR_GAP;
      }
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  function instanced(list, mat, { shadow = false, receive = true } = {}) {
    const im = new THREE.InstancedMesh(box, mat, Math.max(1, list.length));
    list.forEach(([x, y, z, w, h, l, yaw, pitch], i) => im.setMatrixAt(i, m4.compose(v3.set(x, y, z), q4.setFromEuler(e3.set(pitch, yaw, 0)), s3.set(w, h, l))));
    im.count = list.length; im.castShadow = shadow; im.receiveShadow = receive;
    root.add(im);
    return im;
  }
  const DECK = 0x5f646b; // 路面灰；即時車速時混進路況顏色（instance 顏色乘材質白色）
  const deck = instanced(lists.deck, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), { shadow: true });
  deck.userData = { type: "highway" };
  { const g = new THREE.Color(DECK); for (let i = 0; i < lists.deck.length; i++) deck.setColorAt(i, g); }
  instanced(lists.line, new THREE.MeshBasicMaterial({ color: 0xf2f2ee }));
  instanced(lists.dash, new THREE.MeshBasicMaterial({ color: 0xf2f2ee }));
  instanced(lists.rail, new THREE.MeshStandardMaterial({ color: 0xc9c9c2, roughness: 0.7 }));
  instanced(lists.pillar, new THREE.MeshStandardMaterial({ color: 0xbdb8ad, roughness: 0.85 }), { shadow: true });

  // ── 交流道路牌：綠底白框的牌子＋兩根柱子，拉近才顯示名稱 ──
  const junctions = (data?.junctions || []).map((j, i) => {
    let best = null; // 找最近的主線點，牌子立在路的右側外面
    for (const c of chains) if (!c.link && c.route === j.route) for (let k = 0; k < c.pts.length - 1; k++) { const d = Math.hypot(c.pts[k].x - j.pos[0], c.pts[k].z - j.pos[1]); if (!best || d < best.d) best = { d, c, k }; }
    let x = j.pos[0], z = j.pos[1], yaw = 0;
    if (best) { const a = best.c.pts[best.k], b = best.c.pts[best.k + 1]; yaw = Math.atan2(b.x - a.x, b.z - a.z); x = a.x + Math.cos(yaw) * 0.32; z = a.z - Math.sin(yaw) * 0.32; }
    return { ...j, i, x, z, yaw, y: groundY(x, z) };
  });
  const signs = [], posts = [];
  for (const j of junctions) {
    put(signs, j.x, j.y + 0.34, j.z, 0.32, 0.12, 0.015, j.yaw);
    for (const sd of [-1, 1]) put(posts, j.x + Math.cos(j.yaw) * sd * 0.13, j.y + 0.15, j.z - Math.sin(j.yaw) * sd * 0.13, 0.015, 0.3, 0.015, j.yaw); // 牌子兩端各一根柱子
  }
  instanced(signs, new THREE.MeshStandardMaterial({ color: 0x1f6b3a, roughness: 0.6 }));
  instanced(posts, new THREE.MeshStandardMaterial({ color: 0x8a939e, roughness: 0.6 }));
  if (CSS2DObject) for (const j of junctions) {
    const el = document.createElement("div");
    el.className = "hw-label"; el.textContent = lang === "en" ? j.en : lang === "ja" ? j.ja : j.name;
    const o = new CSS2DObject(el); o.position.set(j.x, j.y + 0.5, j.z); root.add(o);
  }

  // ── 車：每種車的每個零件一個 InstancedMesh ──
  let maxActive = MAX_CARS[quality] ?? 200;
  const N = MAX_CARS.high;
  const meshes = KINDS.map((k) => k.parts.map(([w, h, l, , , col]) => {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(w, h, l), new THREE.MeshStandardMaterial({ color: col ?? 0xffffff, roughness: 0.55 }), N);
    im.castShadow = true; im.frustumCulled = false; im.count = 0; root.add(im);
    return im;
  }));
  meshes.forEach((parts) => (parts[0].userData = { type: "car" }));
  const lightMat = { head: new THREE.MeshBasicMaterial({ color: 0xfff4c8 }), tail: new THREE.MeshBasicMaterial({ color: 0xff3b30 }) };
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.025, 0.01), lightMat.head, N), tails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.025, 0.01), lightMat.tail, N);
  for (const m of [heads, tails]) { m.frustumCulled = false; m.count = 0; m.visible = false; root.add(m); }
  const col = new THREE.Color();
  // 入口：沒有其他鏈接進來的鏈（地圖邊界的主線、從平面道路上來的匝道），主線入口權重較高
  const entries = chains.filter((c) => !c.prev.length);
  const entryW = entries.map((c) => (c.link ? 1 : 3)), entryTotal = entryW.reduce((a, b) => a + b, 0);
  const pickEntry = () => { let r = rnd() * entryTotal; for (let i = 0; i < entries.length; i++) { r -= entryW[i]; if (r <= 0) return entries[i]; } return entries[0]; };
  const mainLen = chains.reduce((a, c) => a + (c.link ? c.len * 0.3 : c.len), 0);
  const pickAnywhere = () => { let r = rnd() * mainLen; for (const c of chains) { r -= c.link ? c.len * 0.3 : c.len; if (r <= 0) return c; } return chains[0]; };
  const kindPick = () => { let r = rnd(); for (const k of KINDS) { r -= k.w; if (r <= 0) return k; } return KINDS[0]; };
  const byKind = new Map(KINDS.map((k) => [k.id, 0]));
  const cars = Array.from({ length: N }, (_, i) => {
    const kind = kindPick(), slot = byKind.get(kind.id); byKind.set(kind.id, slot + 1);
    const c = { i, kind, slot, chain: null, s: 0, seg: 0, lane: rnd() < 0.5 ? -0.055 : 0.055, v: 0.9 + rnd() * 0.25, active: false, x: 0, y: 0, z: 0, yaw: 0 };
    if (kind.id === "truck" || kind.id === "semi" || kind.id === "coach") c.lane = 0.055; // 大車走外側車道，也慢一點
    if (kind.id !== "car") c.v = 0.82 + rnd() * 0.1;
    meshes[KINDS.indexOf(kind)][0].setColorAt(slot, col.set(kind.id === "coach" ? [0xf2f2ee, 0x2f5d8a, 0xc9a227][slot % 3] : PAINT[Math.floor(rnd() * PAINT.length)]));
    return c;
  });
  meshes.forEach((parts) => { if (parts[0].instanceColor) parts[0].instanceColor.needsUpdate = true; });
  function enter(car, anywhere) { // anywhere：一開始散在整個路網上；之後從入口進來
    car.chain = anywhere ? pickAnywhere() : pickEntry();
    car.s = anywhere ? rnd() * car.chain.len : 0; car.seg = 0;
  }
  function advance(car, d) {
    car.s += d;
    while (car.s > car.chain.len) {
      const left = car.s - car.chain.len, nx = car.chain.next.map((j) => chains[j]);
      if (!nx.length) { enter(car, false); return; } // 開出地圖或匝道盡頭：從入口重新進來
      const mains = nx.filter((c) => !c.link), ramps = nx.filter((c) => c.link);
      const pool = car.chain.link ? nx : mains.length && (rnd() < 0.9 || !ramps.length) ? mains : ramps; // 主線上大多直走，一成下匝道
      car.chain = pool[Math.floor(rnd() * pool.length)]; car.s = left; car.seg = 0;
    }
  }
  const zero = new THREE.Vector3(0, 0, 0), one = new THREE.Vector3(1, 1, 1);
  function place(car) {
    const c = car.chain;
    while (car.seg < c.pts.length - 2 && c.cum[car.seg + 1] < car.s) car.seg++;
    while (car.seg > 0 && c.cum[car.seg] > car.s) car.seg--;
    const k = car.seg, a = c.pts[k], b = c.pts[k + 1] ?? a, seglen = (c.cum[k + 1] ?? c.cum[k]) - c.cum[k] || 1, f = Math.min(1, Math.max(0, (car.s - c.cum[k]) / seglen));
    const dx = b.x - a.x, dz = b.z - a.z, yaw = Math.atan2(dx, dz), dy = (c.y[k + 1] ?? c.y[k]) - c.y[k], pitch = -Math.atan2(dy, Math.hypot(dx, dz) || 1);
    const lane = c.link ? 0 : car.lane, nx = Math.cos(yaw), nz = -Math.sin(yaw);
    car.x = a.x + dx * f + nx * lane; car.z = a.z + dz * f + nz * lane; car.y = c.y[k] + dy * f + 0.018; car.yaw = yaw;
    q4.setFromEuler(e3.set(pitch, yaw, 0));
    const ki = KINDS.indexOf(car.kind);
    car.kind.parts.forEach(([, , , py, pz], p) => {
      v3.set(0, py, pz).applyQuaternion(q4).add(s3.set(car.x, car.y, car.z));
      meshes[ki][p].setMatrixAt(car.slot, m4.compose(v3, q4, one));
    });
    const half = car.kind.parts.reduce((m, [, , l, , pz]) => Math.max(m, pz + l / 2), 0), back = car.kind.parts.reduce((m, [, , l, , pz]) => Math.min(m, pz - l / 2), 0);
    heads.setMatrixAt(car.i, m4.compose(v3.set(0, 0.065, half + 0.004).applyQuaternion(q4).add(s3.set(car.x, car.y, car.z)), q4, one));
    tails.setMatrixAt(car.i, m4.compose(v3.set(0, 0.075, back - 0.004).applyQuaternion(q4).add(s3.set(car.x, car.y, car.z)), q4, one));
  }
  function hide(car) {
    const ki = KINDS.indexOf(car.kind);
    car.kind.parts.forEach((_, p) => meshes[ki][p].setMatrixAt(car.slot, m4.compose(v3.set(0, -50, 0), q4.identity(), zero)));
    heads.setMatrixAt(car.i, m4.makeScale(0, 0, 0)); tails.setMatrixAt(car.i, m4.makeScale(0, 0, 0));
  }
  for (const car of cars) { enter(car, true); hide(car); }
  meshes.forEach((parts, ki) => parts.forEach((m) => (m.count = byKind.get(KINDS[ki].id))));
  heads.count = tails.count = N;

  // ── 即時車速：sec 是全部路段（國道＋快速道路），chain.sec[k] 是第 k 小段對到的路段索引 ──
  const sec = [];
  let speeds = null; // Map 路段 id → [km/h, 壅塞等級]；null = 模擬
  function addSections(list) {
    const fresh = list.filter((s) => !sec.some((x) => x.id === s.id));
    if (!fresh.length) return;
    const base = sec.length;
    sec.push(...fresh);
    const m = matchSections(chains, fresh);
    chains.forEach((c, i) => {
      if (!m[i]) return;
      c.sec ||= new Int16Array(m[i].length).fill(-1);
      m[i].forEach((si, k) => { if (si >= 0 && c.sec[k] < 0) c.sec[k] = base + si; });
    });
    if (speeds) paint();
  }
  const liveSpeed = (c, k) => { const si = c.sec?.[k] ?? -1; return si >= 0 ? speeds?.get(sec[si].id)?.[0] : undefined; };
  const gray = new THREE.Color(DECK), tint = new THREE.Color();
  function paint() {
    for (let i = 0; i < deckChain.length; i++) {
      const v = speeds && liveSpeed(chains[deckChain[i]], deckSeg[i]);
      deck.setColorAt(i, v ? tint.set(speedColor(v)).lerp(gray, 0.35) : gray);
    }
    deck.instanceColor.needsUpdate = true;
  }
  function setSpeeds(map) { speeds = map && map.size ? map : null; paint(); }

  let wantActive = 0;
  function update(dt, speedMul = 1, timeScale = 1, minute = 720) {
    if (!root.visible || !chains.length) return;
    const hr = Math.floor(((minute % 1440) + 1440) % 1440 / 60), fr = (minute % 60) / 60;
    const traffic = TRAFFIC[hr] + (TRAFFIC[(hr + 1) % 24] - TRAFFIC[hr]) * fr;
    wantActive = Math.round(maxActive * traffic);
    const d = SPEED * S * Math.min(1.5, speedMul) * timeScale * dt;
    for (const car of cars) {
      const on = car.i < wantActive;
      if (on !== car.active) { car.active = on; if (on) enter(car, false); else hide(car); }
      if (!on) continue;
      const live = speeds && liveSpeed(car.chain, car.seg); // 即時車速：90 km/h 算原速，塞車的路段慢下來
      advance(car, d * car.v * (car.chain.link ? 0.6 : 1) * (live ? Math.min(1.2, Math.max(0.12, live / 90)) : 1));
      place(car);
    }
    for (const parts of meshes) for (const m of parts) m.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = tails.instanceMatrix.needsUpdate = true;
  }
  function setNight(f) { heads.visible = tails.visible = f > 0.4; }
  function setVisible(on) { root.visible = on; }
  function setQuality(q) { maxActive = MAX_CARS[q] ?? maxActive; }

  // ── 查詢（卡片、側欄、跟車用）──
  function pick(hit) {
    if (hit.object === deck) { const c = chains[deckChain[hit.instanceId]]; return c ? { type: "highway", id: c.route } : null; }
    const ki = meshes.findIndex((parts) => parts[0] === hit.object);
    if (ki >= 0) { const car = cars.find((c) => c.kind === KINDS[ki] && c.slot === hit.instanceId); return car?.active ? { type: "car", id: car.i } : null; }
    return null;
  }
  const routeList = () => [...routes.values()].map((r) => ({ ...r, label: nameOf(r) }));
  function routeInfo(id) {
    const r = routes.get(id);
    if (!r) return null;
    const mains = chains.filter((c) => c.route === id && !c.link);
    const km = mains.reduce((a, c) => a + c.len, 0) / 2 / unitsPerKm; // 雙向各一條，取一半
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const c of mains) for (const p of c.pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const ns = z1 - z0 >= x1 - x0; // 南北向的路依 z 排交流道，東西向依 x
    const js = junctions.filter((j) => j.route === id).sort((a, b) => (ns ? a.z - b.z : a.x - b.x));
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    return { ...r, label: nameOf(r), km, ns, junctions: js.map((j) => ({ i: j.i, name: lang === "en" ? j.en : lang === "ja" ? j.ja : j.name, km: j.km, district: j.district })),
      cars: cars.filter((c) => c.active && c.chain.route === id).length, center: new THREE.Vector3(cx, groundY(cx, cz), cz), radius: Math.max(x1 - x0, z1 - z0) / 2,
      samples: mains.flatMap((c) => c.pts.filter((_, k) => k % 6 === 0)), live: liveOf(id) };
  }
  // 這條路各路段的即時車速（依路段順序；沒有即時資料回 null）
  function liveOf(id) {
    if (!speeds) return null;
    const list = sec.filter((s) => s.route === id && speeds.has(s.id)).map((s) => ({ id: s.id, name: s.name, dir: s.dir, speed: speeds.get(s.id)[0], level: speeds.get(s.id)[1] }));
    return list.length ? list : null;
  }
  function carInfo(i) {
    const car = cars[+i];
    if (!car?.active) return null;
    const r = routes.get(car.chain.route), deg = ((car.yaw * 180) / Math.PI + 360) % 360; // yaw 0 = 往 +z（南）
    const heading = deg >= 315 || deg < 45 ? "south" : deg < 135 ? "east" : deg < 225 ? "north" : "west";
    return { i: car.i, kind: car.kind.id, route: car.chain.route, routeLabel: r ? nameOf(r) : "", link: car.chain.link, heading, pos: new THREE.Vector3(car.x, car.y, car.z) };
  }
  const carPos = (i) => { const car = cars[+i]; return car?.active ? new THREE.Vector3(car.x, car.y + 0.1, car.z) : null; };
  const junctionPos = (i) => { const j = junctions[+i]; return j ? new THREE.Vector3(j.x, j.y, j.z) : null; };
  const segments = () => chains.map((c) => c.pts.map((p) => [p.x, p.z])); // 給景觀、行人避開用
  const state = () => ({ chains: chains.length, cars: cars.filter((c) => c.active).length, wantActive, maxActive, entries: entries.length });
  return { update, setNight, setVisible, setQuality, addSections, setSpeeds, pick, routeList, routeInfo, carInfo, carPos, junctionPos, segments, state,
    get pickables() { return root.visible ? [deck, ...meshes.map((p) => p[0])] : []; } };
}
