// 人流熱度圖：把地圖切成固定大小的格子，每隔一段時間統計每格的行人數，畫成半透明色塊。
// createHeatmap(THREE, scene, bounds, groundY) → { setEnabled(on), update(people, dt), enabled }
import { TOP } from "./world.js";

const CELL_1X = 2.0, HOT_1X = 6; // 1 倍地圖時的格子邊長（世界單位）與「最熱」人數
const EVERY = 0.5; // 幾秒統計一次
const SMOOTH = 0.35; // 色塊強度的平滑係數（越小越慢）

export function createHeatmap(THREE, scene, bounds, groundY = () => TOP, S = 1, peopleK = 1) {
  // 地圖放大 S 倍：格子邊長 ×S（格數不變）；一格的面積 ×S²、全市行人 ×peopleK，所以一格的人數約 ×peopleK
  const CELL = CELL_1X * S, HOT = HOT_1X * peopleK;
  const nx = Math.ceil((bounds.maxX - bounds.minX) / CELL), nz = Math.ceil((bounds.maxZ - bounds.minZ) / CELL);
  const n = nx * nz;
  const geo = new THREE.PlaneGeometry(CELL * 0.96, CELL * 0.96).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, vertexColors: false });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.visible = false;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  const counts = new Float32Array(n), level = new Float32Array(n);
  const m = new THREE.Matrix4(), color = new THREE.Color();
  const cold = new THREE.Color(0xf5d76e), warm = new THREE.Color(0xe8632b), hot = new THREE.Color(0x8f1d2e);
  // 位置只算一次：格心貼地
  const centers = [];
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const x = bounds.minX + (ix + 0.5) * CELL, z = bounds.minZ + (iz + 0.5) * CELL;
    centers.push([x, groundY(x, z) + 0.03, z]);
    m.makeScale(0, 0, 0); mesh.setMatrixAt(iz * nx + ix, m); mesh.setColorAt(iz * nx + ix, cold);
  }
  scene.add(mesh);

  let acc = 0, enabled = false;
  const ramp = (t) => (t < 0.5 ? color.copy(cold).lerp(warm, t * 2) : color.copy(warm).lerp(hot, (t - 0.5) * 2));
  function update(people, dt) {
    if (!enabled) return;
    acc += dt;
    if (acc < EVERY) return;
    acc = 0;
    counts.fill(0);
    people.forEachVisible((x, z) => {
      const ix = Math.floor((x - bounds.minX) / CELL), iz = Math.floor((z - bounds.minZ) / CELL);
      if (ix >= 0 && ix < nx && iz >= 0 && iz < nz) counts[iz * nx + ix]++;
    });
    for (let i = 0; i < n; i++) {
      const target = Math.min(1, counts[i] / HOT); // HOT 人以上就是最熱
      level[i] += (target - level[i]) * SMOOTH;
      const v = level[i];
      const sc = v < 0.02 ? 0 : 0.6 + 0.4 * v;
      const [x, y, z] = centers[i];
      m.makeScale(sc, 1, sc).setPosition(x, y, z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, ramp(v));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }
  function setEnabled(on) { enabled = on; mesh.visible = on; if (on) acc = EVERY; else level.fill(0); }
  return { update, setEnabled, get enabled() { return enabled; }, cells: n };
}
