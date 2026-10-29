// 國道與快速道路的即時車速：把路段（高公局／TDX 的分向路段線形）逐段對上 highways.js 的路段鏈，時鐘在「現在」時每 60 秒問 /api/freeway（Worker 快取 30 分鐘）。
//   國道 1、3、8 號：線形是 data/freeway_sections.json（tools/build_traffic.py，高公局路段檔），車速由 Worker 向 TDX 抓（最多 30 分鐘一次，算 TDX 額度）
//   台 61、84、86：/api/expressway-sections（Worker 每天向 TDX 抓一次台南範圍的路段與線形），車速最多 30 分鐘一次（TDX 額度）
// matchSections(chains, sections, { maxDist }) → 每條鏈一個 Int16Array（每一小段對到的路段索引，-1 = 沒對到）；匝道不對
//   chains：[{ route, link, pts: [{ x, z }] }]；sections：[{ id, route, pts: [[x, z]] }]，pts 依行車方向，方向要跟鏈相同才算
// createTraffic({ highways, sections, projection, fetchJson }) → { setLive(on), status() }
//   highways 要有 addSections(list) 與 setSpeeds(Map id → [km/h, 壅塞等級] | null)
const POLL_MS = 60 * 1000;

export function matchSections(chains, sections, { maxDist = 0.6 } = {}) {
  const grid = new Map(), cell = 1;
  const keyOf = (route, gx, gz) => `${route}|${gx}|${gz}`;
  sections.forEach((s, si) => {
    for (let k = 0; k < s.pts.length - 1; k++) {
      const [ax, az] = s.pts[k], [bx, bz] = s.pts[k + 1];
      for (let gx = Math.floor((Math.min(ax, bx) - maxDist) / cell); gx <= Math.floor((Math.max(ax, bx) + maxDist) / cell); gx++)
        for (let gz = Math.floor((Math.min(az, bz) - maxDist) / cell); gz <= Math.floor((Math.max(az, bz) + maxDist) / cell); gz++) {
          const key = keyOf(s.route, gx, gz);
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push([si, ax, az, bx, bz]);
        }
    }
  });
  return chains.map((c) => {
    if (c.link) return null;
    const out = new Int16Array(Math.max(0, c.pts.length - 1)).fill(-1);
    for (let k = 0; k < c.pts.length - 1; k++) {
      const a = c.pts[k], b = c.pts[k + 1], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      let best = maxDist, pick = -1;
      for (const [si, ax, az, bx, bz] of grid.get(keyOf(c.route, Math.floor(mx / cell), Math.floor(mz / cell))) || []) {
        const sx = bx - ax, sz = bz - az, sl = Math.hypot(sx, sz);
        if (sl < 1e-6 || (dx * sx + dz * sz) / (len * sl) < 0.6) continue; // 方向要相同（雙向車道各自對）
        const f = Math.max(0, Math.min(1, ((mx - ax) * sx + (mz - az) * sz) / (sl * sl)));
        const d = Math.hypot(mx - (ax + sx * f), mz - (az + sz * f));
        if (d < best) { best = d; pick = si; }
      }
      out[k] = pick;
    }
    return out;
  });
}

// 車速 → 路面顏色（高公局國道的壅塞分級：80 以上順暢、60–79、40–59、40 以下壅塞）
export const speedColor = (v) => (v >= 80 ? 0x3f9a5b : v >= 60 ? 0xc9b52a : v >= 40 ? 0xe08a2e : 0xd0413a);

export function createTraffic({ highways, sections = [], projection = null, fetchJson = (u) => fetch(u, { cache: "no-store" }).then((r) => r.json()) } = {}) {
  highways.addSections(sections);
  let wanted = false, timer = 0, lastPoll = 0, expressLoaded = false;
  let status = { mode: "sim", reason: "clock", freeway: null, express: null };
  const toWorld = (lon, lat) => [(lon - projection.lon_c) * projection.km_x * projection.k, -(lat - projection.lat_c) * projection.km_z * projection.k];

  async function loadExpress() { // 快速道路的路段線形：第一次切到即時才抓（Worker 一天只向 TDX 抓一次）
    if (expressLoaded || !projection) return;
    expressLoaded = true;
    try {
      const d = await fetchJson("/api/expressway-sections");
      if (d.ok && d.sections?.length) highways.addSections(d.sections.map((s) => ({ ...s, pts: s.pts.map(([lon, lat]) => toWorld(lon, lat)) })));
    } catch { expressLoaded = false; } // 下次再試
  }
  async function poll() {
    lastPoll = performance.now();
    try {
      const d = await fetchJson("/api/freeway");
      if (!wanted) return;
      const speeds = new Map();
      for (const part of [d.freeway, d.express]) if (part?.ok) for (const [id, v] of Object.entries(part.speeds || {})) speeds.set(id, v);
      status = { mode: speeds.size ? "live" : "sim", reason: speeds.size ? null : d.freeway?.code || "error", freeway: d.freeway, express: d.express };
      highways.setSpeeds(speeds.size ? speeds : null);
    } catch {
      if (!wanted) return;
      status = { mode: "sim", reason: "offline", freeway: null, express: null };
      highways.setSpeeds(null);
    }
  }
  function setLive(on) {
    if (on === wanted) return;
    wanted = on;
    clearInterval(timer);
    if (on) { loadExpress().then(poll); timer = setInterval(() => { if (document.visibilityState === "visible") poll(); }, POLL_MS); }
    else { status = { mode: "sim", reason: "clock", freeway: null, express: null }; highways.setSpeeds(null); }
  }
  document.addEventListener("visibilitychange", () => { if (wanted && document.visibilityState === "visible" && performance.now() - lastPoll > POLL_MS) poll(); });
  return { setLive, status: () => status };
}
