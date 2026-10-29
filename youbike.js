// YouBike 2.0 站點：拉近才畫（同公車站牌），第一次拉近才向 /api/youbike 要資料，之後畫面開著、拉近時每 3 分鐘更新一次。
//   每站一根細柱＋頂上的色塊：綠 = 可借車多、橘 = 剩不到兩成、紅 = 沒車可借、灰 = 暫停或停止營運。
//   資料：Worker 代理交通部 TDX（每 3 分鐘一次，算 TDX 額度）；額度用完時改用 YouBike 官網資料。
// createYoubike(THREE, scene, { projection, groundY, onChange })
//   → { setView(dist), pick(hit), info(i), pos(i), status(), pickables }
const SHOW = 16; // 相機離焦點小於這個距離才畫（同 bus.js 的 STOP_SHOW）
const POLL_MS = 3 * 60 * 1000;
const COLOR = { many: 0x3f9a5b, few: 0xe08a2e, none: 0xd0413a, off: 0x9a9a96 };

export function createYoubike(THREE, scene, { projection, groundY = () => 0, onChange = () => {}, fetchJson = (u) => fetch(u, { cache: "no-store" }).then((r) => r.json()) } = {}) {
  const toWorld = (lat, lon) => [(lon - projection.lon_c) * projection.km_x * projection.k, -(lat - projection.lat_c) * projection.km_z * projection.k];
  let stations = [], post = null, cap = null, wanted = false, loading = false, lastPoll = 0;
  let status = { ok: false, reason: "idle" };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
  const level = (st) => (st.status !== 1 || st.rent == null ? "off" : st.rent === 0 ? "none" : st.cap && st.rent / st.cap < 0.2 ? "few" : "many");

  function build() { // 站數只在第一次決定；之後的更新只換顏色
    post = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 5), new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.6 }), stations.length);
    cap = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.04, 0.06), new THREE.MeshBasicMaterial(), stations.length);
    stations.forEach((st, i) => {
      post.setMatrixAt(i, m4.compose(v.set(st.x, st.y + 0.09, st.z), q, s3));
      cap.setMatrixAt(i, m4.compose(v.set(st.x, st.y + 0.2, st.z), q, s3));
    });
    post.userData = cap.userData = { type: "youbike" };
    for (const m of [post, cap]) { m.visible = wanted; scene.add(m); }
  }
  function paint() {
    stations.forEach((st, i) => cap.setColorAt(i, col.set(COLOR[level(st)])));
    cap.instanceColor.needsUpdate = true;
  }
  async function poll() {
    if (loading) return;
    loading = true; lastPoll = performance.now();
    try {
      const d = await fetchJson("/api/youbike");
      if (!d.ok) { status = { ok: false, reason: d.code || "error", error: d.error }; return; }
      const prev = new Map(stations.map((s, i) => [s.id, i]));
      const list = d.stations.map(([id, name, lat, lon, capacity, rent, ret, ebike, st]) => { const [x, z] = toWorld(lat, lon); return { id, name, lat, lon, x, z, y: groundY(x, z), cap: capacity, rent, ret, ebike, status: st }; });
      if (!post) { stations = list; build(); }
      else for (const s of list) { const i = prev.get(s.id); if (i != null) stations[i] = { ...stations[i], ...s }; } // 新開的站等下次重新整理再畫
      paint();
      status = { ok: true, source: d.source, asOf: d.asOf, count: stations.length };
      onChange();
    } catch { status = { ok: false, reason: "offline" }; }
    finally { loading = false; }
  }
  function setView(dist) {
    const want = dist < SHOW;
    if (want !== wanted) { wanted = want; if (post) post.visible = cap.visible = want; }
    if (want && document.visibilityState === "visible" && performance.now() - lastPoll > (status.ok ? POLL_MS : 60000)) poll(); // 失敗的話一分鐘後再試
  }
  const pick = (hit) => (hit.object === post || hit.object === cap ? { type: "youbike", id: hit.instanceId } : null);
  const info = (i) => { const st = stations[+i]; return st ? { ...st, level: level(st), source: status.source, asOf: status.asOf } : null; };
  const pos = (i) => { const st = stations[+i]; return st ? new THREE.Vector3(st.x, st.y, st.z) : null; };
  return { setView, pick, info, pos, status: () => status, get pickables() { return post && wanted ? [post, cap] : []; } };
}
