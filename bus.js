// 公車：台南六色幹線與支線（data/bus.json 幹線、data/bus_branches.json 支線，來源 OpenStreetMap）。
// 每條路線有多個行駛型態（正線往返程、繞駛、延駛……）；正線畫成路線色虛線，往返程各靠行進方向右側；選取路線時另外畫出繞駛／延駛。
// 公車兩種模式：
//   即時：時鐘在「現在」時，每 30 秒向 /api/bus（Worker 代理 TDX）取台南公車 GPS，貼到所屬路線與方向上，兩次更新之間平滑移動；
//   模擬：沒有即時資料（時鐘不是現在、沒設 TDX 金鑰、額度用完、本機開發）時，依路線長度配車沿正線往返，06:00–22:30 營運。
// 站牌：相機拉近才顯示；點站牌看有哪些路線經過。路線、公車、站牌都用 InstancedMesh，支線全開也只多幾個 draw call。
import { TOP } from "./world.js";

const SPEED = 3.15;                         // 模擬行駛速度（1 倍地圖的單位／秒，實際再乘地圖倍數 scale）
const STOP_WAIT = 1.2;                      // 模擬停站秒數
const OPEN = 6 * 60, CLOSE = 22 * 60 + 30;  // 模擬營運時間
const POLL_MS = 30000;                      // 即時資料輪詢間隔（Worker 端另有 BUS_TTL 快取）
const LIVE_EASE = 28;                       // 即時：兩次更新之間花幾秒移到新位置
const SNAP = 0.6;                           // 即時：GPS 離路線這麼近才貼到路線上（0.6–2 之間照 GPS 放，再遠就不畫）；1 倍地圖的單位，實際乘 scale
const SIDE = 0.045;                         // 往返程各往右偏移，兩條線並排
const STOP_SHOW = 16;                       // 相機離焦點小於這個距離才畫站牌
const MAX_BUSES = 1200;
const DASH = { trunk: { w: 0.09, h: 0.024, len: 0.26, gap: 0.12 }, branch: { w: 0.055, h: 0.02, len: 0.2, gap: 0.16 }, variant: { w: 0.045, h: 0.02, len: 0.1, gap: 0.12 } };

export function createBuses(THREE, scene, trunkData, { heightAt = () => 0, projection = null, loadBranches = null, onChange = () => {}, scale: S = 1 } = {}) {
  const groundY = (x, z) => TOP + heightAt(x, z);
  const colors = trunkData?.colors ?? {};
  const routes = new Map(), stops = [];
  const colorOn = Object.fromEntries(Object.keys(colors).map((c) => [c, false])); // 支線顏色開關（幹線一直顯示）
  let branchesLoaded = false, branchesLoading = null;

  // ── 資料：路線、型態、站牌 ──
  function offsetLine(pts) { // 往行進方向右側平移 SIDE（北是 −z，右手邊是 (−hz, hx)）
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const hx = b[0] - a[0], hz = b[1] - a[1], L = Math.hypot(hx, hz) || 1;
      return { x: p[0] + (-hz / L) * SIDE, z: p[1] + (hx / L) * SIDE };
    });
  }
  function addFile(data) {
    const base = stops.length;
    for (const s of data.stops) stops.push({ ...s, routes: new Set() });
    for (const r of data.routes) {
      const route = { ...r, visible: r.trunk, mesh: null, variantMesh: null, liveCount: 0 };
      route.patterns = r.patterns.map((p) => {
        const pts = offsetLine(p.points), cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
        const scale = cum.at(-1) / (p.length || cum.at(-1) || 1); // 偏移後長度略變，站牌的沿線距離等比例換算
        const st = p.stops.map(([i, d]) => ({ id: base + i, d: d * scale }));
        for (const s of st) stops[s.id].routes.add(r.id);
        return { ...p, route, pts, cum, total: cum.at(-1), stops: st };
      });
      route.mains = route.patterns.filter((p) => p.kind === "main" || p.kind === "loop");
      if (!route.mains.length) route.mains = route.patterns.slice(0, 2);
      routes.set(r.id, route);
    }
  }
  addFile(trunkData);

  // ── 路線虛線：每條路線一個 InstancedMesh（正線往返程），選取時再畫繞駛／延駛 ──
  const dashGeo = {};
  for (const [k, d] of Object.entries(DASH)) dashGeo[k] = new THREE.BoxGeometry(d.w, d.h, d.len);
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  function dashMesh(patterns, kind, hex) {
    const d = DASH[kind], items = [];
    for (const p of patterns) {
      let carry = d.len / 2;
      for (let i = 0; i < p.pts.length - 1; i++) {
        const a = p.pts[i], b = p.pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
        if (len < 1e-6) continue;
        const ry = Math.atan2(dx, dz);
        for (let t = carry; t < len; t += d.len + d.gap) items.push([a.x + (dx * t) / len, a.z + (dz * t) / len, ry]);
        carry = ((carry - len) % (d.len + d.gap) + d.len + d.gap) % (d.len + d.gap);
      }
    }
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), transparent: true, opacity: 1 });
    const im = new THREE.InstancedMesh(dashGeo[kind], mat, Math.max(1, items.length));
    items.forEach(([x, z, ry], k) => im.setMatrixAt(k, m4.compose(v3.set(x, groundY(x, z) + (kind === "variant" ? 0.016 : 0.012), z), q4.setFromAxisAngle(up, ry), one)));
    im.count = items.length;
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false; // 整條線的包圍盒算不準，不裁切比較省事
    scene.add(im);
    return im;
  }
  function syncRouteMeshes() {
    for (const r of routes.values()) {
      if (r.visible && !r.mesh) r.mesh = dashMesh(r.mains, r.trunk ? "trunk" : "branch", r.hex);
      if (r.mesh) r.mesh.visible = r.visible;
    }
  }

  // ── 站牌：灰色站桿＋白底藍框站牌，拉近才顯示 ──
  let stopPost = null, stopSign = null, stopsWanted = false;
  function buildStops() {
    for (const m of [stopPost, stopSign]) if (m) { scene.remove(m); m.dispose(); }
    stopPost = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 5), new THREE.MeshStandardMaterial({ color: 0x8a939e, roughness: 0.6 }), stops.length);
    stopSign = new THREE.InstancedMesh(new THREE.BoxGeometry(0.075, 0.09, 0.012), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), stops.length);
    stopSign.userData = { type: "busstop" };
    for (const m of [stopPost, stopSign]) { m.frustumCulled = false; m.visible = false; scene.add(m); }
    layoutStops();
  }
  function layoutStops() { // 只畫目前看得到的路線經過的站牌，其他縮成 0
    const zero = new THREE.Vector3(0, 0, 0), signColor = new THREE.Color();
    stops.forEach((s, i) => {
      const on = [...s.routes].some((id) => routes.get(id)?.visible);
      const y = groundY(s.x, s.z);
      stopPost.setMatrixAt(i, m4.compose(v3.set(s.x, y + 0.1, s.z), q4.identity(), on ? one : zero));
      stopSign.setMatrixAt(i, m4.compose(v3.set(s.x, y + 0.2, s.z), q4.identity(), on ? one : zero));
      const first = routes.get([...s.routes][0]);
      stopSign.setColorAt(i, signColor.set(first?.hex ?? "#ffffff").lerp(new THREE.Color(0xffffff), 0.55)); // 站牌淡淡帶第一條路線的顏色
    });
    stopPost.instanceMatrix.needsUpdate = stopSign.instanceMatrix.needsUpdate = true;
    if (stopSign.instanceColor) stopSign.instanceColor.needsUpdate = true;
  }
  buildStops();

  // ── 公車本體：車身（路線色）、白色窗帶、深色底盤，三個 InstancedMesh ──
  const busBody = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.2, 0.5), new THREE.MeshStandardMaterial({ roughness: 0.6 }), MAX_BUSES);
  const busWin = new THREE.InstancedMesh(new THREE.BoxGeometry(0.232, 0.07, 0.42), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_BUSES);
  const busBase = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.06, 0.38), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.8 }), MAX_BUSES);
  busBody.userData = { type: "bus" };
  for (const m of [busBody, busWin, busBase]) { m.count = 0; m.frustumCulled = false; m.castShadow = m !== busWin; scene.add(m); }
  busBody.setColorAt(0, new THREE.Color(0xffffff)); // 先建立 instanceColor

  let buses = []; // { key, route, pat, s, wait, live, x, z, ry, visible, target? }
  let night = 0, clockMinute = null, liveWanted = false, liveData = null, status = { mode: "sim", reason: "clock" }, pollTimer = 0, lastPoll = 0;
  const closed = () => (clockMinute != null ? clockMinute < OPEN || clockMinute >= CLOSE : night > 0.85);

  // 模擬車：每條看得到的路線依長度配車，從正線往程出發，到終點換返程
  function spawnSim() {
    const out = [];
    for (const r of routes.values()) {
      if (!r.visible) continue;
      for (const p of r.mains) {
        const n = r.trunk ? Math.max(2, Math.round(p.total / (9 * S))) : p.total > 18 * S ? 2 : 1; // 車距（時間）跟 1 倍地圖一樣
        for (let k = 0; k < n; k++) out.push({ key: `sim:${r.id}:${p.rel}:${k}`, route: r, pat: p, s: (p.total * (k + 0.35)) / n, wait: 0, live: null, visible: true });
      }
    }
    for (const b of out) b.next = nextStopIndex(b.pat, b.s);
    return out;
  }
  const nextStopIndex = (p, s) => { const i = p.stops.findIndex((st) => st.d > s + 1e-3); return i < 0 ? p.stops.length : i; };
  function otherDirection(b) {
    const r = b.route, want = b.pat.dir === 0 ? 1 : 0;
    return r.mains.find((p) => p.dir === want && p.kind === b.pat.kind) ?? r.mains.find((p) => p.dir === want) ?? b.pat;
  }

  // 沿線位置
  function pointAt(p, s) {
    const sc = Math.max(0, Math.min(p.total, s));
    let lo = 0, hi = p.cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p.cum[mid] <= sc) lo = mid; else hi = mid; }
    const a = p.pts[lo], c = p.pts[Math.min(lo + 1, p.pts.length - 1)], seg = p.cum[lo + 1] - p.cum[lo] || 1, t = (sc - p.cum[lo]) / seg;
    return { x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t, ry: Math.atan2(c.x - a.x, c.z - a.z) };
  }
  // GPS 投到型態上：回 { d: 距離, s: 沿線位置 }
  function nearestOn(p, x, z) {
    let best = { d: Infinity, s: 0 };
    for (let i = 0; i < p.pts.length - 1; i++) {
      const a = p.pts[i], c = p.pts[i + 1], dx = c.x - a.x, dz = c.z - a.z, L2 = dx * dx + dz * dz;
      const t = L2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
      const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
      if (d < best.d) best = { d, s: p.cum[i] + t * (p.cum[i + 1] - p.cum[i]) };
    }
    return best;
  }
  const toWorld = (lon, lat) => (projection ? { x: (lon - projection.lon_c) * projection.km_x * projection.k, z: -(lat - projection.lat_c) * projection.km_z * projection.k } : null);

  // ── 即時資料 ──
  function applyLive(list) {
    const old = new Map(buses.filter((b) => b.live).map((b) => [b.key, b]));
    for (const r of routes.values()) r.liveCount = 0;
    const out = [];
    for (const v of list) {
      const r = routes.get(v.route);
      if (!r) continue; // 地圖上沒有這條路線（例如整條在嘉義、高雄的路段）
      r.liveCount++;
      if (!r.visible) continue; // 支線顏色沒打開：只計數不畫
      const w = toWorld(v.lon, v.lat);
      if (!w) continue;
      const cands = r.patterns.filter((p) => p.dir === v.dir);
      let best = null;
      for (const p of cands.length ? cands : r.patterns) { const n = nearestOn(p, w.x, w.z); if (!best || n.d < best.d) best = { ...n, pat: p }; }
      if (best && best.d > SNAP * S) for (const p of r.patterns) { const n = nearestOn(p, w.x, w.z); if (n.d < best.d) best = { ...n, pat: p }; } // 方向資料不準時試另一向
      if (!best || best.d > 2 * S) continue; // 離路線太遠（出了台南、在場站或資料錯）：只計數不畫
      const key = `live:${v.plate}`, prev = old.get(key);
      const b = prev ?? { key, route: r, wait: 0, visible: true };
      b.live = v; b.route = r;
      if (best && best.d <= SNAP * S) {
        const same = prev && prev.pat === best.pat && !prev.free && best.s >= prev.s - 0.3 * S && best.s - prev.s < 6 * S;
        if (same) { b.target = best.s; b.rate = Math.max(0, best.s - prev.s) / LIVE_EASE; }
        else { b.pat = best.pat; b.s = best.s; b.target = best.s; b.rate = 0; }
        b.free = false;
      } else { // 不在路線上（進場、繞路）：照 GPS 位置與方位角放
        b.free = true; b.pat = b.pat ?? r.mains[0]; b.x = w.x; b.z = w.z;
        b.ry = v.az != null ? Math.atan2(Math.sin((v.az * Math.PI) / 180), -Math.cos((v.az * Math.PI) / 180)) : 0;
      }
      out.push(b);
    }
    buses = out.slice(0, MAX_BUSES);
  }
  async function poll() {
    lastPoll = performance.now();
    try {
      const r = await fetch("/api/bus", { cache: "no-store" });
      const d = r.ok && (r.headers.get("content-type") || "").includes("json") ? await r.json() : { ok: false, code: r.status === 404 ? "no-api" : "error" };
      if (!liveWanted) return;
      if (d.ok) { liveData = d; status = { mode: "live", asOf: d.asOf, count: d.buses.length }; applyLive(d.buses); }
      else { liveData = null; status = { mode: "sim", reason: d.code || "error" }; if (buses.some((b) => b.live)) buses = spawnSim(); }
    } catch {
      liveData = null; status = { mode: "sim", reason: "offline" };
    }
    onChange();
  }
  function setLive(on) {
    if (on === liveWanted) return;
    liveWanted = on;
    clearInterval(pollTimer);
    if (on) { poll(); pollTimer = setInterval(() => { if (document.visibilityState === "visible") poll(); }, POLL_MS); }
    else { liveData = null; status = { mode: "sim", reason: "clock" }; buses = spawnSim(); onChange(); }
  }
  document.addEventListener("visibilitychange", () => { if (liveWanted && document.visibilityState === "visible" && performance.now() - lastPoll > POLL_MS) poll(); });

  // ── 每幀 ──
  const col = new THREE.Color(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(1.3, 1.3, 1.3), zero = new THREE.Vector3(0, 0, 0);
  function place(i, b) {
    let x, z, ry;
    if (b.free) ({ x, z, ry } = b); else { const p = pointAt(b.pat, b.s); x = p.x; z = p.z; ry = p.ry; }
    b.x = x; b.z = z; b.ry = ry;
    const y = groundY(x, z);
    q.setFromAxisAngle(up, ry);
    const show = b.visible ? sc : zero;
    busBody.setMatrixAt(i, m4.compose(pos.set(x, y + 0.16 * 1.3, z), q, show));
    busWin.setMatrixAt(i, m4.compose(pos.set(x, y + 0.2 * 1.3, z), q, show));
    busBase.setMatrixAt(i, m4.compose(pos.set(x, y + 0.04 * 1.3, z), q, show));
  }
  function update(dt, speedMul = 1, timeScale = 1) {
    const live = status.mode === "live";
    const d = dt * timeScale, hide = !live && closed();
    buses.forEach((b, i) => {
      if (live) { // 即時：用真實秒數往目標滑過去
        if (!b.free && b.target != null && b.s < b.target) b.s = Math.min(b.target, b.s + b.rate * dt);
        b.visible = true;
      } else {
        b.visible = !hide;
        if (!hide) {
          if (b.wait > 0) b.wait -= d;
          else {
            b.s += SPEED * S * Math.min(1.2, speedMul) * d;
            const st = b.pat.stops[b.next];
            if (st && b.s >= st.d) { b.s = st.d; b.wait = STOP_WAIT; b.next++; }
            else if (b.s >= b.pat.total) { b.pat = otherDirection(b); b.s = 0; b.next = nextStopIndex(b.pat, 0); b.wait = STOP_WAIT * 2; } // 終點：換返程
          }
        }
      }
      place(i, b);
      if (b._hex !== b.route.hex) { busBody.setColorAt(i, col.set(b.route.hex)); b._hex = b.route.hex; busBody.instanceColor.needsUpdate = true; }
    });
    for (const m of [busBody, busWin, busBase]) { m.count = buses.length; m.instanceMatrix.needsUpdate = true; }
  }
  function setNight(f, minute = null) { night = f; clockMinute = minute; }

  // ── 顯示控制 ──
  async function setColor(cid, on) {
    if (!(cid in colorOn)) return;
    colorOn[cid] = on;
    if (on && !branchesLoaded && loadBranches) {
      branchesLoading ??= loadBranches().then((d) => { addFile(d); branchesLoaded = true; buildStops(); });
      await branchesLoading;
    }
    for (const r of routes.values()) if (!r.trunk && r.color === cid) r.visible = on || r.id === highlighted;
    refresh();
  }
  function refresh() {
    syncRouteMeshes();
    layoutStops();
    stopPost.visible = stopSign.visible = stopsWanted;
    buses.forEach((b) => (b._hex = null));
    if (status.mode === "live" && liveData) applyLive(liveData.buses); else buses = spawnSim();
    applyHighlight();
    onChange();
  }
  let highlighted = null;
  function applyHighlight() {
    for (const r of routes.values()) if (r.mesh) r.mesh.material.opacity = !highlighted || r.id === highlighted ? 1 : 0.18;
    for (const r of routes.values()) if (r.variantMesh && r.id !== highlighted) { scene.remove(r.variantMesh); r.variantMesh.dispose(); r.variantMesh = null; }
    const r = routes.get(highlighted);
    if (r && !r.variantMesh) { const vs = r.patterns.filter((p) => !r.mains.includes(p)); if (vs.length) r.variantMesh = dashMesh(vs, "variant", r.hex); }
  }
  // 選取某條路線：其他路線變淡、畫出繞駛延駛；支線顏色沒開也會單獨顯示這條。回傳是否已載入
  async function highlight(id) {
    if (id && !routes.has(id) && !branchesLoaded && loadBranches) { branchesLoading ??= loadBranches().then((d) => { addFile(d); branchesLoaded = true; buildStops(); }); await branchesLoading; }
    const prev = routes.get(highlighted);
    highlighted = routes.has(id) ? id : null;
    if (prev && !prev.trunk && !colorOn[prev.color] && prev.id !== highlighted) prev.visible = false;
    const r = routes.get(highlighted);
    const needRefresh = r && !r.visible;
    if (r) r.visible = true;
    if (needRefresh || prev !== r) refresh(); else applyHighlight();
    return !!r;
  }
  function setView(dist) {
    const want = dist < STOP_SHOW;
    if (want !== stopsWanted) { stopsWanted = want; stopPost.visible = stopSign.visible = want; }
  }

  // ── 查詢（卡片、側欄、跟車用）──
  const stopName = (id) => stops[id]?.name ?? "";
  function busOf(k) { return typeof k === "number" ? buses[k] : buses.find((b) => b.key === k); }
  function info(k) {
    const b = busOf(k);
    if (!b) return null;
    const p = b.pat, nx = b.free ? null : p.stops[nextStopIndex(p, b.s - 0.01)];
    return { key: b.key, index: buses.indexOf(b), line: b.route.id, name: b.route.name, en: b.route.en, color: b.route.hex, trunk: b.route.trunk,
      from: p.from, to: p.to, heading: `往${p.to}`, label: p.label, kind: p.kind, nextStop: nx ? stopName(nx.id) : "", stops: p.stops.map((s) => stopName(s.id)),
      pos: new THREE.Vector3(b.x ?? 0, groundY(b.x ?? 0, b.z ?? 0), b.z ?? 0), visible: b.visible, live: b.live ? { plate: b.live.plate, gps: b.live.gps, speed: b.live.speed, sub: b.live.sub, offRoute: !!b.free } : null };
  }
  const state = () => buses.map((b) => ({ key: b.key, line: b.route.id, name: b.route.name, x: +(b.x ?? 0).toFixed(2), z: +(b.z ?? 0).toFixed(2), visible: b.visible, nextStop: info(b.key)?.nextStop ?? "" }));
  function routeInfo(id) {
    const r = routes.get(id);
    if (!r) return null;
    return { id: r.id, name: r.name, en: r.en, hex: r.hex, color: r.color, trunk: r.trunk, from: r.from, to: r.to, liveCount: r.liveCount,
      buses: buses.filter((b) => b.route === r && b.visible).length,
      patterns: r.patterns.map((p) => ({ label: p.label, kind: p.kind, dir: p.dir, from: p.from, to: p.to, length: p.total, stops: p.stops.map((s) => ({ id: s.id, name: stopName(s.id), en: stops[s.id]?.en ?? "" })) })) };
  }
  const stopInfo = (i) => { const s = stops[+i]; return s && { id: +i, name: s.name, en: s.en, x: s.x, z: s.z, routes: [...s.routes].filter((id) => routes.has(id)) }; };
  const routeList = () => [...routes.values()].map((r) => ({ id: r.id, name: r.name, en: r.en, hex: r.hex, color: r.color, trunk: r.trunk, from: r.from, to: r.to, visible: r.visible, liveCount: r.liveCount }));
  function pick(hit) {
    if (hit.object === busBody && buses[hit.instanceId]) return { type: "bus", id: buses[hit.instanceId].key };
    if (hit.object === stopSign) return { type: "busstop", id: String(hit.instanceId) };
    return null;
  }
  function stopPos(i) { const s = stops[+i]; return s ? new THREE.Vector3(s.x, groundY(s.x, s.z), s.z) : null; }
  function routeCenter(id) { // 飛到整條路線：正線往程的包圍盒中心與半徑
    const p = routes.get(id)?.mains[0];
    if (!p) return null;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of p.pts) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    return { center: new THREE.Vector3(cx, groundY(cx, cz), cz), radius: Math.max(x1 - x0, z1 - z0) / 2 };
  }

  buses = spawnSim();
  syncRouteMeshes();
  update(0, 0);
  return {
    update, setNight, setLive, setColor, highlight, setView, refresh,
    state, info, routeInfo, stopInfo, routeList, pick, stopPos, routeCenter,
    colors: () => colors, colorOn: () => ({ ...colorOn }), status: () => ({ ...status }), branchesLoaded: () => branchesLoaded,
    get pickables() { return [busBody, ...(stopsWanted ? [stopSign] : [])]; },
    get count() { return buses.length; },
  };
}
