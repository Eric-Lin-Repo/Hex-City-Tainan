// 糖鐵五分車：烏樹林糖廠的觀光窄軌線。自己畫窄軌（InstancedMesh），一台小柴油機車頭拉兩節開放式客車廂沿折線慢速來回，
// 只在 09:00–16:30 營運，其他時間停在起點車站並隱藏。資料來自 data/sugar.json，介面與 train.js 一致。
import { TOP } from "./world.js";

export function createSugarRail(THREE, scene, data, heightAt = () => 0, MS = 1) { // MS：地圖放大倍數
  const box = new THREE.BoxGeometry(1, 1, 1), wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.7 }); // 鏽紅鐵軌
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.9 }); // 枕木
  const locoMat = new THREE.MeshStandardMaterial({ color: 0xe8562a, roughness: 0.55 }); // 橘紅機車頭
  const carMat = new THREE.MeshStandardMaterial({ color: 0x3f7a4a, roughness: 0.6 }); // 綠色車身
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xe9dfc4, roughness: 0.8 }); // 米色頂棚
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.8 });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8 });
  const groundY = (x, z) => TOP + heightAt(x, z) + 0.01; // 軌道貼地高度
  const GAUGE = 0.09, TIE_W = 0.14, TIE_GAP = 0.18, CAR_GAP = 0.34, SPEED = 1.45;

  // 沿折線每隔 gap 取一點（回傳 [x, z, ry]），枕木用；寫法同 infrastructure.js 的 alongPath
  function alongPath(pts, gap) {
    const out = [];
    let carry = gap / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      for (let d = carry; d < len; d += gap) out.push([a.x + (dx * d) / len, a.z + (dz * d) / len, Math.atan2(dx, dz)]);
      carry = ((carry - len) % gap + gap) % gap;
    }
    return out;
  }
  // 窄軌：每段兩條鐵軌（順著坡度傾斜）＋ 沿線枕木，各自塞進一個 InstancedMesh
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const setInst = (inst, k, x, y, z, pitch, ry, sx, sy, sz) => inst.setMatrixAt(k, M.compose(P.set(x, y, z), Q.setFromEuler(E.set(pitch, ry, 0, "YXZ")), S.set(sx, sy, sz)));
  function track(pts) {
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      const ya = groundY(a.x, a.z), yb = groundY(b.x, b.z);
      segs.push({ mx: (a.x + b.x) / 2, mz: (a.z + b.z) / 2, my: (ya + yb) / 2, len: Math.hypot(len, yb - ya), ry: Math.atan2(dx, dz), pitch: -Math.atan2(yb - ya, len), lx: dz / len, lz: -dx / len });
    }
    const rails = new THREE.InstancedMesh(box, railMat, segs.length * 2);
    segs.forEach((s, i) => { for (const side of [-1, 1]) setInst(rails, i * 2 + (side + 1) / 2, s.mx + s.lx * side * GAUGE / 2, s.my + 0.025, s.mz + s.lz * side * GAUGE / 2, s.pitch, s.ry, 0.02, 0.02, s.len + 0.03); });
    const tiePts = alongPath(pts, TIE_GAP);
    const ties = new THREE.InstancedMesh(box, tieMat, tiePts.length);
    tiePts.forEach(([x, z, ry], k) => setInst(ties, k, x, groundY(x, z) + 0.008, z, 0, ry, TIE_W, 0.015, 0.035));
    for (const m of [rails, ties]) { m.instanceMatrix.needsUpdate = true; m.receiveShadow = true; scene.add(m); }
    return { rails: segs.length * 2, ties: tiePts.length };
  }

  const pickables = [];
  const part = (g, ge, m, pos, sc, rot) => { const o = new THREE.Mesh(ge, m); o.position.set(...pos); o.scale.set(...sc); if (rot) o.rotation.set(...rot); o.castShadow = true; g.add(o); return o; };
  const wheels = (g) => { for (const z of [-0.1, 0.1]) for (const s of [-1, 1]) part(g, wheelGeo, darkMat, [s * 0.05, 0.03, z], [0.06, 0.02, 0.06], [0, 0, Math.PI / 2]); };
  // 小型柴油機車頭：長引擎罩 + 後方駕駛室，車頭朝本地 +z；車身是點選目標
  function makeLoco(line) {
    const g = new THREE.Group();
    const body = part(g, box, locoMat, [0, 0.085, 0.03], [0.16, 0.09, 0.24]); // 引擎罩
    part(g, box, locoMat, [0, 0.13, -0.1], [0.16, 0.12, 0.1]); // 駕駛室
    part(g, box, darkMat, [0, 0.195, -0.1], [0.17, 0.015, 0.11]); // 駕駛室頂
    for (const s of [-1, 1]) part(g, box, lightMat, [s * 0.082, 0.14, -0.1], [0.005, 0.04, 0.06]); // 側窗
    part(g, box, darkMat, [0, 0.145, 0.12], [0.03, 0.02, 0.03]); // 排氣管
    part(g, box, lightMat, [0, 0.11, 0.152], [0.04, 0.025, 0.005]); // 頭燈
    wheels(g);
    body.userData = { type: "sugar", line };
    pickables.push(body);
    return g;
  }
  // 開放式客車廂：矮車身、四根柱子撐著頂棚
  function makeCar() {
    const g = new THREE.Group();
    part(g, box, carMat, [0, 0.07, 0], [0.16, 0.06, 0.3]); // 車身
    for (const s of [-1, 1]) for (const z of [-0.12, 0.12]) part(g, box, darkMat, [s * 0.07, 0.115, z], [0.012, 0.09, 0.012]); // 柱子
    part(g, box, roofMat, [0, 0.165, 0], [0.17, 0.015, 0.31]); // 頂棚
    wheels(g);
    return g;
  }

  const trains = [];
  const stats = { rails: 0, ties: 0 };
  for (const ln of data.lines || []) {
    const pts = ln.points.map(([x, z]) => new THREE.Vector3(x, 0, z));
    if (pts.length < 2) continue;
    const t = track(pts);
    stats.rails += t.rails; stats.ties += t.ties;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i - 1].distanceTo(pts[i]));
    const total = cum[cum.length - 1];
    // 停靠點轉成沿線距離；列車中心離兩端至少一個車距，車廂才不會擠出軌道外
    const clamp = (s) => Math.max(CAR_GAP, Math.min(total - CAR_GAP, s));
    const stopS = (ln.stops?.length ? ln.stops.map((st) => st.i) : [0, pts.length - 1]).filter((i) => i >= 0 && i < pts.length).map((i) => clamp(cum[i])).sort((a, b) => a - b);
    if (stopS.length < 2) continue;
    const cars = [makeLoco(ln.id), makeCar(), makeCar()]; // 機車頭在 +s 端：去程拉、回程推
    cars.forEach((c) => scene.add(c));
    trains.push({ line: ln.id, name: ln.name, pts, cum, total, stopS, cars, s: stopS[0], dir: 1, stop: 0, wait: 2 });
  }

  const pos = new THREE.Vector3();
  // 沿折線距離 s 的位置與朝向（寫法同 train.js）
  function placeAt(tr, s, obj) {
    const { pts, cum } = tr, sc = Math.max(0, Math.min(tr.total, s));
    let i = 0;
    while (i < cum.length - 2 && sc > cum[i + 1]) i++;
    const a = pts[i], b = pts[i + 1], seg = cum[i + 1] - cum[i] || 1, t = (sc - cum[i]) / seg;
    const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
    pos.set(px, groundY(px, pz) + 0.02, pz);
    obj.position.copy(pos);
    obj.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  }

  let night = 0, clockMinute = null;
  // 營運時段 09:00–16:30；沒有時鐘時退回用夜色判斷
  const open = () => (clockMinute != null ? clockMinute >= 540 && clockMinute < 990 : night < 0.5);
  // timeScale：時間播放時列車也加速（與 train.js 相同用法）
  function update(dt, speedMul = 1, timeScale = 1) {
    const d = dt * timeScale;
    for (const tr of trains) {
      const on = open();
      if (!on) { tr.s = tr.stopS[0]; tr.stop = 0; tr.dir = 1; tr.wait = 2; } // 收班：回到起點車站停著
      else if (tr.wait > 0) tr.wait -= d;
      else {
        tr.s += tr.dir * SPEED * MS * Math.min(1.2, speedMul) * d; // 地圖放大 S 倍，行駛時間不變
        const next = tr.stop + tr.dir, target = tr.stopS[next];
        if ((tr.dir > 0 && tr.s >= target) || (tr.dir < 0 && tr.s <= target)) {
          tr.s = target; tr.stop = next;
          const end = tr.stop === 0 || tr.stop === tr.stopS.length - 1;
          tr.wait = end ? 6 : 2;
          if (end) tr.dir *= -1; // 端點折返
        }
      }
      tr.cars.forEach((car, i) => { car.visible = on; placeAt(tr, tr.s + (1 - i) * CAR_GAP, car); }); // 每節車廂各自沿線取點
    }
  }
  function setNight(f, minute = null) { night = f; clockMinute = minute; }
  // 除錯用：每列五分車目前的方向與位置
  const state = () => trains.map((tr) => ({ line: tr.line, name: tr.name, dir: tr.dir, x: +tr.cars[0].position.x.toFixed(2), z: +tr.cars[0].position.z.toFixed(2), visible: tr.cars[0].visible }));
  update(0, 0);
  return { update, setNight, state, pickables, count: trains.length, stats };
}
