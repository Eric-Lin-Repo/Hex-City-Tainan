// 火車：沿營運路線的密集折線行駛，只在 stops 指定的停靠點停車，到終點折返。車廂各自沿線擺放，轉彎時會自然彎曲。
import { TOP } from "./world.js";

// onDepart(train)：可選，火車離站開始行駛時呼叫一次（等待計數從 >0 跨到 ≤0）
// opts：style "tra"（台鐵，預設）或 "hsr"（高鐵：白色流線車身、跑在高架橋面）；speed 速度；deckY 固定行駛高度（高架橋）；
//       bounds 地圖範圍，超出就隱藏（高鐵開出台南後消失、折返時再出現）；carGap 車廂間距
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
  function update(dt, speedMul = 1, timeScale = 1) {
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
  const state = () => trains.map((tr) => ({ service: tr.service, s: +tr.s.toFixed(2), stop: tr.stop, dir: tr.dir, wait: +tr.wait.toFixed(2), x: +tr.cars[0].position.x.toFixed(2), z: +tr.cars[0].position.z.toFixed(2), visible: tr.cars[0].visible }));
  update(0, 0);
  return { update, setNight, state, count: trains.length };
}
