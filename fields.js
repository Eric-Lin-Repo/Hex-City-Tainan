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
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qt = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3();
  const STEEP = 0.3, BUMPY = 0.12; // 坡度（高差／距離）超過 STEEP，或地面起伏離平面超過 BUMPY，就不放這塊田
  fields.forEach((f, i) => {
    // 田貼著坡面：取四角與中心的地面高度，擬合一個斜面（田的局部座標：x 沿寬、z 沿深，與 build_city.py 的 rect_corners 相同）
    const c = Math.cos(f.ry), s = Math.sin(f.ry), at = (lx, lz) => groundY(f.x + lx * c + lz * s, f.z - lx * s + lz * c);
    const hw = f.w / 2, hd = f.d / 2, h1 = at(-hw, -hd), h2 = at(hw, -hd), h3 = at(hw, hd), h4 = at(-hw, hd), hc = groundY(f.x, f.z);
    const mean = (h1 + h2 + h3 + h4) / 4, sx = (h2 + h3 - h1 - h4) / (2 * f.w), sz = (h3 + h4 - h1 - h2) / (2 * f.d);
    const plane = (lx, lz) => mean + sx * lx + sz * lz;
    const lift = Math.max(0, h1 - plane(-hw, -hd), h2 - plane(hw, -hd), h3 - plane(hw, hd), h4 - plane(-hw, hd), hc - mean); // 地面高出斜面的部分，田要再抬高才不會被蓋住
    f.hidden = Math.hypot(sx, sz) > STEEP || lift > BUMPY;
    if (f.hidden) { m.makeScale(0, 0, 0); mesh.setMatrixAt(i, m); ridge.setMatrixAt(i, m); return; }
    q.setFromEuler(e.set(0, f.ry, 0)).multiply(qt.setFromUnitVectors(up, nrm.set(-sx, 1, -sz).normalize())); // 先在田的局部座標傾斜，再轉到田的方向
    mesh.setMatrixAt(i, m.compose(pos.set(f.x, mean + lift + 0.02, f.z), q, scl.set(f.w, 1, f.d)));
    ridge.setMatrixAt(i, m.compose(pos.set(f.x, mean + lift + 0.012, f.z), q, scl.set(f.w + 0.1, 1, f.d + 0.1)));
  });
  const hiddenCount = fields.filter((f) => f.hidden).length;
  if (hiddenCount) console.info(`[fields] ${hiddenCount}/${n} 塊田在太陡或起伏太大的坡地上，不畫`);
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
    return { stage: s.label, index: i, color: ca.set(s.color).lerp(cb.set(next.color), t).clone() };
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

  // 景觀用（scenery.js）：某作物的田（可限定區）與該作物當天的階段名稱
  const list = (cropId, districtId = null) => fields.filter((f) => !f.hidden && f.cropId === cropId && (!districtId || f.district === districtId)).map(({ x, z, w, d, ry, district }) => ({ x, z, w, d, ry, district }));
  const stageNow = (cropId) => current.get(cropId)?.stage ?? "";
  const stageIndex = (cropId) => current.get(cropId)?.index ?? -1; // 階段在 crops.json 的序號（英文版的階段名稱會被翻譯，判斷要用序號）
  return { setDate, stageOf, fieldAt, list, stageNow, stageIndex, pickables: n ? [mesh] : [], count: n };
}
