// 夜市與市場的動態：疊在 models.js 的 nightmarket／market 模型上，座標用模型的局部座標（跟 buildModel 一樣先縮放、繞 y 轉、再平移）。
//   夜市（今天有營業、天黑）：燈籠串繞電線擺盪、忽明忽暗；攤位招牌像跑馬燈輪流亮、變色；三攤烤攤冒煙（下雨少一點）；每攤後面有攤販在忙
//   市場（06:00–13:00 開市）：攤販叫賣、轉身；攤位前的帆布遮陽棚隨風擺（weather.wind，下雨擺得大）；門口一台機車、一台推車來回
//   沒營業或收攤時：燈籠與招牌照模型的亮度（公休變暗），攤販與騎士不見，機車、推車停在門口
// createMarkets(THREE, scene, world, islands, { layerScale })
//   layerScale(id) → 0～1：分層建築（拉近才長出來）目前的大小，動態零件跟著一起長出來、縮回去
//   → { update(dt, { night, minute, weather }), count }
const SKIN = 0xf1c9a5, LANTERN = 0xff6b3d, SIGN = 0xfff1a8, DIM = 0x4a4238; // 燈籠、招牌原色與公休變暗的顏色同 models.js／kit.js
const NEON = [0xff4fa3, 0x4fe3ff, 0xfff25f, 0x7dff6b, 0xff8a3d];
const APRON = [0x4a7fc1, 0xdb6a41, 0x3f9a6b, 0xfcea8b, 0x8a5fb0, 0xffffff];
const AWNING = [0xf5d76e, 0x5fb88a, 0xe8826a];
const SCOOTER = [0xd83a2e, 0x4a7fc1, 0xf0e6d2, 0x3f9a6b, 0x211d1d];
const NIGHT_STALLS = [-0.6, -0.2, 0.2, 0.6].flatMap((x) => [[x, -0.3], [x, 0.3]]); // 夜市 8 攤（模型同 models.js 的 nightmarket）
const GRILLS = [0, 5, 6]; // 冒煙的三攤
const DAY_STALLS = [-0.28, 0, 0.28]; // 市場 3 攤，正面朝 +z
const OPEN = 360, CLOSE = 780; // 市場 06:00–13:00

export function createMarkets(THREE, scene, world, islands, { layerScale = () => 1 } = {}) {
  const sites = [];
  for (const p of world.pois) if (p.type === "nightmarket") sites.push({ night: true, poi: p, pos: p.pos, ry: world.rotOf("poi:" + p.id), sc: world.scaleOf("poi:" + p.id) ?? 0.8 });
  for (const isl of islands) for (const b of isl.buildings) {
    const pos = b.model === "market" && world.buildingPos.get(b.id);
    if (pos) sites.push({ night: false, id: b.id, pos, ry: world.rotOf("building:" + b.id), sc: world.scaleOf("building:" + b.id) ?? 0.75 });
  }
  sites.forEach((s, i) => { s.seed = i * 1.7; s.color = SCOOTER[i % SCOOTER.length]; s.qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.ry); });
  const nN = sites.filter((s) => s.night).length, nD = sites.length - nN;

  // 每種零件一個 InstancedMesh；不投影、不能點（不放進 pickables）
  const std = () => new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const white = new THREE.Color(0xffffff);
  const make = (geo, mat, n) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; // 零件散在全圖，包圍球不準
    for (let i = 0; i < m.count; i++) m.setColorAt(i, white); // 一開始就建 instanceColor：之後才建的話材質不會重新編譯
    scene.add(m);
    return m;
  };
  const sphere = new THREE.SphereGeometry(0.5, 10, 8), cube = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const M = {
    lantern: make(sphere, new THREE.MeshBasicMaterial(), nN * 4),
    sign: make(cube, new THREE.MeshBasicMaterial(), nN * 8),
    smoke: make(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xf2ede4, transparent: true, opacity: 0.45, depthWrite: false }), nN * GRILLS.length * 4),
    body: make(cyl, std(), nN * 8 + nD * 5),
    head: make(sphere, std(), nN * 8 + nD * 5),
    box: make(cube, std(), nD * 6),
  };
  const idx = {};
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s3 = new THREE.Vector3(), col = new THREE.Color();
  // 局部座標 → 世界：k 是這個場所目前的縮放（模型比例 × 分層長出來的比例）
  function put(name, site, k, [x, y, z], [w, h, d], rot = null, color = null) {
    const i = idx[name]++, m = M[name], cs = Math.cos(site.ry), sn = Math.sin(site.ry);
    v.set(site.pos.x + (x * cs + z * sn) * k, site.pos.y + y * k, site.pos.z + (-x * sn + z * cs) * k);
    q.copy(site.qy); if (rot) q.multiply(q2.setFromEuler(e.set(rot[0], rot[1], rot[2])));
    s3.set(w * k || 1e-6, h * k || 1e-6, d * k || 1e-6);
    m.setMatrixAt(i, m4.compose(v, q, s3));
    if (color != null) m.setColorAt(i, typeof color === "number" ? col.set(color) : color);
  }
  const hide = (name) => { M[name].setMatrixAt(idx[name]++, m4.makeScale(0, 0, 0)); };
  // 一個小人（身體＋頭）：bob 上下、turn 轉身
  function person(site, k, x, z, apron, bob, turn, on) {
    if (!on) { hide("body"); hide("head"); return; }
    put("body", site, k, [x, 0.12 + bob, z], [0.09, 0.2, 0.09], [0, turn, 0], apron);
    put("head", site, k, [x, 0.27 + bob, z], [0.09, 0.09, 0.09], null, SKIN);
  }
  const tri = (u) => 1 - Math.abs(((u % 2) + 2) % 2 - 1); // 0→1→0 的三角波，週期 2

  let t = 0;
  function update(dt, { night = 0, minute = 720, weather = {} } = {}) {
    t += dt;
    for (const k in M) idx[k] = 0;
    const glow = 0.45 + 0.55 * night; // 同 kit.setNight：白天把發光零件壓暗
    const morning = minute >= OPEN && minute < CLOSE, rain = !!weather.rain;
    const wind = Math.min(1, (weather.wind ?? 8) / 35) + (rain ? 0.3 : 0);
    for (const site of sites) {
      const k = site.sc * (site.id ? layerScale(site.id) : 1), ph = site.seed;
      if (site.night) {
        const open = site.poi.open, on = open && night > 0.4;
        for (let i = 0; i < 4; i++) { // 燈籠：掛在電線（y 0.52）下擺盪，營業時微微閃
          const a = (on ? 0.35 : 0.12) * Math.sin(t * 1.6 + i * 1.3 + ph), fl = on ? 0.82 + 0.18 * Math.sin(t * 7.3 + i * 2.1 + ph) * Math.sin(t * 3.1 + i) : 1;
          put("lantern", site, k, [-0.6 + i * 0.4, 0.52 - Math.cos(a) * 0.07, Math.sin(a) * 0.07], [0.09, 0.11, 0.09], [a, 0, 0], col.set(open ? LANTERN : DIM).multiplyScalar(glow * fl));
        }
        NIGHT_STALLS.forEach(([x, z], i) => { // 招牌：營業時跑馬燈輪流亮、顏色一格一格換
          const lit = !on || (i + Math.floor(t * 4)) % 4 !== 0;
          const c = on ? NEON[(i + Math.floor(t * 1.5)) % NEON.length] : open ? SIGN : DIM;
          put("sign", site, k, [x, 0.28, z + (z < 0 ? 0.16 : -0.16)], [0.24, 0.08, 0.01], null, col.set(c).multiplyScalar(glow * (lit ? 1 : 0.3)));
          const back = z < 0 ? -0.46 : 0.46; // 攤販站在攤位背對走道的一側，面向走道
          person(site, k, x, back, APRON[Math.floor(i + site.seed * 3) % APRON.length], Math.abs(Math.sin(t * 6 + i + ph)) * 0.025, (z < 0 ? 0 : Math.PI) + Math.sin(t * 2 + i * 1.9 + ph) * 0.6, on);
        });
        for (const g of GRILLS) { // 烤攤的煙：一縷四團，往上飄、變大、最後縮小散掉
          const [x, z] = NIGHT_STALLS[g];
          for (let j = 0; j < 4; j++) {
            if (!on || (rain && j % 2)) { hide("smoke"); continue; }
            const u = (t / 2.4 + j / 4 + g * 0.13) % 1, r = 0.05 + u * 0.1;
            put("smoke", site, k, [x + Math.sin(u * 6 + j) * 0.04, 0.4 + u * 0.5, z * 0.8], [r, r * (u > 0.8 ? (1 - u) * 5 : 1), r]);
          }
        }
      } else {
        const on = morning;
        DAY_STALLS.forEach((x, i) => {
          const sway = (on ? 0.05 + wind * 0.2 : wind * 0.08) * Math.sin(t * (1.8 + wind) + i * 1.1 + ph); // 遮陽棚：風越大擺越大
          put("box", site, k, [x, 0.4, 0.5], [0.24, 0.012, 0.18], [0.4 + sway, 0, 0], AWNING[i]); // 伸出大屋頂前緣（z 0.43）才看得到
          person(site, k, x, -0.18, APRON[(i + 2) % APRON.length], Math.abs(Math.sin(t * 5 + i * 2 + ph)) * 0.03, Math.sin(t * 1.7 + i + ph) * 0.7, on); // 叫賣、秤菜
        });
        // 機車：門口沿 x 來回（開市時），收攤停在右邊
        const u = on ? tri(t * 0.22 + ph) : 1, dir = on && ((t * 0.22 + ph) % 2) < 1 ? 1 : -1;
        const mx = -0.5 + u * 1.0, ry = dir > 0 ? 0 : Math.PI;
        put("box", site, k, [mx, 0.07, 0.62], [0.2, 0.08, 0.07], [0, ry, 0], site.color);
        put("box", site, k, [mx + 0.09 * (on ? dir : 1), 0.14, 0.62], [0.02, 0.1, 0.06], [0, ry, 0], 0x211d1d);
        person(site, k, mx - 0.02 * dir, 0.62, site.color, 0.04, ry + Math.PI / 2, on);
        // 推車：從門口往外推再推回來
        const w = on ? tri(t * 0.12 + ph * 0.5) : 0, cz = 0.5 + w * 0.32;
        put("box", site, k, [-0.42, 0.1, cz], [0.14, 0.08, 0.18], null, 0x8a939e);
        person(site, k, -0.42, cz - 0.15, APRON[1], 0, 0, on);
      }
    }
    for (const m of Object.values(M)) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
  update(0); // 先畫一次，初始化顏色
  return { update, count: sites.length };
}
