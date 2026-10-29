// 火車：沿營運路線的密集折線行駛，只在 stops 指定的停靠點停車，到終點折返。車廂各自沿線擺放，轉彎時會自然彎曲。
import { TOP } from "./world.js";

// onDepart(train)：可選，火車離站開始行駛時呼叫一次（等待計數從 >0 跨到 ≤0）
// opts：style "tra"（台鐵，預設）或 "hsr"（高鐵：白色流線車身、跑在高架橋面）；speed 速度；deckY 固定行駛高度（高架橋）；
//       bounds 地圖範圍，超出就隱藏（高鐵開出台南後消失、折返時再出現）；carGap 車廂間距；pool 照真實班表跑時最多同時畫幾列
// 照真實班表（rail.js，時鐘在「現在」時）：setSchedule([{ no, label, stops: [{ s, arr, dep }] }])，s 是沿第一條路線的距離、時間是當天分鐘數；
//   update 的 minute 決定每列車在哪：在站內（arr～dep）停著，兩站之間依時間內插；第一站前、最後一站後不畫。setSchedule(null) 回到模擬。
export function createTrains(THREE, scene, services, heightAt = () => 0, onDepart = null, opts = {}) {
  const style = opts.style || "tra", SPEED = opts.speed ?? 4.4, CAR_GAP = opts.carGap ?? 0.9, B = opts.bounds;
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.8 });
  const winMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8 });
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const geo = { body: new THREE.BoxGeometry(1, 1, 1), win: new THREE.BoxGeometry(1, 1, 1), wheel: new THREE.CylinderGeometry(0.5, 0.5, 1, 10) };

  // 高鐵車廂：白色長車身、橘色腰帶、深色窗帶，頭尾車是斜削的尖鼻
  const hsrMat = new THREE.MeshStandardMaterial({ color: 0xf7f7f4, roughness: 0.35, metalness: 0.1 });
  const hsrStripe = new THREE.MeshStandardMaterial({ color: 0xe58a3c, roughness: 0.5 });
  const hsrWin = new THREE.MeshBasicMaterial({ color: 0x27303a });
  const noseGeo = new THREE.CylinderGeometry(0.001, 0.13, 0.42, 4, 1).rotateY(Math.PI / 4).rotateX(Math.PI / 2).scale(1, 0.85, 1);
  function makeHsrCar(end) {
    const g = new THREE.Group();
    const mesh = (ge, m, pos, sc, rot) => { const o = new THREE.Mesh(ge, m); o.position.set(...pos); o.scale.set(...sc); if (rot) o.rotation.set(...rot); o.castShadow = true; g.add(o); return o; };
    const len = end ? 0.62 : 0.86, off = end ? -end * 0.12 : 0; // 頭尾車身短一點，前面接尖鼻
    mesh(geo.body, hsrMat, [0, 0.17, off], [0.26, 0.22, len]);
    mesh(geo.body, hsrStripe, [0, 0.1, off], [0.265, 0.035, len]);
    mesh(geo.body, hsrWin, [0, 0.21, off], [0.265, 0.05, len * 0.92]);
    if (end) {
      const n = new THREE.Mesh(noseGeo, hsrMat); n.position.set(0, 0.16, end * 0.4); // 車身前緣在 end*0.19，尖鼻長 0.42 n.rotation.y = end > 0 ? 0 : Math.PI; n.castShadow = true; g.add(n);
      mesh(geo.win, lightMat, [0, 0.12, end * 0.5], [0.08, 0.025, 0.01]); // 車燈
    }
    return g;
  }
  function makeCar(color, end) {
    if (style === "hsr") return makeHsrCar(end);
    const g = new THREE.Group();
    const stripeMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const mesh = (ge, m, pos, sc, rot) => { const o = new THREE.Mesh(ge, m); o.position.set(...pos); o.scale.set(...sc); if (rot) o.rotation.set(...rot); o.castShadow = true; g.add(o); return o; };
    mesh(geo.body, bodyMat, [0, 0.22, 0], [0.3, 0.26, 0.8]); // 車身（沿本地 z）
    mesh(geo.body, stripeMat, [0, 0.12, 0], [0.31, 0.06, 0.8]); // 色帶
    mesh(geo.body, darkMat, [0, 0.36, 0], [0.26, 0.03, 0.76]); // 車頂
    for (const s of [-1, 1]) for (let k = -1; k <= 1; k++) mesh(geo.win, winMat, [s * 0.152, 0.26, k * 0.24], [0.01, 0.1, 0.16]); // 車窗
    for (const z of [-0.26, 0.26]) for (const s of [-1, 1]) mesh(geo.wheel, darkMat, [s * 0.12, 0.06, z], [0.1, 0.04, 0.1], [0, 0, Math.PI / 2]);
    if (end) mesh(geo.win, lightMat, [0, 0.2, end * 0.405], [0.16, 0.06, 0.01]); // 車頭／車尾燈
    return g;
  }

  const trains = [];
  for (const sv of services) {
    const pts = sv.points, cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i - 1].distanceTo(pts[i]));
    const total = cum[cum.length - 1];
    // 停靠點：stops 是 points 的索引；沒給就每個點都停。轉成沿線距離並確保遞增
    const stopIdx = (sv.stops?.length ? sv.stops : pts.map((_, i) => i)).filter((i) => i >= 0 && i < pts.length);
    const stopS = stopIdx.map((i) => cum[i]).sort((a, b) => a - b);
    if (stopS.length < 2) continue;
    const nCars = sv.cars ?? 4, nTrains = sv.trains ?? 1;
    // 多列車平均分布在停靠點上，奇數列往前、偶數列往回，形成對開
    for (let k = 0; k < nTrains; k++) {
      const cars = [];
      for (let i = 0; i < nCars; i++) {
        const car = makeCar(parseInt(sv.color.slice(1), 16), i === 0 ? -1 : i === nCars - 1 ? 1 : 0);
        scene.add(car);
        cars.push(car);
      }
      const stop = opts.startStop ?? Math.round((k / Math.max(1, nTrains - 1)) * (stopS.length - 1)); // 高鐵：全部從指定站出發
      const dir = stop === stopS.length - 1 ? -1 : stop === 0 ? 1 : k % 2 ? -1 : 1;
      trains.push({ service: sv.id, pts, cum, total, stopS, cars, s: stopS[stop], dir, stop, wait: 1 + k, speed: SPEED });
    }
  }

  // ── 照真實班表跑：車廂另外準備一組（pool 列），模擬的列車先藏起來 ──
  let sched = null;
  const pool = [], poolN = opts.pool ?? 8, base = trains[0];
  function ensurePool() {
    if (pool.length || !base) return;
    const sv = services[0], nCars = opts.poolCars ?? base.cars.length;
    for (let k = 0; k < poolN; k++) {
      const cars = [];
      for (let i = 0; i < nCars; i++) { const car = makeCar(parseInt(sv.color.slice(1), 16), i === 0 ? -1 : i === nCars - 1 ? 1 : 0); car.visible = false; scene.add(car); cars.push(car); }
      pool.push({ service: sv.id, pts: base.pts, cum: base.cum, total: base.total, stopS: base.stopS, cars, s: 0, dir: 1, stop: 0, wait: 0, speed: 0, no: null, label: "" });
    }
  }
  function setSchedule(list) {
    sched = list && list.length ? list : null;
    if (sched) ensurePool();
    for (const tr of trains) for (const car of tr.cars) car.visible = !sched;
    if (!sched) for (const tr of pool) { tr.no = null; for (const car of tr.cars) car.visible = false; }
  }
  // 班表上這一刻的位置：沒在路線上回 null
  function schedAt(e, m) {
    const st = e.stops;
    if (m < Math.min(st[0].arr, st[0].dep - 1) || m > st[st.length - 1].arr + 0.5) return null; // 第一站到站（或發車前 1 分鐘）出現、最後一站到站後半分鐘消失
    for (let i = 0; i < st.length; i++) {
      if (m <= st[i].dep) {
        if (i === 0 || m >= st[i].arr) return { s: st[i].s, wait: true };
        const a = st[i - 1], f = Math.min(1, Math.max(0, (m - a.dep) / (st[i].arr - a.dep || 1)));
        return { s: a.s + (st[i].s - a.s) * f, wait: false, dir: Math.sign(st[i].s - a.s) || 1 };
      }
    }
    return { s: st[st.length - 1].s, wait: true };
  }
  function updateSchedule(minute) {
    const m = minute ?? 720, live = [];
    for (const e of sched) {
      const p = schedAt(e, m) ?? schedAt(e, m + 1440); // 跨午夜：前一天晚上發車的班次
      if (p) live.push([e, p]);
    }
    const keep = new Map(pool.filter((tr) => tr.no).map((tr) => [tr.no, tr]));
    const free = pool.filter((tr) => !live.some(([e]) => e.no === tr.no));
    for (const tr of free) tr.no = null;
    for (const [e, p] of live) {
      const tr = keep.get(e.no) ?? free.shift();
      if (!tr) break; // 同時在線上的超過 pool：多的不畫
      if (tr.no !== e.no) { tr.no = e.no; tr.label = e.label ?? e.no; }
      if (!p.wait) tr.dir = p.dir;
      tr.wait = p.wait ? 1 : 0; tr.s = p.s;
      tr.stop = tr.stopS.reduce((bi, s, i) => (Math.abs(s - p.s) < Math.abs(tr.stopS[bi] - p.s) ? i : bi), 0);
    }
    for (const tr of pool) {
      const n = tr.cars.length;
      if (!tr.no) { for (const car of tr.cars) car.visible = false; continue; }
      tr.cars.forEach((car, i) => { placeAt(tr, tr.s + (i - (n - 1) / 2) * CAR_GAP * -tr.dir, car); if (tr.s < 0 || tr.s > tr.total) car.visible = false; else if (!B) car.visible = true; });
    }
  }

  const pos = new THREE.Vector3();
  // 沿折線距離 s 的位置與朝向
  function placeAt(train, s, obj) {
    const { pts, cum } = train;
    const sc = Math.max(0, Math.min(train.total, s));
    let i = 0;
    while (i < cum.length - 2 && sc > cum[i + 1]) i++;
    const a = pts[i], b = pts[i + 1], seg = cum[i + 1] - cum[i] || 1, t = (sc - cum[i]) / seg;
    const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
    pos.set(px, opts.deckY != null ? opts.deckY + 0.04 : TOP + 0.08 + heightAt(px, pz), pz);
    obj.position.copy(pos);
    if (B) obj.visible = px > B.minX - 0.5 && px < B.maxX + 0.5 && pz > B.minZ - 0.5 && pz < B.maxZ + 0.5; // 出了地圖就隱藏
    obj.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  }

  let night = 0, clockMinute = null;
  // 營運時段：有時鐘時 05:00–24:00 發車（台鐵末班車約午夜）；沒有時鐘時退回用夜色判斷
  const closed = () => (clockMinute != null ? clockMinute < 300 : night > 0.85);
  // timeScale：時間播放時把列車的時間也加速，讓一天（播放 16 秒）內能跑完全線所有站
  function update(dt, speedMul = 1, timeScale = 1, minute = null) {
    if (sched) return updateSchedule(minute);
    const d = dt * timeScale;
    for (const tr of trains) {
      if (tr.wait > 0) {
        tr.wait -= d;
        if (closed()) tr.wait = 0.5; // 深夜停在站內不發車
        if (tr.wait <= 0 && onDepart) onDepart(tr); // 離站
      } else {
        tr.s += tr.dir * tr.speed * Math.min(1.2, speedMul) * d;
        const nextStop = tr.stop + tr.dir;
        if (nextStop < 0 || nextStop >= tr.stopS.length) { tr.dir *= -1; tr.wait = 2; continue; }
        const target = tr.stopS[nextStop];
        if ((tr.dir > 0 && tr.s >= target) || (tr.dir < 0 && tr.s <= target)) {
          tr.s = target;
          tr.stop = nextStop;
          tr.wait = 1.8;
          if (tr.stop === 0 || tr.stop === tr.stopS.length - 1) tr.dir *= -1; // 終點折返
        }
      }
      const n = tr.cars.length;
      tr.cars.forEach((car, i) => placeAt(tr, tr.s + (i - (n - 1) / 2) * CAR_GAP, car)); // 每節車廂各自沿線取點
    }
  }
  function setNight(f, minute = null) { night = f; clockMinute = minute; }
  // 除錯用：每列車目前的位置與停靠站（stop 是停靠點序號）
  const state = () => (sched ? pool.filter((tr) => tr.no) : trains).map((tr) => ({ service: tr.service, s: +tr.s.toFixed(2), stop: tr.stop, dir: tr.dir, wait: +tr.wait.toFixed(2), x: +tr.cars[0].position.x.toFixed(2), z: +tr.cars[0].position.z.toFixed(2), visible: tr.cars[0].visible, no: tr.no ?? null, label: tr.label ?? null }));
  update(0, 0);
  // 第 i 條路線各停靠站的沿線距離（rail.js 把班表的車站換成 s 用）
  const stopDistances = (i = 0) => trains.find((tr) => tr.service === services[i]?.id)?.stopS ?? [];
  return { update, setNight, setSchedule, stopDistances, state, get count() { return sched ? pool.filter((tr) => tr.no).length : trains.length; }, get scheduled() { return !!sched; } };
}
