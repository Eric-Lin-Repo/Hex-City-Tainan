// 郊區的農田色塊：build_city.py 在 city.json 各區的 fields 放了矩形 [x, z, 寬, 深, 旋轉]，
// 這裡用一個 InstancedMesh 畫出來，顏色依 data/crops.json 的作物產季與日期決定（同區多種作物就輪流分配給各塊田）。
const DAYS = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]; // 各月第一天的年內序（二月算 29 天，閏年也對得上）
const doyOf = (md) => DAYS[+md.slice(0, 2) - 1] + +md.slice(3); // "MM-DD" → 1..366
const FADE = 12; // 階段結束前幾天開始往下一階段的顏色過渡，季節轉換才不會跳一下

export function createFields(THREE, scene, city, crops, groundY) {
  // 攤平成田的清單：每塊田記所在區與作物
  const fields = [];
  for (const d of city.districts) {
    const kinds = (crops.byDistrict[d.id] || ["rice"]).filter((k) => crops.crops[k]);
    if (!kinds.length) continue;
    (d.fields || []).forEach(([x, z, w, dep, ry], i) => fields.push({ district: d.id, districtName: d.name, cropId: kinds[i % kinds.length], x, z, w, d: dep, ry }));
  }
  const n = fields.length;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.03, 1), new THREE.MeshStandardMaterial({ roughness: 0.95 }), n);
  mesh.receiveShadow = true;
  mesh.userData = { type: "field" }; // 點到時用 instanceId 配 fieldAt() 查回區與作物
  // 田埂：外圍一圈略深、略低的細框，不可點選
  const ridge = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.02, 1), new THREE.MeshStandardMaterial({ color: 0x8b7a5a, roughness: 1 }), n);
  ridge.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  fields.forEach((f, i) => {
    const y = groundY(f.x, f.z);
    q.setFromEuler(e.set(0, f.ry, 0));
    mesh.setMatrixAt(i, m.compose(pos.set(f.x, y + 0.02, f.z), q, scl.set(f.w, 1, f.d)));
    ridge.setMatrixAt(i, m.compose(pos.set(f.x, y + 0.012, f.z), q, scl.set(f.w + 0.1, 1, f.d + 0.1)));
  });
  if (n) scene.add(mesh, ridge);

  // 某作物在年內第 doy 天的階段與顏色（接近階段結尾時往下一階段的顏色 lerp）
  const ca = new THREE.Color(), cb = new THREE.Color();
  function stageAt(crop, doy) {
    const st = crop.stages;
    const inRange = (s) => { const a = doyOf(s.from), b = doyOf(s.to); return a <= b ? doy >= a && doy <= b : doy >= a || doy <= b; };
    const i = Math.max(0, st.findIndex(inRange));
    const s = st[i], next = st[(i + 1) % st.length], to = doyOf(s.to);
    const left = to >= doy ? to - doy : to + 366 - doy; // 這個階段還剩幾天
    const t = next === s ? 0 : Math.max(0, 1 - left / FADE);
    return { stage: s.label, color: ca.set(s.color).lerp(cb.set(next.color), t).clone() };
  }

  const current = new Map(); // cropId → { stage, color }，setDate 之後更新
  function setDate(date) {
    const doy = DAYS[date.getUTCMonth()] + date.getUTCDate();
    for (const [id, c] of Object.entries(crops.crops)) current.set(id, stageAt(c, doy));
    fields.forEach((f, i) => mesh.setColorAt(i, current.get(f.cropId).color));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  // 區卡片用：這一區當天有哪些作物、各在什麼階段，例如 [{ crop: "水稻", stage: "二期收割" }]
  function stageOf(districtId) {
    const seen = new Set();
    return fields.filter((f) => f.district === districtId && !seen.has(f.cropId) && seen.add(f.cropId))
      .map((f) => ({ crop: crops.crops[f.cropId].name, stage: current.get(f.cropId)?.stage ?? "" }));
  }
  // 點選：InstancedMesh 的 instanceId → 這塊田的區、作物與當天階段
  function fieldAt(instanceId) {
    const f = fields[instanceId];
    if (!f) return null;
    const cur = current.get(f.cropId);
    return { type: "field", id: instanceId, district: f.district, districtName: f.districtName, cropId: f.cropId, crop: crops.crops[f.cropId].name, stage: cur?.stage ?? "", color: cur ? "#" + cur.color.getHexString() : null, x: f.x, z: f.z };
  }
  setDate(new Date()); // 先用今天上色，app 之後再用日曆的日期呼叫 setDate

  return { setDate, stageOf, fieldAt, pickables: n ? [mesh] : [], count: n };
}
