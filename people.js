// Q 版行人，數百人同時在場：每種身體零件只用一個 InstancedMesh，每幀只更新矩陣。
// 動線行人（有頭頂標記與名牌）在兩座島之間來回；漫步者隨機挑目的地走。
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { TOP, mulberry } from "./world.js";

const STYLE = {
  student: { shirt: 0x4a7fc1, pants: 0x2f3a4a, hair: 0x241c1a, hat: 0xf1c232 },
  commuter: { shirt: 0xf4efe6, pants: 0x3a3f4a, hair: 0x3a2a22 },
  nurse: { shirt: 0xffffff, pants: 0x7fb3c8, hair: 0x4a3328 },
  researcher: { shirt: 0xfbfbf7, pants: 0x5a5f6a, hair: 0x241c1a, glasses: true },
  artist: { shirt: 0x7a6fb5, pants: 0x2f3a4a, hair: 0xa65a3a, hat: 0x211d1d },
  elder: { shirt: 0x9db39a, pants: 0x6a6258, hair: 0xd9d4cc, cane: true },
  family: { shirt: 0xdb6a41, pants: 0x3a3f4a, hair: 0x241c1a },
  child: { shirt: 0xff6b6b, pants: 0x3b5bdb, hair: 0x241c1a, child: true }, // 小孩：整體縮小、鮮豔上衣、不戴帽
};
const ROLES = Object.keys(STYLE).filter((r) => r !== "child"); // 沒有年齡資料時的隨機角色（維持原本的七種）
const ADULT_ROLES = ROLES.filter((r) => r !== "elder"); // 有年齡資料時，長者與小孩的比例由資料決定，其餘從這裡抽
const AGE_OF = (role) => (role === "elder" ? "elder" : role === "child" ? "child" : "adult");
const CHILD_SCALE = 0.7;
const BASE_SCALE = 0.75; // 整體行人縮小：原本人比公車高兩倍、跟房子一樣高
const SHIRTS = [0x4a7fc1, 0xf4efe6, 0xdb6a41, 0x7a6fb5, 0x9db39a, 0xe8c547, 0x3e7c8c, 0xffffff, 0xc58b6a];
const KID_SHIRTS = [0xff6b6b, 0xffd43b, 0x51cf66, 0x339af0, 0xff922b, 0xcc5de8];
const UMBRELLAS = [0xe03131, 0x1c7ed6, 0xfab005, 0x2f9e44, 0x7048e8, 0x212529, 0xf783ac];
const UMBRELLA_RATE = 0.6; // 下雨時約六成的人撐傘
const PIVOT = { legL: [-0.045, 0.17, 0], legR: [0.045, 0.17, 0], armL: [-0.115, 0.33, 0], armR: [0.115, 0.33, 0] };
const SKIN = 0xf3d2b8;

export function createPeople(THREE, scene, D, world, CSS2DObject) {
  const population = D.settings?.population ?? 500;
  const perFlow = D.settings?.flowWalkersPerFlow ?? 6;
  const WALK = Math.max(1, (D.city?.scale ?? 1) / 2); // 地圖放大 S 倍時行人只快 S/2 倍（步伐一起加快），再快就像在溜冰
  const rnd = mulberry(42);
  const islandIds = D.islands.map((i) => i.id);
  // 依人口比例挑區（跨區旅程的目的地）：永康、安南的人會比龍崎多很多
  const popOf = new Map((D.city?.districts || []).map((d) => [d.id, d.population || 10]));
  const popTotal = islandIds.reduce((a, id) => a + (popOf.get(id) || 1), 0);
  const pickDistrict = () => { let r = rnd() * popTotal; for (const id of islandIds) { r -= popOf.get(id) || 1; if (r <= 0) return id; } return islandIds[islandIds.length - 1]; };
  // 漫步者的居住區用固定配額：每區保底 MIN_PER_DISTRICT 人，其餘照人口線性分配，最大餘數法補到剛好 total 人
  const MIN_PER_DISTRICT = 3;
  function homeQuota(total) {
    const base = Math.min(MIN_PER_DISTRICT, Math.floor(total / islandIds.length));
    const rest = total - base * islandIds.length;
    const raw = islandIds.map((id) => ({ id, exact: (rest * (popOf.get(id) || 1)) / popTotal }));
    const quota = new Map(raw.map((r) => [r.id, base + Math.floor(r.exact)]));
    let short = total - [...quota.values()].reduce((a, b) => a + b, 0);
    for (const r of raw.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))) { if (short <= 0) break; quota.set(r.id, quota.get(r.id) + 1); short--; }
    const list = [];
    for (const [id, n] of quota) for (let i = 0; i < n; i++) list.push(id);
    return list;
  }
  let namesOn = false, night = 0, morning = false; // morning：06:00–13:00 市場開市，散步的人會往市場走
  const roles = D.roles?.roles || {};
  const surnames = D.roles?.surnames || ["陳"], given = D.roles?.given || ["小安"];
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  // 各區年齡結構（data/ages.json，由 app.js 以 ages 鍵放進 D）：old／young 是 65 歲以上與 0～14 歲的百分比
  const ages = D.ages?.byDistrict || null;
  // 住區決定後抽角色：先照該區 old％ 抽長者、young％ 抽小孩，其餘從成人角色隨機；沒有資料就退回原本的隨機角色
  function roleFor(districtId) {
    const a = ages?.[districtId];
    if (!a) return pick(ROLES);
    const r = rnd() * 100;
    return r < a.old ? "elder" : r < a.old + a.young ? "child" : pick(ADULT_ROLES);
  }

  const geo = {
    leg: new RoundedBoxGeometry(1, 1, 1, 2, 0.3),
    shoe: new THREE.BoxGeometry(1, 1, 1),
    body: new THREE.CapsuleGeometry(0.5, 0.6, 3, 8),
    arm: new RoundedBoxGeometry(1, 1, 1, 2, 0.35),
    hand: new THREE.SphereGeometry(0.5, 6, 5),
    head: new THREE.SphereGeometry(0.5, 12, 9),
    cap: new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    eye: new THREE.BoxGeometry(1, 1, 1),
    hat: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
    glasses: new THREE.BoxGeometry(1, 1, 1),
    cane: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
    badge: new THREE.BoxGeometry(1, 1, 1),
    umbrella: new THREE.ConeGeometry(0.5, 1, 8), // 傘面：縮成半徑 0.16、高 0.07，柄用 cane 的圓柱
    basket: new THREE.CylinderGeometry(0.5, 0.38, 1, 8), // 菜籃：提在左手，裡面裝所在區的特產（顏色見 data/spec_seasons.json）
    produce: new THREE.SphereGeometry(0.5, 8, 6),
  };

  // ── 第一階段：列出每個人的零件（還不建立 mesh）──
  const walkers = [], counts = {};
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
  function partSpec(kind, pos, scale, color, pivot = null, rot = null) {
    const local = new THREE.Matrix4().compose(
      v.set(...pos),
      rot ? q.setFromEuler(e.set(...rot)) : q.identity(),
      sc.set(...scale),
    );
    counts[kind] = (counts[kind] || 0) + 1;
    return { kind, idx: counts[kind] - 1, local, color, pivot };
  }

  function makeWalker(role, flow) {
    const base = STYLE[role] || STYLE.commuter;
    const st = flow ? base : { ...base, shirt: pick(base.child ? KID_SHIRTS : SHIRTS) }; // 小孩的上衣從鮮豔色挑
    const parts = [];
    const P = (...a) => parts.push(partSpec(...a));
    for (const L of ["legL", "legR"]) {
      P("leg", [0, -0.085, 0], [0.07, 0.17, 0.075], st.pants, L);
      P("shoe", [0, -0.165, 0.015], [0.075, 0.03, 0.11], 0x2a2524, L);
    }
    P("body", [0, 0.27, 0], [0.19, 0.14, 0.16], st.shirt);
    for (const A of ["armL", "armR"]) {
      P("arm", [0, -0.07, 0], [0.05, 0.14, 0.055], st.shirt, A);
      P("hand", [0, -0.15, 0], [0.05, 0.05, 0.05], SKIN, A);
    }
    P("head", [0, 0.47, 0], [0.26, 0.24, 0.24], SKIN);
    P("cap", [0, 0.49, -0.01], [0.28, 0.2, 0.27], st.hair, null, [-0.35, 0, 0]);
    P("eye", [-0.045, 0.47, 0.12], [0.03, 0.04, 0.02], 0x211d1d);
    P("eye", [0.045, 0.47, 0.12], [0.03, 0.04, 0.02], 0x211d1d);
    if (st.hat) {
      P("hat", [0, 0.57, 0], [0.32, 0.03, 0.32], st.hat);
      P("hat", [0, 0.62, 0], [0.2, 0.1, 0.2], st.hat);
    }
    if (st.glasses) P("glasses", [0, 0.475, 0.125], [0.2, 0.03, 0.01], 0x211d1d);
    if (st.cane) P("cane", [0.02, -0.18, 0.06], [0.02, 0.3, 0.02], 0x8a6a4a, "armR");
    if (flow) P("badge", [0, 0, 0], [0.09, 0.09, 0.09], flow.carry, null, [Math.PI / 4, 0, Math.PI / 4]);
    // 雨具：約六成的人有傘，掛在右臂上方（不跟手臂擺動，比較穩）；不下雨時矩陣縮成 0 藏起來
    if (rnd() < UMBRELLA_RATE) {
      const c = pick(UMBRELLAS), n0 = parts.length;
      P("umbrella", [0.115, 0.74, 0], [0.32, 0.07, 0.32], c);
      P("cane", [0.115, 0.45, 0], [0.012, 0.58, 0.012], 0x3b3b3b);
      for (let i = n0; i < parts.length; i++) parts[i].rain = true;
    }

    const w = {
      index: walkers.length, role, age: AGE_OF(role), flow, parts, name: pick(surnames) + pick(given), home: flow ? flow.from : null,
      scale: BASE_SCALE * (st.child ? CHILD_SCALE : 1), // 小孩整體縮小，由根矩陣統一處理，零件尺寸與關節位置不用另外算
      pos: new THREE.Vector3(), yaw: 0, phase: rnd() * 6, speed: WALK * (st.child ? 0.85 : 1) * (0.82 + rnd() * 0.55), /* 1 倍地圖的速度（原 0.45+0.3，當時地圖為更早的 1.82 倍）× WALK */
      lateral: (rnd() - 0.5) * (flow ? 0.24 : 0.36), s: 0, dir: 1, wait: rnd() * 3,
      path: null, at: null, visible: true, zeroed: false, label: null,
    };
    walkers.push(w);
    return w;
  }

  // ── 路線 ──
  function buildPath(a, b, insetA, insetB) {
    const pts = world.route(a, b);
    const inset = (p, toward, d) => p.clone().lerp(toward, d / p.distanceTo(toward));
    if (pts.length > 1) {
      pts[0] = inset(pts[0], pts[1], insetA);
      pts[pts.length - 1] = inset(pts[pts.length - 1], pts[pts.length - 2], insetB);
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i - 1].distanceTo(pts[i]));
    return { pts, cum, total: cum[cum.length - 1], to: b };
  }
  const finish = (pts, to) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i - 1].distanceTo(pts[i]));
    return { pts, cum, total: cum[cum.length - 1], to };
  };
  // 漫步者的下一趟：一半機率在自己島的廣場散步，一半機率經由島心走去別座島
  function newTrip(w) {
    const here = w.pos.clone();
    const center = world.centers.get(w.at).clone();
    center.y = world.groundY(center.x, center.z);
    if (w.started && rnd() < 0.65) {
      // 區內散步：在空地隨機挑一點（有車站的區有三成五機率往車站走），直線走得通就直走，否則先回區中心
      const sts = world.stationsIn(w.at);
      const pois = world.poisIn(w.at);
      const markets = pois.filter((p) => p.type === "nightmarket" && p.open);
      const sights = pois.filter((p) => p.type !== "nightmarket");
      const shops = morning ? world.marketsIn(w.at) : [];
      const evs = world.eventsIn(w.at);
      const pickDest = () => {
        const r = rnd();
        if (evs.length && r < 0.4) return world.randomPointNear(w.at, evs[Math.floor(rnd() * evs.length)].pos, rnd);
        if (shops.length && r < 0.5) return world.randomPointNear(w.at, shops[Math.floor(rnd() * shops.length)].pos, rnd);
        if (night > 0.4 && markets.length && r < 0.55) return world.randomPointNear(w.at, markets[Math.floor(rnd() * markets.length)].pos, rnd);
        if (night <= 0.4 && sights.length && r < 0.35) return world.randomPointNear(w.at, sights[Math.floor(rnd() * sights.length)].pos, rnd);
        if (sts.length && r < 0.6) return world.randomPointNear(w.at, sts[Math.floor(rnd() * sts.length)].pos, rnd);
        return world.randomPoint(w.at, rnd);
      };
      // 多挑幾個目的地，找直線走得通的（不穿過建築、田、魚塭）；都不行才先回區中心再過去
      let dest = pickDest(), direct = world.segmentClear(w.at, here, dest);
      for (let k = 0; k < 4 && !direct; k++) { dest = pickDest(); direct = world.segmentClear(w.at, here, dest); }
      for (let k = 0; k < 6 && !direct; k++) { dest = world.randomPointNear(w.at, here, rnd); direct = world.segmentClear(w.at, here, dest); } // 遠的都走不通：在附近散步
      w.path = finish(direct ? [here, dest] : [here, center, dest], w.at);
    } else {
      let to = rnd() < 0.5 ? w.home : pickDistrict(); // 一半的跨區旅程是回家
      if (to === w.at) to = world.adjacency.get(w.at)?.[0] || islandIds[(islandIds.indexOf(to) + 1) % islandIds.length];
      const pts = world.route(w.at, to);
      const last = pts.length - 1;
      pts[last] = pts[last].clone().lerp(pts[last - 1], (0.3 + rnd() * 0.9) / pts[last].distanceTo(pts[last - 1]));
      if (w.started) pts.unshift(here);
      else pts[0] = pts[0].clone().lerp(pts[1], (0.3 + rnd() * 0.9) / pts[0].distanceTo(pts[1]));
      w.path = finish(pts, to);
    }
    w.started = true;
    w.s = 0;
    w.dir = 1;
  }

  // 動線行人
  for (const f of D.flows) {
    for (let k = 0; k < perFlow; k++) {
      const w = makeWalker(f.walker, f);
      w.path = buildPath(f.from, f.to, 0.7, 0.7);
      w.s = rnd() * w.path.total;
      w.dir = rnd() > 0.5 ? 1 : -1;
      place(w);
      const el = document.createElement("div");
      el.className = "walker-label";
      el.textContent = roles[f.walker]?.label || f.walker;
      w.label = new CSS2DObject(el);
      w.label.visible = false;
      scene.add(w.label);
    }
  }
  // 漫步者
  const homes = homeQuota(Math.max(0, population - walkers.length));
  while (walkers.length < population) {
    const at = homes.pop() ?? pickDistrict();
    const w = makeWalker(roleFor(at), null); // 先定住區，再依該區年齡結構抽角色
    w.at = w.home = at;
    if (rnd() < 0.7) {
      // 一開始就散在區內的空地，而不是全部排在跨區路線上
      w.pos.copy(world.randomPoint(w.at, rnd));
      w.started = true;
      newTrip(w);
      w.wait = rnd() * 6;
      place(w);
    } else {
      newTrip(w);
      w.s = rnd() * w.path.total;
      place(w);
    }
  }

  // 提菜籃：有農特產的區，約四分之一的成人與長者左手提一籃住區的特產（另用一組亂數，不影響其他人的落點）
  const specBy = D.specialties?.byDistrict || {}, seasonBy = D.specSeasons?.byName || {}, rndB = mulberry(77);
  for (const w of walkers) {
    const items = !w.flow && w.age !== "child" ? specBy[w.home] || [] : [];
    if (!items.length || rndB() >= 0.25) continue;
    const it = items[Math.floor(rndB() * items.length)], key = it.name_zh ?? it.name;
    w.carry = { name: it.name, icon: it.icon, key, district: w.home };
    w.parts.push(partSpec("basket", [0, -0.2, 0.02], [0.11, 0.07, 0.11], 0x9c6b3a, "armL"));
    w.parts.push(partSpec("produce", [0, -0.155, 0.02], [0.085, 0.05, 0.085], seasonBy[key]?.color || "#c9a27a", "armL"));
  }

  // ── 第二階段：依種類建立 InstancedMesh，填入顏色 ──
  const material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const meshes = {}, col = new THREE.Color();
  const ownerOf = {}; // 每種零件的 instanceId → 行人，點到身上任何一塊都算
  for (const [kind, n] of Object.entries(counts)) {
    const m = new THREE.InstancedMesh(geo[kind], material, n);
    m.frustumCulled = false; // 實例會移動，不要用建立時的包圍球做剔除
    m.castShadow = kind === "body" || kind === "head" || kind === "leg";
    m.receiveShadow = false;
    m.userData = { type: "walkerMesh", kind };
    scene.add(m);
    meshes[kind] = m;
  }
  for (const w of walkers) {
    for (const p of w.parts) {
      meshes[p.kind].setColorAt(p.idx, col.set(p.color));
      (ownerOf[p.kind] ||= [])[p.idx] = w;
    }
  }
  for (const m of Object.values(meshes)) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  {
    const n = { elder: 0, child: 0, adult: 0 };
    for (const w of walkers) n[w.age]++;
    console.log(`[hex-city] walkers by age: ${n.elder} elder, ${n.child} child, ${n.adult} adult (ages ${ages ? D.ages.asOf : "n/a"}), ${counts.umbrella || 0} umbrellas, ${counts.basket || 0} baskets`);
  }

  // ── 每幀更新 ──
  const rootM = new THREE.Matrix4(), M = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  let raining = false;
  const pivM = Object.fromEntries(Object.keys(PIVOT).map((k) => [k, new THREE.Matrix4()]));
  const pivV = Object.fromEntries(Object.entries(PIVOT).map(([k, p]) => [k, new THREE.Vector3(...p)]));

  function place(w) {
    const { pts, cum } = w.path;
    let i = 0;
    while (i < cum.length - 2 && w.s > cum[i + 1]) i++;
    const a = pts[i], b = pts[i + 1];
    const segLen = cum[i + 1] - cum[i] || 1;
    const t = (w.s - cum[i]) / segLen;
    const dx = (b.x - a.x) / segLen, dz = (b.z - a.z) / segLen;
    const px = a.x + (b.x - a.x) * t + dz * w.lateral, pz = a.z + (b.z - a.z) * t - dx * w.lateral;
    w.pos.set(px, world.groundY(px, pz), pz);
    w.yaw = Math.atan2(dx * w.dir, dz * w.dir);
  }

  function step(w, dt, speedMul) {
    if (w.wait > 0) { w.wait -= dt; return 0; }
    w.s += w.dir * w.speed * speedMul * dt;
    if (w.flow) {
      if (w.s >= w.path.total) { w.s = w.path.total; w.dir = -1; w.wait = 1.5; }
      else if (w.s <= 0) { w.s = 0; w.dir = 1; w.wait = 1.5; }
    } else if (w.s >= w.path.total) {
      w.at = w.path.to;
      w.wait = 2 + rnd() * 4;
      newTrip(w);
      place(w);
      return 0;
    }
    place(w);
    w.phase += dt * 9 * WALK * speedMul;
    return Math.sin(w.phase);
  }


  function update(dt, speedMul = 1, now = 0) {
    for (const w of walkers) {
      if (!w.visible) {
        if (!w.zeroed) { for (const p of w.parts) meshes[p.kind].setMatrixAt(p.idx, ZERO); w.zeroed = true; }
        if (w.label) w.label.visible = false;
        continue;
      }
      w.zeroed = false;
      const sw = step(w, dt, speedMul);
      // 走進市區（建築縮小過的區）就跟著縮：每半秒查一次所在的區，比例慢慢過渡，跨區時不會突然變大變小
      if ((w.zoneT = (w.zoneT ?? 0) - dt) <= 0) { w.zoneT = 0.5 + Math.random() * 0.2; w.zoneGoal = world.zoneScale(world.districtAt(w.pos.x, w.pos.z)); }
      w.zone = (w.zone ?? w.zoneGoal) + (w.zoneGoal - (w.zone ?? w.zoneGoal)) * Math.min(1, dt * 2);
      // 跨區的路線會橫越高速公路：走到公路上時先藏起來，當作從地下道過去（每 0.15 秒查一次）
      if ((w.roadT = (w.roadT ?? 0) - dt) <= 0) { w.roadT = 0.15; w.under = !!world.onRoad?.(w.pos.x, w.pos.z); }
      const s = w.under ? 0 : w.scale * w.zone;
      const bob = w.wait > 0 ? 0 : Math.abs(Math.cos(w.phase)) * 0.012;
      rootM.makeRotationY(w.yaw);
      rootM.scale(sc.set(s, s, s)); // 小孩、市區：整個人連關節一起縮
      rootM.setPosition(w.pos.x, w.pos.y + bob * s, w.pos.z);
      pivM.legL.makeRotationX(sw * 0.7).setPosition(pivV.legL);
      pivM.legR.makeRotationX(-sw * 0.7).setPosition(pivV.legR);
      pivM.armL.makeRotationX(-sw * 0.5).setPosition(pivV.armL);
      pivM.armR.makeRotationX(sw * 0.5).setPosition(pivV.armR);
      for (const p of w.parts) {
        if (p.rain && !raining) { meshes[p.kind].setMatrixAt(p.idx, ZERO); continue; } // 沒下雨就收傘
        if (p.kind === "badge") {
          M.makeRotationY(now * 2 + w.index).multiply(p.local).setPosition(0, 0.78 + Math.sin(now * 3 + w.index) * 0.02, 0).premultiply(rootM);
        } else if (p.pivot) {
          M.multiplyMatrices(pivM[p.pivot], p.local).premultiply(rootM);
        } else {
          M.multiplyMatrices(rootM, p.local);
        }
        meshes[p.kind].setMatrixAt(p.idx, M);
      }
      if (w.label) {
        w.label.visible = namesOn;
        w.label.position.set(w.pos.x, w.pos.y + 0.98 * s + 0.1, w.pos.z);
      }
    }
    for (const m of Object.values(meshes)) m.instanceMatrix.needsUpdate = true;
  }

  function refreshVisibility() {
    for (const w of walkers) w.visible = !(night > 0.6 && w.index % 3 !== 0); // 深夜只剩三分之一
  }
  function setNames(on) { namesOn = on; }
  function setNight(f, minute) { night = f; if (minute != null) morning = minute >= 360 && minute < 780; refreshVisibility(); }
  function setRain(on) { raining = !!on; } // 下雨時帶傘的人把傘撐開

  // 點選：從 InstancedMesh 的 instanceId 找回是哪個人
  function walkerAt(mesh, instanceId) {
    const w = ownerOf[mesh.userData.kind]?.[instanceId];
    return w ? { type: "walker", id: w.index, flow: w.flow?.id ?? null, role: w.role } : null;
  }
  // 某區此刻有多少行人（以目前所在區計）
  function countIn(districtId) { let n = 0; for (const w of walkers) if (w.visible && w.at === districtId) n++; return n; }
  // 查詢某個人此刻的狀態，給卡片與路線顯示用
  function info(id) {
    const w = walkers[id];
    if (!w) return null;
    const dest = w.flow ? (w.dir > 0 ? w.flow.to : w.flow.from) : w.path.to;
    const status = w.wait > 0 ? "rest" : w.flow ? "flow" : w.path.to === w.at ? "stroll" : "travel";
    return { id, name: w.name, role: w.role, age: w.age, home: w.home, at: w.at ?? dest, dest, status, flow: w.flow?.id ?? null, carry: w.carry || null, pos: w.pos.clone(), path: w.path.pts.map((p) => p.clone()) };
  }
  // 某區此刻的行人年齡層人數（與 countIn 同樣以目前所在區、可見者計，三者相加等於 countIn）
  function ageStats(districtId) {
    const n = { elder: 0, child: 0, adult: 0 };
    for (const w of walkers) if (w.visible && w.at === districtId) n[w.age]++;
    return n;
  }

  update(0, 0, 0);
  // 熱度圖用：對每個目前看得見的行人呼叫 fn(x, z)
  function forEachVisible(fn) { for (const w of walkers) if (w.visible) fn(w.pos.x, w.pos.z); }
  return { update, setNames, setNight, setRain, walkerAt, info, countIn, ageStats, forEachVisible, pickables: Object.values(meshes), count: walkers.length, instances: Object.values(counts).reduce((a, b) => a + b, 0) };
}
