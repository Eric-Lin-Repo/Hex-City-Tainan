// 步道：山海圳國家綠道與幾條代表性自行車道畫成貼地的虛線，腳踏車騎士沿線來回騎；只在 06:00–19:00 出現。資料來自 data/trails.json。
import { TOP, mulberry } from "./world.js";

const DASH = { w: 0.06, len: 0.24, gap: 0.12, h: 0.02 }; // 虛線小方塊：寬、長、間隔、高
const RIDE = { from: 360, to: 1140, speed: 1.2 }; // 出現時段（分鐘）與基準速度（1 倍地圖的單位/秒；地圖放大 S 倍時騎士和行人一樣只快 S/2 倍，不然像在飆車）
const SHIRTS = [0xdb6a41, 0x4a7fc1, 0xe8c547, 0x7a6fb5, 0xf4efe6, 0x3e7c8c];
const SKIN = 0xf3d2b8;

export function createTrails(THREE, scene, data, heightAt = () => 0, S = 1) { // S：地圖放大倍數
  const rnd = mulberry(177);
  const groundY = (x, z) => TOP + heightAt(x, z);
  const pickables = [], riders = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);

  // 沿折線每隔 gap 取一點（含朝向 ry），跨越轉角時把剩餘距離帶到下一段
  function alongPath(pts, gap) {
    const out = [];
    let carry = gap / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const ry = Math.atan2(dx, dz);
      for (let d = carry; d < len; d += gap) out.push([ax + (dx * d) / len, az + (dz * d) / len, ry]);
      carry = ((carry - len) % gap + gap) % gap;
    }
    return out;
  }

  // ── 步道線：每條步道一個 InstancedMesh，點擊可選 ──
  const dashGeo = new THREE.BoxGeometry(DASH.w, DASH.h, DASH.len);
  for (const tr of data.trails || []) {
    const dashes = tr.segments.flatMap((seg) => alongPath(seg, DASH.len + DASH.gap));
    if (!dashes.length) continue;
    const mesh = new THREE.InstancedMesh(dashGeo, new THREE.MeshStandardMaterial({ color: tr.color, roughness: 0.85 }), dashes.length);
    dashes.forEach(([x, z, ry], i) => mesh.setMatrixAt(i, m4.compose(v.set(x, groundY(x, z) + 0.014, z), q.setFromEuler(e.set(0, ry, 0)), one)));
    mesh.receiveShadow = true;
    mesh.userData = { type: "trail", id: tr.id };
    scene.add(mesh);
    pickables.push(mesh);
  }

  // ── 騎士：腳踏車（兩輪＋車架）加一個前傾騎坐的人，整體約 0.5 高，比例同 people.js 的行人 ──
  const geo = {
    wheel: new THREE.CylinderGeometry(0.06, 0.06, 0.025, 12).rotateZ(Math.PI / 2), // 軸向轉成本地 x，轉 rotation.x 就是輪子滾動
    box: new THREE.BoxGeometry(1, 1, 1),
    body: new THREE.CapsuleGeometry(0.5, 0.6, 3, 8),
    head: new THREE.SphereGeometry(0.5, 12, 9),
    helmet: new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  };
  const mat = {
    frame: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x1e1e22, roughness: 0.9 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.8 }),
    skin: new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.8 }),
    shirts: SHIRTS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })),
  };
  function makeRider() {
    const g = new THREE.Group();
    const shirt = mat.shirts[Math.floor(rnd() * mat.shirts.length)];
    const mesh = (ge, m, pos, sc = [1, 1, 1], rot = null) => { const o = new THREE.Mesh(ge, m); o.position.set(...pos); o.scale.set(...sc); if (rot) o.rotation.set(...rot); o.castShadow = true; g.add(o); return o; };
    const wheels = [-0.11, 0.11].map((z) => mesh(geo.wheel, mat.tire, [0, 0.06, z])); // 車輪（車頭朝本地 +z）
    mesh(geo.box, mat.frame, [0, 0.11, 0], [0.025, 0.025, 0.24]); // 下管
    mesh(geo.box, mat.frame, [0, 0.16, -0.04], [0.025, 0.1, 0.025]); // 座管
    mesh(geo.box, mat.frame, [0, 0.21, -0.04], [0.07, 0.02, 0.05]); // 坐墊
    mesh(geo.box, mat.frame, [0, 0.16, 0.09], [0.025, 0.12, 0.025], [0.3, 0, 0]); // 前叉
    mesh(geo.box, mat.frame, [0, 0.22, 0.07], [0.16, 0.018, 0.018]); // 把手
    for (const s of [-1, 1]) {
      mesh(geo.box, mat.pants, [s * 0.035, 0.18, -0.01], [0.045, 0.12, 0.05], [-0.5, 0, 0]); // 大腿往前踩
      mesh(geo.box, shirt, [s * 0.06, 0.3, 0.03], [0.035, 0.12, 0.035], [-0.9, 0, 0]); // 手臂伸向把手
    }
    mesh(geo.body, shirt, [0, 0.31, -0.02], [0.15, 0.13, 0.13], [-0.45, 0, 0]); // 身體前傾
    mesh(geo.head, mat.skin, [0, 0.42, 0.04], [0.2, 0.19, 0.19]); // 頭
    mesh(geo.helmet, mat.shirts[(Math.floor(rnd() * 3) + 3) % mat.shirts.length], [0, 0.43, 0.03], [0.22, 0.16, 0.21], [-0.3, 0, 0]); // 安全帽
    scene.add(g);
    return { g, wheels };
  }

  // 每條步道依長度放 2～5 位：綠道（山海圳）固定 5 位，自行車道每 20 單位多 1 位；騎士依長度比例分到各 segment
  for (const tr of data.trails || []) {
    const segs = tr.segments.filter((s) => s.length >= 2).map((pts) => {
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      return { pts, cum, total: cum[cum.length - 1] };
    }).filter((s) => s.total > 0.5 * S);
    if (!segs.length) continue;
    const units = segs.reduce((a, s) => a + s.total, 0);
    const n = tr.kind === "greenway" ? 5 : Math.min(5, Math.max(2, 2 + Math.floor(units / (20 * S))));
    for (let k = 0; k < n; k++) {
      let pick = ((k + 0.5) / n) * units, seg = segs[0]; // 依長度比例落在哪一段
      for (const s of segs) { if (pick <= s.total) { seg = s; break; } pick -= s.total; }
      const { g, wheels } = makeRider();
      riders.push({ trail: tr.id, seg, g, wheels, s: Math.min(seg.total, pick), dir: k % 2 ? -1 : 1, speed: RIDE.speed * Math.max(1, S / 2) * (0.85 + rnd() * 0.3), spin: 0 });
    }
  }

  // 沿 segment 距離 s 放置騎士，面向前進方向
  function placeAt(r) {
    const { pts, cum } = r.seg;
    let i = 0;
    while (i < cum.length - 2 && r.s > cum[i + 1]) i++;
    const a = pts[i], b = pts[i + 1], len = cum[i + 1] - cum[i] || 1, t = (r.s - cum[i]) / len;
    const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    r.g.position.set(x, groundY(x, z), z);
    r.g.rotation.y = Math.atan2(r.dir * (b[0] - a[0]), r.dir * (b[1] - a[1]));
    for (const w of r.wheels) w.rotation.x = r.spin;
  }

  let shown = true;
  // timeScale：時間播放時把騎士也加速（同 train.js），速度上限同列車避免飛太快
  function update(dt, speedMul = 1, timeScale = 1) {
    if (!shown) return;
    const d = dt * timeScale * Math.min(1.2, speedMul);
    for (const r of riders) {
      const step = r.speed * d;
      r.s += r.dir * step;
      r.spin += step / 0.06; // 輪子滾動：弧度 = 距離 ÷ 半徑
      if (r.s >= r.seg.total) { r.s = r.seg.total; r.dir = -1; } // 到端點折返
      else if (r.s <= 0) { r.s = 0; r.dir = 1; }
      placeAt(r);
    }
  }
  // 06:00–19:00 才騎車；沒有時鐘時退回用夜色判斷
  function setNight(f, minute = null) {
    shown = minute != null ? minute >= RIDE.from && minute < RIDE.to : f < 0.5;
    for (const r of riders) r.g.visible = shown;
  }
  // 除錯用：每位騎士所在步道與位置
  const state = () => riders.map((r) => ({ trail: r.trail, x: +r.g.position.x.toFixed(2), z: +r.g.position.z.toFixed(2), visible: r.g.visible }));
  update(0, 0);
  return { update, setNight, state, pickables, count: riders.length };
}
