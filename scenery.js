// 山海景觀：依 data/scenery.json 在地圖上加真實存在的地方特色，每一樣都可點、有卡片與出處。
//   山區：山谷雲海（清晨、看濕度與前一天雨量）、月世界惡地溝紋（地形顏色在 terrain.js）、關子嶺溫泉煙、大凍山與竹子尖山的山頂與登山客、
//        星空（跟著相機的天球，東邊山區最亮）、芒果／龍眼／咖啡／梅子果園（依月份結果、開花）
//   沿海：魚塭與打氣水車、七股潟湖蚵棚與膠筏、四草綠色隧道竹筏
//   農村：關廟曬麵（晴天白天）、官田菱角田（產季有採菱船）、柳營八翁乳牛
// createScenery(THREE, scene, world, data, { projection, anchorPos, fields, fieldsApi, lakes, rivers, districts, quality })
//   fieldsApi：fields.js 的 { list(cropId, districtId), stageIndex(cropId) }，收割機、蓮花依田地當天的產季階段出現
//   districts：[{ id, name, hub: [x, z], polygon }]（找區中心、判斷魚塭落在哪一區、在區內散放農家）
//   loadBusBranches：載入 data/bus_branches.json（小貨車沿公車支線的山路跑，產季到了才載入）
//   → { update(dt, ctx), pickables, info(id), items, anchoredTo(type, id), center(id), setQuality(q) }
//   ctx：{ minute, night, month, dateKey, weather: { rain, cloud, temp, humidity, rainYesterday, ok }, live, camera }
import { TOP, mulberry } from "./world.js";

export function createScenery(THREE, scene, world, data, { projection, anchorPos = () => null, fields = [], fieldsApi = null, tracks = [], lakes = [], rivers = [], districts = [], loadBusBranches = null, quality = "high", scale: MS = 1 } = {}) {
  // MS：地圖放大倍數。找空地的半徑、分佈範圍、交通工具速度跟著乘；模型大小、彼此的間隔不變。走路的人只快 MS/2 倍
  const districtByName = new Map(districts.map((d) => [d.name, d])), nameOfDistrict = new Map(districts.map((d) => [d.id, d.name]));
  const P = projection, WALK = Math.max(1, MS / 2);
  const toWorld = (lat, lon) => ({ x: (lon - P.lon_c) * P.km_x * P.k, z: -(lat - P.lat_c) * P.km_z * P.k });
  const gy = (x, z) => world.groundY(x, z);
  const rnd = mulberry(2027);
  const root = new THREE.Group(); scene.add(root);
  const pickables = [], items = new Map(), updaters = [];
  const std = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...extra });
  const basic = (c, extra = {}) => new THREE.MeshBasicMaterial({ color: c, ...extra });
  const G = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 8), sphere: new THREE.SphereGeometry(0.5, 10, 8), cone: new THREE.ConeGeometry(0.5, 1, 8) };
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), e3 = new THREE.Euler();
  const mesh = (g, mat, pos, sc, parent, rot) => { const o = new THREE.Mesh(G[g], mat); o.position.set(...pos); o.scale.set(...sc); if (rot) o.rotation.set(...rot); o.castShadow = true; (parent || root).add(o); return o; };
  // 一次放很多個同樣零件：list = [[x, y, z, sx, sy, sz, ry, rx?]]
  function instanced(g, mat, list, { shadow = true } = {}) {
    const im = new THREE.InstancedMesh(G[g], mat, Math.max(1, list.length));
    list.forEach(([x, y, z, sx, sy, sz, ry = 0, rx = 0], i) => im.setMatrixAt(i, m4.compose(v3.set(x, y, z), q4.setFromEuler(e3.set(rx, ry, 0)), s3.set(sx, sy, sz))));
    im.count = list.length; im.instanceMatrix.needsUpdate = true; im.castShadow = shadow; im.receiveShadow = true;
    root.add(im);
    return im;
  }
  // 靜態小物件很多時（例如 18 戶農家），先在不加進場景的 Group 裡組好，再依「幾何＋顏色」合併成 InstancedMesh，
  // 一種零件只要一次繪圖呼叫，畫面完全一樣
  const baked = new Map(); // key → { geo, mat, list: [Matrix4] }
  function bake(group) {
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.geometry.uuid + "|" + o.material.color.getHexString();
      if (!baked.has(key)) baked.set(key, { geo: o.geometry, mat: o.material, list: [] });
      baked.get(key).list.push(o.matrixWorld.clone());
    });
  }
  function flushBaked() {
    for (const { geo, mat, list } of baked.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true; im.castShadow = im.receiveShadow = true;
      root.add(im);
    }
    baked.clear();
  }
  // 點擊範圍：看不見的方塊
  function hitbox(id, x, z, w = 1.4, h = 0.8) {
    const hb = new THREE.Mesh(G.box, basic(0xffffff));
    hb.position.set(x, gy(x, z) + h / 2, z); hb.scale.set(w, h, w); hb.visible = false;
    hb.userData = { type: "scenery", id };
    scene.add(hb); pickables.push(hb);
    return hb;
  }
  // 河道（折線）附近不放東西
  const segsOf = (lines) => lines.filter((pts) => pts?.length > 1).map((pts) => { const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]); return { pts, box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)] }; });
  const riverSegs = segsOf(rivers.map((r) => r.points)), trackSegs = segsOf(tracks); // 河道、鐵路與高鐵（高架橋下面也不放東西）
  const nearRiver = (x, z, m = 0.18) => nearLine(riverSegs, x, z, m);
  function nearLine(segs, x, z, m) {
    for (const { pts, box: [x0, x1, z0, z1] } of segs) {
      if (x < x0 - m || x > x1 + m || z < z0 - m || z > z1 + m) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
        const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
        if (Math.hypot(ax + dx * t - x, az + dz * t - z) < m) return true;
      }
    }
    return false;
  }
  // 空地：陸地、不在湖或河上、不壓到農田、離建築／景點／車站至少 margin
  const taken = []; // 景觀彼此的佔位 [x, z, r]：竹林不要長在惡地小丘上、焙灶不要蓋在果樹上……
  const take = (x, z, r) => taken.push([x, z, r]);
  const free = (x, z, margin = 0.4) => world.onLand(x, z) && !world.inLake(x, z) && !nearRiver(x, z) && !nearLine(trackSegs, x, z, 0.35) && !fieldHit(x, z, 0.05) && world.isClear(x, z, margin) && !taken.some(([tx, tz, r]) => Math.hypot(x - tx, z - tz) < r);
  // 離 (x, z) 最近的空地
  function spot(x, z, margin = 0.5, radius = 3 * MS) {
    if (free(x, z, margin)) return { x, z };
    for (let r = 0.15; r <= radius; r += 0.15) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + r, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (free(px, pz, margin)) return { x: px, z: pz };
    }
    return null;
  }
  const onLandAt = (x, z) => { if (world.onLand(x, z)) return { x, z }; for (let r = 0.2; r <= 4 * MS; r += 0.2) for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (world.onLand(px, pz)) return { x: px, z: pz }; } return { x, z }; };
  const fieldHit = (x, z, m = 0.25) => fields.some(([fx, fz, w, d, ry]) => { const c = Math.cos(ry), s = Math.sin(ry), dx = x - fx, dz = z - fz; return Math.abs(dx * c - dz * s) < w / 2 + m && Math.abs(dx * s + dz * c) < d / 2 + m; });
  const inMonths = (list, m) => !!list && list.includes(m);
  // 柔邊圓點貼圖：雲、蒸氣用
  const puffTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.55, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const puff = (opacity = 0.6, color = 0xffffff) => new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color, transparent: true, opacity, depthWrite: false }));

  const state = {}; // id → 給卡片用的即時狀態（今天有沒有雲海、是不是產季……）
  const hash01 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

  // ── 山谷雲海 ──
  function clouds(it) {
    const puffs = [];
    for (const [lat, lon] of it.spots) {
      const c = onLandAt(toWorld(lat, lon).x, toWorld(lat, lon).z), base = gy(c.x, c.z);
      for (let k = 0; k < 11 * MS; k++) { // 山谷跟著地圖放大，雲海涵蓋的範圍與團數一起放大
        const a = rnd() * Math.PI * 2, r = (0.3 + rnd() * 1.3) * MS, sp = puff(0);
        const s = 1.1 + rnd() * 1.3; sp.scale.set(s * 1.6, s * 0.55, 1);
        const p = { sp, cx: c.x, cz: c.z, a, r, y: base + 0.18 + rnd() * 0.3, w: (rnd() - 0.5) * 0.05 };
        sp.position.set(c.x + Math.cos(a) * r, p.y, c.z + Math.sin(a) * r);
        root.add(sp); puffs.push(p);
      }
      hitbox(it.id, c.x, c.z, 1.8, 1.2);
    }
    let level = 0, t = 0;
    updaters.push((dt, ctx) => {
      // 今天有沒有雲海：時鐘在現在用真實濕度與昨天雨量；其他日期依月份換算固定機率（同一天每次看都一樣）
      const best = inMonths(it.months, ctx.month);
      let chance;
      if (ctx.live && ctx.weather?.ok && ctx.weather.humidity != null) {
        chance = ctx.weather.humidity >= 90 ? 0.85 : ctx.weather.humidity >= 80 ? 0.55 : 0.2;
        if ((ctx.weather.rainYesterday ?? 0) >= 5) chance += 0.35;
        if (!best) chance *= 0.6;
      } else chance = hash01("clouds|" + ctx.dateKey) < (best ? 0.55 : [4, 5, 10].includes(ctx.month) ? 0.3 : 0.12) ? 0.8 : 0;
      const [h0, h1] = it.hours, m = ctx.minute;
      const time = m < h0 - 30 || m > h1 + 45 ? 0 : m < h0 ? (m - (h0 - 30)) / 30 : m > h1 ? 1 - (m - h1) / 45 : 1;
      const today = chance >= 0.5;
      state[it.id] = { today, chance: Math.min(1, chance), live: !!(ctx.live && ctx.weather?.ok) };
      const target = today ? time * Math.min(1, chance) : 0;
      level += (target - level) * Math.min(1, dt * 0.8);
      t += dt;
      for (const p of puffs) {
        p.sp.visible = level > 0.02;
        if (!p.sp.visible) continue;
        p.a += p.w * dt;
        p.sp.position.set(p.cx + Math.cos(p.a) * p.r, p.y + Math.sin(t * 0.3 + p.a) * 0.03, p.cz + Math.sin(p.a) * p.r);
        p.sp.material.opacity = 0.62 * level;
        p.sp.material.color.setScalar(1 - 0.55 * ctx.night); // 精靈不受光照：天色暗時把雲調暗，免得發亮
      }
    });
  }

  // ── 月世界惡地：地面顏色在 terrain.js；這裡加一群群青灰色、稜角分明的泥岩小丘（六角錐，像被雨刷出溝紋的山脊）──
  function badlands(it) {
    const hills = [], ridges = [];
    const cone6 = new THREE.ConeGeometry(0.5, 1, 6);
    for (const [lat, lon] of it.spots) {
      const c = toWorld(lat, lon);
      for (let k = 0; k < 40 * MS * MS; k++) { // 惡地範圍 ×MS（地面變色見 badlandPatches），小丘密度不變
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 1.2 * MS, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        if (!free(x, z, 0.4)) continue;
        if (hills.some((h) => Math.hypot(h[0] - x, h[2] - z) < 0.16)) continue;
        const hgt = 0.1 + rnd() * 0.2, w = hgt * (1.0 + rnd() * 0.6), y = gy(x, z);
        if (fieldHit(x, z, w * 0.6 + 0.05)) continue; // 小丘底面半徑約 0.55w（加上旁邊的小丘）：整座都不能壓到田
        hills.push([x, y + hgt / 2 - 0.01, z, w, hgt, w * (0.7 + rnd() * 0.4), rnd() * Math.PI]); take(x, z, w * 0.6);
        if (rnd() < 0.5) ridges.push([x + 0.05, y + hgt * 0.32, z - 0.03, w * 0.6, hgt * 0.65, w * 0.5, rnd() * Math.PI]); // 旁邊再疊一座小的，看起來連成山脊
      }
    }
    const mat = std(0x9aa3a1, { flatShading: true });
    for (const list of [hills, ridges]) {
      const im = new THREE.InstancedMesh(cone6, mat, Math.max(1, list.length));
      list.forEach(([x, y, z, sx, sy, sz, ry], i) => im.setMatrixAt(i, m4.compose(v3.set(x, y, z), q4.setFromAxisAngle(up, ry), s3.set(sx, sy, sz))));
      im.count = list.length; im.castShadow = im.receiveShadow = true; root.add(im);
    }
    const c0 = toWorld(...it.spots[0]), c = spot(c0.x, c0.z, 0.4) ?? c0;
    hitbox(it.id, c.x, c.z, 1.6, 0.6);
  }

  // ── 關子嶺溫泉煙：湯屋上方一團團白煙往上飄，冷天與夜裡更濃 ──
  function steam(it) {
    const puffs = [];
    const a0 = anchorPos(it.anchor);
    const spots = it.spots.map(([lat, lon]) => toWorld(lat, lon));
    if (a0) spots.unshift({ x: a0.x + 0.25, z: a0.z + 0.15 });
    for (const c of spots.slice(0, 3)) {
      for (let k = 0; k < 7; k++) { const sp = puff(0); root.add(sp); puffs.push({ sp, x: c.x + (rnd() - 0.5) * 0.3, z: c.z + (rnd() - 0.5) * 0.3, base: gy(c.x, c.z) + 0.15, h: rnd() * 0.9 }); }
    }
    hitbox(it.id, spots[0].x, spots[0].z, 1.0, 1.0);
    updaters.push((dt, ctx) => {
      const cold = ctx.weather?.temp != null ? Math.max(0, Math.min(1, (24 - ctx.weather.temp) / 10)) : 0.3;
      const k = 0.18 + cold * 0.3 + ctx.night * 0.15;
      state[it.id] = { strength: k };
      for (const p of puffs) {
        p.h += dt * 0.22; if (p.h > 1) p.h -= 1;
        p.sp.position.set(p.x + Math.sin(p.h * 6 + p.x) * 0.05, p.base + p.h * 0.9, p.z);
        const s = 0.18 + p.h * 0.45; p.sp.scale.set(s, s, 1);
        p.sp.material.opacity = k * (1 - p.h) * 1.2;
        p.sp.material.color.setScalar(1 - 0.6 * ctx.night);
      }
    });
  }

  // ── 山頂：石堆、旗桿、山名牌；步道上有登山客來回 ──
  function hikerModel(color) {
    const g = new THREE.Group();
    mesh("cyl", std(0x34495e), [0, 0.06, 0], [0.05, 0.12, 0.05], g); // 腿
    mesh("cyl", std(color), [0, 0.16, 0], [0.07, 0.1, 0.06], g); // 上衣
    mesh("box", std(0x8e5b2a), [0, 0.17, -0.045], [0.06, 0.08, 0.04], g); // 背包
    mesh("sphere", std(0xf3d2b8), [0, 0.245, 0], [0.06, 0.06, 0.06], g); // 頭
    mesh("cyl", std(0xe8e2c8), [0, 0.28, 0], [0.075, 0.015, 0.075], g); // 帽
    mesh("cyl", std(0x6b4a2a), [0.05, 0.12, 0.02], [0.008, 0.22, 0.008], g, [0.2, 0, 0]); // 登山杖
    g.scale.setScalar(0.85);
    root.add(g);
    return g;
  }
  function peak(it) {
    const c0 = toWorld(...it.spots[0]), c = spot(c0.x, c0.z, 0.35, 4 * MS) ?? onLandAt(c0.x, c0.z), y = gy(c.x, c.z);
    const g = new THREE.Group(); g.position.set(c.x, y, c.z); root.add(g);
    for (const [x, z, s] of [[0, 0, 0.16], [0.08, 0.05, 0.12], [-0.07, 0.04, 0.11], [0.02, -0.07, 0.1]]) mesh("sphere", std(0x8d8a82), [x, s * 0.35, z], [s, s * 0.7, s], g); // 石堆
    mesh("cyl", std(0xdedede), [0, 0.35, 0], [0.015, 0.6, 0.015], g); // 旗桿
    mesh("box", basic(0xd8342c), [0.07, 0.58, 0], [0.13, 0.08, 0.005], g); // 旗
    mesh("box", std(0x6b4a2a), [0.18, 0.12, 0.12], [0.02, 0.24, 0.02], g);
    mesh("box", std(0xf3ead2), [0.18, 0.24, 0.12], [0.2, 0.1, 0.015], g); // 山名牌
    hitbox(it.id, c.x, c.z, 0.9, 1.0);
    // 步道：起點 → 山頂，3 位登山客來回，06:00–17:00
    const pts = it.trail.map(([lat, lon]) => onLandAt(toWorld(lat, lon).x, toWorld(lat, lon).z));
    pts[pts.length - 1] = c;
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const total = cum.at(-1) || 1;
    const dots = []; for (let i = 0; i < pts.length - 1; i++) { const n = Math.max(1, Math.round((cum[i + 1] - cum[i]) / 0.18)); for (let k = 0; k < n; k++) { const t = k / n, x = pts[i].x + (pts[i + 1].x - pts[i].x) * t, z = pts[i].z + (pts[i + 1].z - pts[i].z) * t; dots.push([x, gy(x, z) + 0.01, z, 0.05, 0.01, 0.05]); } }
    instanced("box", std(0xc9b48a), dots, { shadow: false }); // 步道碎石點
    const hikers = [0x2e9e4f, 0xd8342c, 0x1f6fd1].map((col, k) => ({ g: hikerModel(col), s: total * (0.15 + k * 0.3), dir: k % 2 ? -1 : 1, v: (0.12 + k * 0.02) * WALK }));
    const at = (s) => { let i = 0; while (i < cum.length - 2 && s > cum[i + 1]) i++; const t = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1); return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, z: pts[i].z + (pts[i + 1].z - pts[i].z) * t, ry: Math.atan2(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z) }; };
    updaters.push((dt, ctx) => {
      const on = ctx.minute >= 360 && ctx.minute <= 1020 && !ctx.weather?.rain;
      for (const h of hikers) {
        h.g.visible = on;
        if (!on) continue;
        h.s += h.dir * h.v * dt * (ctx.speedMul ?? 1);
        if (h.s > total) { h.s = total; h.dir = -1; } else if (h.s < 0) { h.s = 0; h.dir = 1; }
        const p = at(h.s); h.g.position.set(p.x, gy(p.x, p.z), p.z); h.g.rotation.y = p.ry + (h.dir < 0 ? Math.PI : 0);
      }
    });
  }

  // ── 星空：跟著相機的天球（不受霧影響），入夜才看得見；東邊（山區）星星多、西邊（市區、光害）少 ──
  let starPts = null;
  function stars(it) {
    const N = quality === "low" ? 500 : quality === "med" ? 900 : 1500;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    let n = 0;
    for (let i = 0; i < N * 4 && n < N; i++) {
      const u = rnd(), v = rnd(), th = u * Math.PI * 2, ph = Math.acos(1 - v * 0.95); // 上半球，接近地平線較少
      const x = Math.sin(ph) * Math.cos(th), y = Math.cos(ph), z = Math.sin(ph) * Math.sin(th);
      const east = Math.max(0, Math.min(1, 0.5 + x * 0.6 + y * 0.3)); // 東邊與天頂多、西邊地平線少
      if (rnd() > 0.25 + east * 0.75) continue;
      pos.set([x * 300, y * 300, z * 300], n * 3);
      const b = 0.55 + rnd() * 0.45; col.set([b, b, b * (0.9 + rnd() * 0.1)], n * 3); n++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos.subarray(0, n * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(col.subarray(0, n * 3), 3));
    starPts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    starPts.frustumCulled = false; starPts.renderOrder = -1;
    scene.add(starPts);
    const a = anchorPos(it.anchor) ?? toWorld(...it.spots[0]);
    updaters.push((dt, ctx) => {
      if (!ctx.camera) return;
      starPts.position.copy(ctx.camera.position);
      const tg = ctx.target, mountain = tg ? Math.max(0, Math.min(1, (tg.x - 8 * MS) / (14 * MS))) : 0.3; // 鏡頭看向東邊山區時更亮
      const clear = 1 - Math.min(1, (ctx.weather?.cloud ?? 0) * 1.1);
      const o = Math.max(0, ctx.night - 0.35) / 0.65 * clear * (0.45 + 0.55 * mountain);
      starPts.material.opacity = o;
      starPts.visible = o > 0.02;
      state[it.id] = { visible: o > 0.05 };
    });
    hitbox(it.id, a.x + 0.6, a.z + 0.4, 0.8, 0.6);
  }

  // ── 果園：一片果樹（樹幹、樹冠），產季結果、梅花季開白花 ──
  function orchard(it) {
    const per = Math.round(((it.count ?? 30) * MS) / it.spots.length), trunks = [], crowns = [], fruits = [], flowers = [];
    const k = it.small ? 0.6 : 1;
    let first = null;
    for (const [lat, lon] of it.spots) {
      const c0 = toWorld(lat, lon), c = spot(c0.x, c0.z, 0.45, 3 * MS) ?? c0;
      first ??= c;
      const span = Math.round(9 * Math.sqrt(MS)); // 果樹 ×MS 棵，果園邊長 ×√MS：成行成列的密度不變
      let placed = 0;
      for (let tries = 0; tries < per * 12 && placed < per; tries++) {
        const gx = Math.round((rnd() - 0.5) * span) * 0.2, gz = Math.round((rnd() - 0.5) * span) * 0.2; // 0.2 格子：果園成行成列
        const x = c.x + gx, z = c.z + gz;
        if (!free(x, z, 0.4) || fieldHit(x, z)) continue;
        if (trunks.some((t) => Math.hypot(t[0] - x, t[2] - z) < 0.17)) continue;
        const y = gy(x, z), s = (0.8 + rnd() * 0.3) * k;
        trunks.push([x, y + 0.05 * s, z, 0.025 * s, 0.1 * s, 0.025 * s]); take(x, z, 0.12);
        crowns.push([x, y + 0.15 * s, z, 0.16 * s, 0.12 * s, 0.16 * s]);
        for (let f = 0; f < 4; f++) { const a = (f / 4) * Math.PI * 2 + rnd(); const p = [x + Math.cos(a) * 0.065 * s, y + (0.13 + rnd() * 0.05) * s, z + Math.sin(a) * 0.065 * s, 0.028 * s, 0.028 * s, 0.028 * s]; fruits.push(p); flowers.push([p[0], p[1] + 0.02 * s, p[2], 0.035 * s, 0.025 * s, 0.035 * s]); }
        placed++;
      }
      hitbox(it.id, c.x, c.z, 1.6, 0.5);
    }
    instanced("cyl", std(0x6b4a2a), trunks);
    instanced("sphere", std(new THREE.Color(it.leaf)), crowns);
    const fr = instanced("sphere", std(new THREE.Color(it.fruit)), fruits, { shadow: false });
    const fl = it.flower ? instanced("sphere", std(new THREE.Color(it.flower), { emissive: 0x333333 }), flowers, { shadow: false }) : null;
    updaters.push((dt, ctx) => {
      fr.visible = inMonths(it.fruitMonths, ctx.month);
      if (fl) fl.visible = inMonths(it.flowerMonths, ctx.month);
      state[it.id] = { fruit: fr.visible, flower: !!fl?.visible };
    });
  }

  // ── 魚塭：一格格水池＋土堤，每池一台轉動的打氣水車；格數依各區養殖面積 ──
  function fishponds(it) {
    const maxHa = Math.max(...it.areas.map((a) => a.ha));
    const waters = [], dikes = [], wheels = [], floats = [];
    for (const area of it.areas) {
      let c;
      if (area.at) c = toWorld(...area.at);
      else { const d = districtByName.get(area.district); c = d ? { x: d.hub[0] - 1.2 * MS, z: d.hub[1] } : null; } // 沒有代表點：區中心往西（沿海）一點
      if (!c) continue;
      const n = Math.round(Math.max(4, Math.round((area.ha / maxHa) * 26)) * MS); // 池數 ×MS（養殖區跟著地圖放大）
      let placed = 0, first = null;
      for (let ring = 0; ring < 9 * Math.sqrt(MS) && placed < n; ring++) for (let i = -ring; i <= ring && placed < n; i++) for (let j = -ring; j <= ring && placed < n; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const x = c.x + i * 0.5, z = c.z + j * 0.38; // 池子約 0.44 × 0.32，土堤寬 0.06
        const corners = [[x - 0.24, z - 0.18], [x + 0.24, z - 0.18], [x - 0.24, z + 0.18], [x + 0.24, z + 0.18], [x, z]];
        if (!corners.every(([px, pz]) => free(px, pz, 0.3))) continue;
        if (nameOfDistrict.get(world.districtAt(x, z)) !== area.district) continue; // 不跨到別區
        const y = gy(x, z);
        dikes.push([x, y + 0.012, z, 0.5, 0.024, 0.38]);
        waters.push([x, y + 0.026, z, 0.44, 0.004, 0.32]);
        const wx = x + (rnd() - 0.5) * 0.2, wz = z + (rnd() - 0.5) * 0.12, ry = rnd() * Math.PI;
        floats.push([wx, y + 0.033, wz, 0.07, 0.015, 0.03, ry]);
        wheels.push({ x: wx, y: y + 0.05, z: wz, ry, a: rnd() * 6 });
        world.addObstacle(world.districtAt(x, z), x, z, 0.3); // 行人散步的目的地與直線路徑避開魚塭
        first ??= { x, z };
        placed++;
      }
      if (first) hitbox(it.id, first.x, first.z, 1.6, 0.4);
      state[it.id + ":" + area.district] = placed;
    }
    instanced("box", std(0x9c8a6a), dikes, { shadow: false });
    instanced("box", std(0x4f8a86, { roughness: 0.35 }), waters, { shadow: false });
    instanced("box", std(0xf1c232), floats, { shadow: false });
    const paddle = new THREE.InstancedMesh(G.box, std(0x2b2f36), Math.max(1, wheels.length * 2));
    paddle.count = wheels.length * 2; root.add(paddle);
    updaters.push((dt, ctx) => {
      const spin = ctx.minute >= 1080 || ctx.minute < 360 ? 1 : 0.6; // 夜裡水車開得多（魚塭缺氧時段）
      wheels.forEach((w, i) => {
        w.a += dt * 4 * spin;
        for (const k of [0, 1]) {
          const ang = w.a + k * Math.PI / 2;
          paddle.setMatrixAt(i * 2 + k, m4.compose(v3.set(w.x, w.y, w.z), q4.setFromEuler(e3.set(ang, w.ry, 0, "YXZ")), s3.set(0.012, 0.07, 0.012)));
        }
      });
      paddle.instanceMatrix.needsUpdate = true;
    });
  }

  // ── 七股潟湖：一排排蚵棚（竹竿＋橫繩）＋兩艘膠筏在碼頭與沙洲間來回 ──
  const lakePoly = (name) => lakes.find((l) => l.name === name)?.polygon ?? null;
  const inPoly = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  function boatModel(canopy = 0x2e86c1) {
    const g = new THREE.Group();
    mesh("box", std(0x8b6a43), [0, 0.02, 0], [0.12, 0.03, 0.34], g); // 筏身
    for (const z of [-0.08, 0.04]) mesh("box", std(0xf3ead2), [0, 0.06, z], [0.1, 0.05, 0.04], g); // 座位
    for (const [x, z] of [[-0.05, -0.12], [0.05, -0.12], [-0.05, 0.1], [0.05, 0.1]]) mesh("cyl", std(0xdedede), [x, 0.11, z], [0.006, 0.16, 0.006], g);
    mesh("box", std(canopy), [0, 0.19, -0.01], [0.13, 0.012, 0.26], g); // 遮陽篷
    root.add(g);
    return g;
  }
  function pathMover(pts, boats, hours, speed = 0.18) {
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const total = cum.at(-1) || 1;
    const list = boats.map((g, k) => ({ g, s: total * (k / boats.length), dir: k % 2 ? -1 : 1 }));
    return (dt, ctx, y) => {
      const on = ctx.minute >= hours[0] && ctx.minute <= hours[1];
      for (const b of list) {
        b.g.visible = on;
        if (!on) continue;
        b.s += b.dir * speed * dt * (ctx.speedMul ?? 1);
        if (b.s > total) { b.s = total; b.dir = -1; } else if (b.s < 0) { b.s = 0; b.dir = 1; }
        let i = 0; while (i < cum.length - 2 && b.s > cum[i + 1]) i++;
        const t = (b.s - cum[i]) / ((cum[i + 1] - cum[i]) || 1), x = pts[i].x + (pts[i + 1].x - pts[i].x) * t, z = pts[i].z + (pts[i + 1].z - pts[i].z) * t;
        b.g.position.set(x, y(x, z), z);
        b.g.rotation.y = Math.atan2(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z) + (b.dir < 0 ? Math.PI : 0);
      }
    };
  }
  function lagoon(it) {
    const poly = lakePoly("七股潟湖");
    const waterY = () => TOP + 0.03;
    const c = toWorld(...it.racks), posts = [], ropes = [];
    // 蚵棚範圍跟著地圖放大（約 2.2·MS 見方）；排距、樁距各 ×√2，密度是 1 倍地圖時的一半，近看才不會像一整片柵欄
    const ROW = 0.31, POST = 0.28, RN = Math.round((1.1 * MS) / ROW), PN = Math.round((2.0 * MS) / POST);
    if (poly) for (let row = -RN; row <= RN; row++) {
      const z = c.z + row * ROW, x0 = c.x - 1.0 * MS;
      let run = [];
      for (let k = 0; k <= PN; k++) { const x = x0 + k * POST + (row % 2) * POST / 2; if (inPoly(poly, x, z)) run.push(x); }
      if (run.length < 3) continue;
      for (const x of run) posts.push([x, waterY() + 0.05, z, 0.012, 0.16, 0.012]);
      ropes.push([(run[0] + run.at(-1)) / 2, waterY() + 0.11, z, run.at(-1) - run[0], 0.006, 0.006]);
    }
    instanced("cyl", std(0xc8b27a), posts, { shadow: false });
    instanced("box", std(0x3b3b3b), ropes, { shadow: false });
    const pts = it.route.map(([lat, lon]) => toWorld(lat, lon));
    const move = pathMover(pts, [boatModel(0x2e86c1), boatModel(0xd35400)], it.hours, 0.22 * MS);
    updaters.push((dt, ctx) => move(dt, ctx, waterY));
    hitbox(it.id, c.x, c.z, 1.8, 0.4);
  }

  // ── 四草綠色隧道：窄水道兩側的紅樹林，樹冠在水道上方交會；竹筏來回 ──
  function tunnel(it) {
    const raw = it.route.map(([lat, lon]) => toWorld(lat, lon));
    const a0 = anchorPos(it.anchor) ?? raw[0];
    // 直接畫在景點的位置（景點本身不畫模型，見 poi_source.json 的 model "none"），以景點為中心。
    // 整組放大 S 倍（水道基準長 0.7）：方向先試真實水道的走向，碰到建築、河、湖或區界外就換方向；都放不下就縮小再試
    const real = Math.atan2(raw.at(-1).z - raw[0].z, raw.at(-1).x - raw[0].x);
    const ok = (p) => world.onLand(p.x, p.z) && !world.inLake(p.x, p.z) && !nearRiver(p.x, p.z, 0.12) && !world.nearBuilding(p.x, p.z, 0.4);
    let pts = null, S = 1;
    for (const s of [2, 1.75, 1.5, 1.25, 1]) {
      const L = 0.7 * s, W = 0.16 * s; // 水道長、兩側樹冠的外緣
      for (let k = 0; k < 12 && !pts; k++) {
        const a = real + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6), nx = -Math.sin(a), nz = Math.cos(a);
        const along = [-0.5, -0.25, 0, 0.25, 0.5].map((f) => ({ x: a0.x + Math.cos(a) * L * f, z: a0.z + Math.sin(a) * L * f }));
        if (along.every((p) => ok(p) && ok({ x: p.x + nx * W, z: p.z + nz * W }) && ok({ x: p.x - nx * W, z: p.z - nz * W }))) { pts = [along[0], along[2], along[4]]; S = s; }
      }
      if (pts) break;
    }
    if (!pts) pts = [-0.5, 0, 0.5].map((f) => ({ x: a0.x + 0.7 * f, z: a0.z }));
    console.info(`[scenery] ${it.id}：綠色隧道放大 ${S} 倍${pts.length && S < 2 ? "（2 倍放不下，自動縮小）" : ""}`);
    const water = [], trunks = [], crowns = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z), ry = Math.atan2(b.x - a.x, b.z - a.z);
      water.push([(a.x + b.x) / 2, gy((a.x + b.x) / 2, (a.z + b.z) / 2) + 0.012, (a.z + b.z) / 2, 0.14 * S, 0.006, len + 0.08 * S, ry]);
      const nx = Math.cos(ry), nz = -Math.sin(ry); // 水道的垂直方向
      for (let t = 0; t <= len; t += 0.08 * S) for (const side of [-1, 1]) {
        const x = a.x + (b.x - a.x) * (t / len) + nx * side * 0.1 * S, z = a.z + (b.z - a.z) * (t / len) + nz * side * 0.1 * S, y = gy(x, z);
        trunks.push([x, y + 0.06 * S, z, 0.012 * S, 0.12 * S, 0.012 * S, 0, side * 0.35]);
        crowns.push([x - nx * side * 0.05 * S, y + 0.15 * S, z - nz * side * 0.05 * S, 0.12 * S, 0.06 * S, 0.1 * S, ry]);
      }
    }
    instanced("box", std(0x3f6f6a, { roughness: 0.3 }), water, { shadow: false });
    instanced("cyl", std(0x5a4632), trunks, { shadow: false });
    instanced("sphere", std(0x2f6b3a), crowns);
    const raft = boatModel(0xe8d5a3); raft.scale.setScalar(0.8 * S);
    const move = pathMover(pts, [raft], it.hours, 0.05 * S); // 速度跟著放大，跑一趟的時間不變
    updaters.push((dt, ctx) => move(dt, ctx, (x, z) => gy(x, z) + 0.01));
    hitbox(it.id, pts[1].x, pts[1].z, 0.9 * S, 0.5 * S);
  }

  // ── 關廟曬麵：麵架（竹竿）掛著一排排白色麵條，晴天白天才曬 ──
  function noodles(it) {
    const racks = [];
    for (const [lat, lon] of it.spots) {
      const c0 = toWorld(lat, lon), c = spot(c0.x, c0.z, 0.45, 2 * MS) ?? c0;
      const g = new THREE.Group(); g.position.set(c.x, gy(c.x, c.z), c.z); g.rotation.y = rnd() * Math.PI; g.scale.setScalar(1.6); root.add(g);
      for (let r = 0; r < 3; r++) {
        const z = (r - 1) * 0.12;
        for (const x of [-0.2, 0.2]) mesh("cyl", std(0x9c7b4a), [x, 0.09, z], [0.01, 0.18, 0.01], g);
        mesh("cyl", std(0x9c7b4a), [0, 0.18, z], [0.008, 0.42, 0.008], g, [0, 0, Math.PI / 2]);
        const strands = new THREE.Group(); g.add(strands);
        mesh("box", basic(0xfdf6e3), [0, 0.11, z], [0.38, 0.13, 0.006], strands); // 一整片垂下的白麵
        for (let k = 0; k < 8; k++) mesh("box", basic(0xe9dfc4), [-0.16 + k * 0.046, 0.11, z + 0.004], [0.004, 0.13, 0.002], strands); // 麵條之間的縫
        racks.push(strands);
      }
      hitbox(it.id, c.x, c.z, 0.8, 0.5);
    }
    updaters.push((dt, ctx) => {
      const on = !ctx.weather?.rain && ctx.minute >= it.hours[0] && ctx.minute <= it.hours[1];
      for (const r of racks) r.visible = on;
      state[it.id] = { drying: on };
    });
  }

  // ── 官田菱角田：深綠水田上浮著菱角葉；產季有人坐在菱角船（圓桶）裡採收 ──
  function caltrop(it) {
    const waters = [], leaves = [], tubs = [];
    for (const [lat, lon] of it.spots) {
      const c0 = toWorld(lat, lon), c = spot(c0.x, c0.z, 0.45, 2.5 * MS) ?? c0;
      for (const [dx, dz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) {
        const x = c.x + dx, z = c.z + dz;
        if (!free(x, z, 0.3) || fieldHit(x, z, 0.1)) continue;
        const y = gy(x, z);
        waters.push([x, y + 0.012, z, 0.52, 0.02, 0.36]);
        for (let k = 0; k < 18; k++) leaves.push([x + (rnd() - 0.5) * 0.46, y + 0.025, z + (rnd() - 0.5) * 0.3, 0.05, 0.004, 0.05, rnd() * 3]);
        tubs.push({ x, z, y, a: rnd() * 6 });
      }
      hitbox(it.id, c.x, c.z, 1.2, 0.4);
    }
    instanced("box", std(0x4a6a52, { roughness: 0.35 }), waters, { shadow: false });
    const lf = instanced("cyl", std(0x2f7a3a), leaves, { shadow: false });
    // 水雉：細長尾羽、長腳，在菱角浮葉上慢慢走（繁殖季、田裡有葉子時）
    const jac = tubs.flatMap((t) => [0, 1].map((k) => { const g = new THREE.Group(); mesh("sphere", std(0x5a3d2a), [0, 0.05, 0], [0.04, 0.03, 0.06], g); mesh("sphere", std(0xf5f2e8), [0, 0.075, 0.03], [0.022, 0.03, 0.022], g); mesh("sphere", std(0x2b2b2b), [0, 0.095, 0.04], [0.02, 0.02, 0.02], g); mesh("box", std(0x3a2a20), [0, 0.04, -0.075], [0.012, 0.006, 0.09], g, [-0.3, 0, 0]); /* 長尾羽往後下垂 */ for (const x of [-0.008, 0.008]) mesh("cyl", std(0x6f7f6a), [x, 0.02, 0], [0.004, 0.04, 0.004], g); root.add(g); return { g, cx: t.x + (k ? 0.12 : -0.12), cz: t.z, y: t.y, a: rnd() * 6, k }; }));
    const boats = tubs.map((t) => { const g = new THREE.Group(); mesh("cyl", std(0x8b5a2b), [0, 0.03, 0], [0.11, 0.05, 0.11], g); mesh("cyl", std(0x2e86c1), [0, 0.09, 0], [0.045, 0.08, 0.04], g); mesh("sphere", std(0xf3d2b8), [0, 0.15, 0], [0.045, 0.045, 0.045], g); mesh("cone", std(0xe8d5a3), [0, 0.19, 0], [0.09, 0.04, 0.09], g); root.add(g); return { g, ...t }; });
    updaters.push((dt, ctx) => {
      lf.visible = inMonths(it.growMonths, ctx.month);
      const harvest = inMonths(it.harvestMonths, ctx.month) && ctx.minute >= 360 && ctx.minute <= 1050;
      for (const b of boats) { b.g.visible = harvest; if (!harvest) continue; b.a += dt * 0.15; b.g.position.set(b.x + Math.cos(b.a) * 0.15, b.y + 0.01, b.z + Math.sin(b.a * 1.3) * 0.08); }
      const jacanas = lf.visible && inMonths(it.jacanaMonths, ctx.month);
      for (const j of jac) { j.g.visible = jacanas; if (!jacanas) continue; j.a += dt * 0.12 * (ctx.speedMul ?? 1); const x = j.cx + Math.cos(j.a) * 0.08, z = j.cz + Math.sin(j.a * 0.7) * 0.06; j.g.position.set(x, j.y + 0.02, z); j.g.rotation.y = j.a + Math.PI / 2; }
      state[it.id] = { growing: lf.visible, harvest, jacanas };
    });
  }

  // ── 八翁酪農區：圍欄、小牛舍，幾頭乳牛在裡面慢慢走、低頭吃草 ──
  function cowModel() {
    const g = new THREE.Group(), white = std(0xf7f5ef), black = std(0x22201f);
    mesh("box", white, [0, 0.11, 0], [0.09, 0.08, 0.18], g); // 身體
    mesh("box", black, [0.046, 0.12, 0.02], [0.002, 0.05, 0.07], g); mesh("box", black, [-0.046, 0.1, -0.04], [0.002, 0.04, 0.06], g); // 黑斑
    const head = new THREE.Group(); head.position.set(0, 0.13, 0.1); g.add(head);
    mesh("box", white, [0, 0, 0.03], [0.06, 0.06, 0.07], head); mesh("box", std(0xe7b9a8), [0, -0.015, 0.07], [0.05, 0.03, 0.02], head);
    for (const [x, z] of [[-0.03, 0.06], [0.03, 0.06], [-0.03, -0.06], [0.03, -0.06]]) mesh("box", white, [x, 0.035, z], [0.02, 0.07, 0.02], g);
    root.add(g);
    return { g, head };
  }
  function dairy(it) {
    const a = anchorPos(it.anchor), c0 = toWorld(...it.spots[0]);
    const W = 0.9, D = 0.7;
    const sx = a ? a.x + 0.6 : c0.x, sz = a ? a.z + 0.5 : c0.z; // 整塊圍欄（中心與四角）都要在空地上，找離地標最近的
    let c = null;
    for (let r = 0; r <= 2.5 * MS && !c; r += 0.15) for (let k = 0; k < (r ? 16 : 1) && !c; k++) {
      const x = sx + Math.cos((k / 16) * Math.PI * 2) * r, z = sz + Math.sin((k / 16) * Math.PI * 2) * r;
      if ([[0, 0], [-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2], [0, -D / 2], [0, D / 2], [-W / 2, 0], [W / 2, 0]].every(([dx, dz]) => free(x + dx, z + dz, 0.5))) c = { x, z }; // 建築模型半寬約 0.4，留 0.5
    }
    c ??= spot(sx, sz, 0.45, 2.5 * MS) ?? c0;
    take(c.x, c.z, 0.6);
    const y = gy(c.x, c.z), posts = [], rails = [];
    for (let k = 0; k <= 9; k++) { const t = k / 9; posts.push([c.x - W / 2 + W * t, y + 0.04, c.z - D / 2, 0.012, 0.08, 0.012], [c.x - W / 2 + W * t, y + 0.04, c.z + D / 2, 0.012, 0.08, 0.012]); }
    for (let k = 0; k <= 7; k++) { const t = k / 7; posts.push([c.x - W / 2, y + 0.04, c.z - D / 2 + D * t, 0.012, 0.08, 0.012], [c.x + W / 2, y + 0.04, c.z - D / 2 + D * t, 0.012, 0.08, 0.012]); }
    rails.push([c.x, y + 0.07, c.z - D / 2, W, 0.008, 0.008], [c.x, y + 0.07, c.z + D / 2, W, 0.008, 0.008], [c.x - W / 2, y + 0.07, c.z, 0.008, 0.008, D], [c.x + W / 2, y + 0.07, c.z, 0.008, 0.008, D]);
    instanced("box", std(0xf3ead2), posts, { shadow: false });
    instanced("box", std(0xf3ead2), rails, { shadow: false });
    instanced("box", std(0x9bbf6a), [[c.x, y + 0.004, c.z, W, 0.006, D]], { shadow: false }); // 牧草地
    const barn = new THREE.Group(); barn.position.set(c.x + W / 2 - 0.15, y, c.z - D / 2 + 0.12); root.add(barn);
    mesh("box", std(0xb03a2e), [0, 0.08, 0], [0.24, 0.16, 0.18], barn); mesh("box", std(0xf3ead2), [0, 0.2, 0], [0.27, 0.06, 0.21], barn);
    const cows = Array.from({ length: 6 }, () => { const m = cowModel(); return { ...m, x: c.x + (rnd() - 0.5) * W * 0.7, z: c.z + (rnd() - 0.5) * D * 0.7, tx: c.x + (rnd() - 0.5) * W * 0.8, tz: c.z + (rnd() - 0.5) * D * 0.8, wait: rnd() * 3, graze: rnd() * 6 }; }); // 一開始就各走各的，不會全擠到中間
    updaters.push((dt, ctx) => {
      for (const cw of cows) {
        if (cw.wait > 0) cw.wait -= dt;
        else {
          const dx = cw.tx - cw.x, dz = cw.tz - cw.z, d = Math.hypot(dx, dz);
          if (d < 0.02) { cw.tx = c.x + (rnd() - 0.5) * W * 0.8; cw.tz = c.z + (rnd() - 0.5) * D * 0.8; cw.wait = 2 + rnd() * 4; }
          else { const st = Math.min(d, 0.04 * dt * (ctx.speedMul ?? 1)); cw.x += (dx / d) * st; cw.z += (dz / d) * st; cw.g.rotation.y = Math.atan2(dx, dz); }
        }
        cw.graze += dt;
        cw.head.rotation.x = cw.wait > 0 ? 0.5 + Math.sin(cw.graze * 2) * 0.1 : 0; // 停下來就低頭吃草
        cw.g.position.set(cw.x, gy(cw.x, cw.z), cw.z);
      }
    });
    hitbox(it.id, c.x, c.z, 1.1, 0.5);
  }


  // ── 後壁稻田收割：稻田在「收割」階段時，每兩塊田一台收割機來回；菁寮附近的曬穀場鋪滿金黃稻穀、有人翻穀 ──
  const districtId = (name) => districtByName.get(name)?.id ?? null;
  function machineModel(color) {
    const g = new THREE.Group();
    mesh("box", std(color), [0, 0.06, 0], [0.12, 0.07, 0.2], g); // 車身
    mesh("box", std(0xdfe8ee, { roughness: 0.2 }), [0.02, 0.12, -0.02], [0.07, 0.06, 0.07], g); // 駕駛室
    mesh("cyl", std(0xf1c232), [0, 0.04, 0.13], [0.03, 0.17, 0.03], g, [0, 0, Math.PI / 2]); // 割台
    mesh("box", std(0x2b2f36), [0, 0.02, -0.02], [0.13, 0.03, 0.18], g); // 履帶
    root.add(g);
    return g;
  }
  function harvest(it) {
    const fl = fieldsApi?.list(it.crop, districtId(it.district)) ?? [];
    const machines = fl.filter((_, i) => i % 2 === 0).map((f) => ({ f, g: machineModel(0xd8342c), t: rnd() }));
    // 曬穀場（位置示意）
    const c0 = toWorld(...it.yard), c = spot(c0.x, c0.z, 0.4, 2.5 * MS) ?? c0, y = gy(c.x, c.z);
    take(c.x, c.z, 0.45);
    const yard = new THREE.Group(); yard.position.set(c.x, y, c.z); root.add(yard);
    mesh("box", std(0xbdb7ad), [0, 0.008, 0], [0.6, 0.016, 0.45], yard); // 水泥埕
    const grain = mesh("box", std(0xe0b84a), [0, 0.02, 0], [0.5, 0.012, 0.36], yard); // 稻穀
    const farmers = [0, 1].map((k) => { const h = hikerModel(k ? 0x2e86c1 : 0xb03a2e); h.scale.setScalar(0.8); return h; });
    hitbox(it.id, c.x, c.z, 0.9, 0.5);
    let tt = 0;
    updaters.push((dt, ctx) => {
      const idx = fieldsApi?.stageIndex(it.crop) ?? -1, on = idx === 3 || idx === 6; // crops.json 水稻：3 一期收割、6 二期收割
      const day = on && ctx.minute >= 360 && ctx.minute <= 1080 && !ctx.weather?.rain;
      state[it.id] = { harvest: on };
      grain.visible = on; tt += dt;
      for (const m of machines) {
        m.g.visible = day;
        if (!day) continue;
        m.t = (m.t + dt * 0.05 * (ctx.speedMul ?? 1)) % 2; const u = m.t < 1 ? m.t : 2 - m.t; // 來回
        const lx = (u - 0.5) * (m.f.w - 0.2), lz = (Math.floor(m.t) ? 0.15 : -0.15) * (m.f.d / 1);
        const c2 = Math.cos(m.f.ry), s2 = Math.sin(m.f.ry);
        const x = m.f.x + lx * c2 + lz * s2, z = m.f.z - lx * s2 + lz * c2;
        m.g.position.set(x, gy(x, z) + 0.02, z); m.g.rotation.y = m.f.ry + (m.t < 1 ? Math.PI / 2 : -Math.PI / 2);
      }
      farmers.forEach((h, k) => { h.visible = day; if (!day) return; const x = c.x + (k ? 0.15 : -0.15) + Math.sin(tt * 0.6 + k) * 0.08, z = c.z + (k ? -0.08 : 0.08); h.position.set(x, y + 0.02, z); h.rotation.y = Math.sin(tt * 0.6 + k) > 0 ? Math.PI / 2 : -Math.PI / 2; });
    });
  }

  // ── 善化糖廠製糖期：煙囪冒煙，載甘蔗的卡車在善化蔗田與糖廠間來回（製糖期、白天）──
  function truckModel() {
    const g = new THREE.Group();
    mesh("box", std(0x2e6fb0), [0, 0.06, 0.1], [0.1, 0.08, 0.07], g); // 車頭
    mesh("box", std(0x5a5a5a), [0, 0.035, -0.04], [0.11, 0.025, 0.22], g); // 車斗
    for (let k = 0; k < 3; k++) mesh("cyl", std(0x8a9a4a), [-0.03 + k * 0.03, 0.07, -0.04], [0.025, 0.2, 0.025], g, [Math.PI / 2, 0, 0]); // 一捆捆甘蔗
    root.add(g);
    return g;
  }
  function sugar(it) {
    const a = anchorPos(it.anchor);
    if (!a) return;
    const d = districts.find((x) => x.name === it.district), hub = d ? { x: d.hub[0], z: d.hub[1] } : a;
    const face = Math.atan2(hub.x - a.x, hub.z - a.z), sc = 0.75; // 跟 world.js 一樣：建築正面朝區中心、郊區建築 0.75 倍
    const lx = 0.42 * sc, lz = -0.3 * sc; // sugarmill 模型的煙囪位置（models-industry.js）
    const chim = { x: a.x + lx * Math.cos(face) + lz * Math.sin(face), z: a.z - lx * Math.sin(face) + lz * Math.cos(face), y: a.y + 1.16 * sc };
    const puffs = Array.from({ length: 9 }, (_, k) => { const sp = puff(0, 0xd9d6cf); root.add(sp); return { sp, h: k / 9 }; });
    const fl = fieldsApi?.list(it.crop, districtId(it.district)) ?? [];
    const trucks = fl.slice(0, 3).map((f, k) => ({ g: truckModel(), f, t: k / 3 }));
    hitbox(it.id, a.x, a.z, 1.2, 1.4);
    updaters.push((dt, ctx) => {
      const on = inMonths(it.months, ctx.month);
      state[it.id] = { milling: on };
      for (const p of puffs) {
        p.sp.visible = on; if (!on) continue;
        p.h = (p.h + dt * 0.12) % 1;
        p.sp.position.set(chim.x + p.h * 0.5, chim.y + p.h * 1.2, chim.z + p.h * 0.15); // 煙往上飄、被風往東帶
        const s = 0.25 + p.h * 0.9; p.sp.scale.set(s, s, 1); // 一出煙囪就散開，免得像一顆白球
        p.sp.material.opacity = 0.7 * Math.min(1, p.h * 4) * (1 - p.h); p.sp.material.color.setScalar(0.85 - 0.5 * ctx.night);
      }
      const day = on && ctx.minute >= 360 && ctx.minute <= 1080;
      for (const tr of trucks) {
        tr.g.visible = day; if (!day) continue;
        tr.t = (tr.t + dt * 0.04 * (ctx.speedMul ?? 1)) % 2; const u = tr.t < 1 ? tr.t : 2 - tr.t;
        const x = tr.f.x + (a.x - tr.f.x) * u, z = tr.f.z + (a.z - tr.f.z) * u;
        tr.g.position.set(x, gy(x, z), z); tr.g.rotation.y = Math.atan2(a.x - tr.f.x, a.z - tr.f.z) + (tr.t < 1 ? 0 : Math.PI);
      }
    });
  }

  // ── 龍眼乾焙灶：土窯小屋（磚牆、瓦頂、煙囪、柴堆），8–9 月焙灶時冒煙 ──
  function kilns(it) {
    const smokes = [];
    for (const [lat, lon] of it.spots) {
      const c0 = toWorld(lat, lon), c = spot(c0.x, c0.z, 0.35, 2.5 * MS);
      if (!c) continue;
      take(c.x, c.z, 0.3);
      const g = new THREE.Group(); g.position.set(c.x, gy(c.x, c.z), c.z); g.rotation.y = rnd() * Math.PI; root.add(g);
      mesh("box", std(0xa65a3a), [0, 0.07, 0], [0.2, 0.14, 0.14], g); // 土窯
      mesh("cone", std(0x4f4a45), [0, 0.18, 0], [0.26, 0.08, 0.2], g, [0, Math.PI / 4, 0]); // 瓦頂
      mesh("box", std(0x8b4a32), [0.07, 0.22, -0.03], [0.035, 0.12, 0.035], g); // 煙囪
      mesh("box", std(0x1f1a17), [0, 0.04, 0.071], [0.06, 0.05, 0.004], g); // 灶口
      for (let k = 0; k < 4; k++) mesh("cyl", std(0x6b4a2a), [-0.15, 0.015 + k * 0.022, 0.03], [0.018, 0.12, 0.018], g, [Math.PI / 2, 0, 0]); // 龍眼木柴堆
      const top = new THREE.Vector3(0.07, 0.3, -0.03).applyEuler(g.rotation).add(g.position);
      for (let k = 0; k < 6; k++) { const sp = puff(0, 0xcfc8bd); root.add(sp); smokes.push({ sp, top, h: k / 6 }); }
      hitbox(it.id, c.x, c.z, 0.5, 0.4);
    }
    updaters.push((dt, ctx) => {
      const on = [8, 9].includes(ctx.month); // 立秋「拜寮」起火到「謝寮」
      state[it.id] = { baking: on };
      for (const p of smokes) { p.sp.visible = on; if (!on) continue; p.h = (p.h + dt * 0.15) % 1; p.sp.position.set(p.top.x + p.h * 0.2, p.top.y + p.h * 0.6, p.top.z); const s = 0.12 + p.h * 0.4; p.sp.scale.set(s, s, 1); p.sp.material.opacity = 0.75 * Math.min(1, p.h * 4) * (1 - p.h); p.sp.material.color.setScalar(0.85 - 0.5 * ctx.night); }
    });
  }

  // ── 白河蓮田：白河的蓮花田與蓮花公園池子，依產季長荷葉、開花、結蓮蓬；休耕時是空田 ──
  function lotus(it) {
    const fl = fieldsApi?.list(it.crop, districtId(it.district)) ?? [];
    const spots = fl.map((f) => ({ x: f.x, z: f.z, w: f.w * 0.85, d: f.d * 0.85, ry: f.ry, n: 30 }));
    const a = anchorPos(it.anchor);
    if (a) spots.push({ x: a.x - 0.06, z: a.z + 0.015, w: 0.55, d: 0.42, ry: 0, n: 18 }); // 蓮花公園的池子
    const leaves = [], flowers = [], pods = [];
    for (const sp of spots) {
      const c2 = Math.cos(sp.ry), s2 = Math.sin(sp.ry);
      for (let k = 0; k < sp.n; k++) {
        const lx = (rnd() - 0.5) * sp.w, lz = (rnd() - 0.5) * sp.d, x = sp.x + lx * c2 + lz * s2, z = sp.z - lx * s2 + lz * c2, y = gy(x, z) + 0.03;
        const r = 0.05 + rnd() * 0.035;
        leaves.push([x, y + rnd() * 0.04, z, r, 0.006, r, rnd() * 3]);
        if (k % 3 === 0) flowers.push([x + 0.02, y + 0.07, z, 0.035, 0.045, 0.035]);
        if (k % 4 === 1) pods.push([x - 0.02, y + 0.06, z, 0.03, 0.02, 0.03]);
      }
    }
    const lf = instanced("cyl", std(0x3f8a4a), leaves, { shadow: false });
    const fw = instanced("cone", std(0xf4a3c2), flowers, { shadow: false });
    const pd = instanced("cyl", std(0x8c9c5f), pods, { shadow: false });
    if (a) hitbox(it.id, a.x + 0.4, a.z + 0.3, 0.6, 0.4);
    updaters.push((dt, ctx) => {
      const idx = fieldsApi?.stageIndex(it.crop) ?? -1; // crops.json 蓮花：0 休耕、1 種植展葉、2 花期・採蓮子、3 採蓮子蓮藕、4 休耕
      lf.visible = idx >= 1 && idx <= 3; fw.visible = idx === 2; pd.visible = idx === 2 || idx === 3;
      lf.material.color.setHex(idx === 3 ? 0x8a9a4a : 0x3f8a4a); // 秋天荷葉轉黃
      state[it.id] = { stage: idx };
    });
  }

  // ── 龍崎竹林：一叢叢莿竹（細長竹竿＋葉叢），隨風搖 ──
  function bamboo(it) {
    const clumps = [];
    const culmMat = std(0x7fa04a), leafMat = std(0x4f7d3a);
    for (const [lat, lon] of it.spots) {
      const c0 = toWorld(lat, lon);
      for (let k = 0; k < 9; k++) {
        const ang = rnd() * Math.PI * 2, r = 0.2 + rnd() * 0.9, c = spot(c0.x + Math.cos(ang) * r, c0.z + Math.sin(ang) * r, 0.35, 0.6);
        if (!c || fieldHit(c.x, c.z, 0.2)) continue; // 竹叢會往外散，離田遠一點
        take(c.x, c.z, 0.18);
        const g = new THREE.Group(); g.position.set(c.x, gy(c.x, c.z), c.z); root.add(g);
        for (let j = 0; j < 7; j++) {
          const a2 = rnd() * Math.PI * 2, rr = rnd() * 0.05, h = 0.35 + rnd() * 0.2;
          mesh("cyl", culmMat, [Math.cos(a2) * rr, h / 2, Math.sin(a2) * rr], [0.012, h, 0.012], g, [Math.cos(a2) * 0.12, 0, Math.sin(a2) * 0.12]);
          for (const [dy, k] of [[0.04, 1], [-0.06, 0.8], [-0.15, 0.6]]) mesh("sphere", leafMat, [Math.cos(a2) * (rr + 0.035), h + dy - 0.04, Math.sin(a2) * (rr + 0.035)], [0.05 * k, 0.11 * k, 0.05 * k], g); // 細長、往下垂的葉叢
        }
        clumps.push({ g, ph: rnd() * 6 });
      }
    }
    const c0 = toWorld(...it.spots[0]), hb = spot(c0.x, c0.z, 0.3, 2 * MS) ?? c0;
    hitbox(it.id, hb.x, hb.z, 1.2, 0.6);
    let t = 0;
    updaters.push((dt) => { t += dt; for (const cl of clumps) { cl.g.rotation.z = Math.sin(t * 1.2 + cl.ph) * 0.04; cl.g.rotation.x = Math.cos(t * 0.9 + cl.ph) * 0.03; } });
  }

  // ── 七股紅樹林與黑面琵鷺：海寮一帶的紅樹林（支柱根）；曾文溪口淺灘上一群黑面琵鷺低頭左右掃嘴覓食（10 月–隔年 4 月）──
  function spoonbill() {
    const g = new THREE.Group(), head = new THREE.Group();
    mesh("sphere", std(0xf7f7f2), [0, 0.07, 0], [0.06, 0.045, 0.09], g); // 身體
    for (const x of [-0.01, 0.01]) mesh("cyl", std(0x2b2b2b), [x, 0.025, 0], [0.004, 0.05, 0.004], g); // 腳
    head.position.set(0, 0.08, 0.04); g.add(head);
    mesh("cyl", std(0xf7f7f2), [0, -0.01, 0.025], [0.012, 0.05, 0.012], head, [1.1, 0, 0]); // 脖子（低頭）
    mesh("sphere", std(0xf7f7f2), [0, -0.03, 0.05], [0.022, 0.02, 0.024], head);
    mesh("box", std(0x1d1d1d), [0, -0.045, 0.075], [0.016, 0.006, 0.05], head, [0.6, 0, 0]); // 黑色琵琶嘴
    root.add(g);
    return { g, head };
  }
  function wetland(it) {
    const m0 = toWorld(...it.mangrove), trunks = [], roots = [], crowns = [];
    for (let k = 0; k < 30; k++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.8, c = { x: m0.x + Math.cos(a) * r, z: m0.z + Math.sin(a) * r };
      if (!world.onLand(c.x, c.z) || world.inLake(c.x, c.z) || !world.isClear(c.x, c.z, 0.3) || taken.some(([tx, tz, tr]) => Math.hypot(c.x - tx, c.z - tz) < tr)) continue;
      take(c.x, c.z, 0.08);
      const y = gy(c.x, c.z);
      trunks.push([c.x, y + 0.07, c.z, 0.015, 0.1, 0.015]);
      for (let j = 0; j < 4; j++) { const b = (j / 4) * Math.PI * 2; roots.push([c.x + Math.cos(b) * 0.03, y + 0.02, c.z + Math.sin(b) * 0.03, 0.006, 0.06, 0.006, 0, Math.cos(b) * 0.6]); } // 支柱根
      crowns.push([c.x, y + 0.15, c.z, 0.14, 0.08, 0.14]);
    }
    instanced("cyl", std(0x5a4632), trunks, { shadow: false });
    instanced("cyl", std(0x6b5440), roots, { shadow: false });
    instanced("sphere", std(0x2f5f3a), crowns);
    hitbox(it.id, m0.x, m0.z, 1.2, 0.5);
    // 黑琵：投到最近的陸地邊緣，腳下一片淺灘水面
    const b0 = toWorld(...it.birds), c = onLandAt(b0.x, b0.z), y = gy(c.x, c.z);
    const shallow = mesh("cyl", std(0x6fa7b8, { roughness: 0.2, transparent: true, opacity: 0.85 }), [c.x, y + 0.01, c.z], [0.9, 0.006, 0.6]);
    shallow.castShadow = false;
    const flock = Array.from({ length: 12 }, () => ({ ...spoonbill(), x: c.x + (rnd() - 0.5) * 0.7, z: c.z + (rnd() - 0.5) * 0.45, ry: rnd() * 6, ph: rnd() * 6 }));
    hitbox(it.id, c.x, c.z, 1.0, 0.4);
    let t = 0;
    updaters.push((dt, ctx) => {
      const on = inMonths(it.months, ctx.month);
      state[it.id] = { birds: on };
      shallow.visible = true; t += dt;
      for (const b of flock) {
        b.g.visible = on; if (!on) continue;
        b.ry += Math.sin(t * 0.3 + b.ph) * dt * 0.2;
        b.x += Math.sin(b.ry) * dt * 0.01; b.z += Math.cos(b.ry) * dt * 0.01;
        if (Math.hypot(b.x - c.x, b.z - c.z) > 0.4) b.ry += Math.PI * dt; // 不要走出淺灘
        b.g.position.set(b.x, y + 0.01, b.z); b.g.rotation.y = b.ry;
        b.head.rotation.y = Math.sin(t * 3 + b.ph) * 0.6; // 低頭左右掃嘴
      }
    });
  }

  // ── 江家聚落的雞：埕上幾隻雞走走停停、低頭啄食 ──
  function chickens(it) {
    const a = anchorPos(it.anchor) ?? toWorld(...it.spots[0]);
    const flock = Array.from({ length: 5 }, (_, k) => {
      const g = new THREE.Group(), head = new THREE.Group();
      mesh("sphere", std(k % 2 ? 0xf2efe6 : 0xa8643a), [0, 0.03, 0], [0.035, 0.03, 0.045], g);
      head.position.set(0, 0.05, 0.02); g.add(head);
      mesh("sphere", std(k % 2 ? 0xf2efe6 : 0xa8643a), [0, 0, 0], [0.018, 0.018, 0.018], head);
      mesh("box", std(0xd8342c), [0, 0.012, 0], [0.004, 0.01, 0.012], head); // 雞冠
      mesh("cone", std(0xf1c232), [0, -0.002, 0.014], [0.008, 0.012, 0.008], head, [Math.PI / 2, 0, 0]); // 嘴
      root.add(g);
      return { g, head, x: a.x + (rnd() - 0.5) * 0.3, z: a.z + 0.2 + rnd() * 0.15, tx: a.x, tz: a.z + 0.25, wait: rnd() * 2 };
    });
    hitbox(it.id, a.x, a.z + 0.3, 0.5, 0.3);
    updaters.push((dt, ctx) => {
      const day = ctx.minute >= 330 && ctx.minute <= 1110;
      for (const ch of flock) {
        ch.g.visible = day; if (!day) continue;
        if (ch.wait > 0) { ch.wait -= dt; ch.head.rotation.x = Math.sin(ch.wait * 9) > 0 ? 0.8 : 0.1; } // 低頭啄食
        else {
          const dx = ch.tx - ch.x, dz = ch.tz - ch.z, d = Math.hypot(dx, dz);
          if (d < 0.01) { ch.tx = a.x + (rnd() - 0.5) * 0.4; ch.tz = a.z + 0.15 + rnd() * 0.25; ch.wait = 1 + rnd() * 2; }
          else { const st = Math.min(d, 0.06 * dt); ch.x += (dx / d) * st; ch.z += (dz / d) * st; ch.g.rotation.y = Math.atan2(dx, dz); ch.head.rotation.x = 0; }
        }
        ch.g.position.set(ch.x, gy(ch.x, ch.z) + 0.02, ch.z);
      }
    });
  }


  // ── 曾文水庫觀光遊艇：示意湖上，依班次（假日早上與下午、每天下午半日遊）出航，沒出航時停在壩邊 ──
  function boatModelBig() {
    const g = new THREE.Group();
    mesh("box", std(0xf4f7fa), [0, 0.03, 0], [0.16, 0.05, 0.42], g); // 船身
    mesh("box", std(0xf4f7fa), [0, 0.03, 0.23], [0.1, 0.05, 0.06], g, [0, Math.PI / 4, 0]); // 船頭
    mesh("box", std(0x2e6fb0), [0, 0.09, -0.04], [0.13, 0.07, 0.22], g); // 船艙
    mesh("box", std(0xdfe8ee, { roughness: 0.2 }), [0, 0.1, -0.04], [0.135, 0.03, 0.18], g); // 窗
    root.add(g);
    return g;
  }
  function boat(it) {
    const poly = lakePoly(it.lake);
    if (!poly) return;
    // 湖是樹枝狀（照真實湖形縮小），中心點可能落在陸地上：在湖面內部取點，從壩邊出發，每段都要整條在水面上
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    const edge = (x, z) => { let d = Infinity; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, az] = poly[j], [bx, bz] = poly[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz; const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0; d = Math.min(d, Math.hypot(ax + dx * t - x, az + dz * t - z)); } return d; };
    const wet2 = [];
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.08 * MS) for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.08 * MS) if (inPoly(poly, x, z) && edge(x, z) > 0.07) wet2.push({ x, z });
    const a = anchorPos(it.anchor) ?? wet2[0] ?? { x: xs[0], z: zs[0] };
    const clearLine = (p, q) => { for (let k = 1; k < 10; k++) { const x = p.x + (q.x - p.x) * k / 10, z = p.z + (q.z - p.z) * k / 10; if (!inPoly(poly, x, z) || edge(x, z) < 0.05) return false; } return true; };
    const route = [];
    if (wet2.length) {
      route.push(wet2.reduce((b, p) => (Math.hypot(p.x - a.x, p.z - a.z) < Math.hypot(b.x - a.x, b.z - a.z) ? p : b)));
      for (let k = 0; k < 4; k++) { // 每次往「看得到、離起點最遠」的湖面點開
        const cur = route.at(-1), cand = wet2.filter((p) => Math.hypot(p.x - cur.x, p.z - cur.z) > 0.25 * MS && clearLine(cur, p));
        if (!cand.length) break;
        route.push(cand.reduce((b, p) => (Math.hypot(p.x - route[0].x, p.z - route[0].z) > Math.hypot(b.x - route[0].x, b.z - route[0].z) ? p : b)));
      }
    }
    const cx = route[0]?.x ?? a.x, cz = route[0]?.z ?? a.z;
    const waterY = TOP + 0.02 + poly.reduce((s2, [x, z]) => s2 + world.heightAt(x, z), 0) / poly.length + 0.012;
    const g = boatModelBig(); g.scale.setScalar(MS > 1 ? 0.8 : 0.55); // 1 倍地圖的示意湖很小，船也縮小；地圖放大後用原尺寸
    const move = route.length > 1 ? pathMover(route, [g], [0, 1440], 0.12 * MS) : null;
    console.info(`[scenery] ${it.id}：航線 ${route.length} 點`);
    hitbox(it.id, cx, cz, 0.6, 0.4);
    updaters.push((dt, ctx) => {
      const on = it.trips.some((tr) => tr.days.includes(ctx.weekday) && ctx.minute >= tr.from && ctx.minute <= tr.to);
      state[it.id] = { sailing: on };
      if (on && move) move(dt, ctx, () => waterY);
      else if (route[0]) { g.position.set(route[0].x, waterY, route[0].z); } // 停在碼頭邊
      g.visible = true;
    });
  }

  // ── 步道：碎石小徑＋幾位健行的人（白天、沒下雨）──
  function trailWalk(it) {
    const pts = it.trail.map(([lat, lon]) => onLandAt(toWorld(lat, lon).x, toWorld(lat, lon).z));
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const total = cum.at(-1) || 1, dots = [];
    for (let i = 0; i < pts.length - 1; i++) { const n = Math.max(1, Math.round((cum[i + 1] - cum[i]) / 0.15)); for (let k = 0; k < n; k++) { const t = k / n, x = pts[i].x + (pts[i + 1].x - pts[i].x) * t, z = pts[i].z + (pts[i + 1].z - pts[i].z) * t; dots.push([x, gy(x, z) + 0.01, z, 0.05, 0.01, 0.05]); take(x, z, 0.1); } }
    instanced("box", std(0xc9b48a), dots, { shadow: false });
    const hikers = [0xf1c232, 0x2e86c1, 0xd35400].map((col, k) => ({ g: hikerModel(col), s: total * (0.1 + k * 0.35), dir: k % 2 ? -1 : 1, v: (0.1 + k * 0.02) * WALK }));
    const at = (s2) => { let i = 0; while (i < cum.length - 2 && s2 > cum[i + 1]) i++; const t = (s2 - cum[i]) / ((cum[i + 1] - cum[i]) || 1); return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, z: pts[i].z + (pts[i + 1].z - pts[i].z) * t, ry: Math.atan2(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z) }; };
    hitbox(it.id, pts[0].x, pts[0].z, 0.6, 0.5);
    updaters.push((dt, ctx) => {
      const on = ctx.minute >= 360 && ctx.minute <= 1020 && !ctx.weather?.rain;
      state[it.id] = { hiking: on };
      for (const h of hikers) {
        h.g.visible = on; if (!on) continue;
        h.s += h.dir * h.v * dt * (ctx.speedMul ?? 1);
        if (h.s > total) { h.s = total; h.dir = -1; } else if (h.s < 0) { h.s = 0; h.dir = 1; }
        const p = at(h.s); h.g.position.set(p.x, gy(p.x, p.z), p.z); h.g.rotation.y = p.ry + (h.dir < 0 ? Math.PI : 0);
      }
    });
  }

  // ── 龍眼蜜蜂箱：龍眼園邊一排蜂箱，花期時蜜蜂在附近飛 ──
  function beehives(it) {
    const c0 = toWorld(...it.spots[0]), c = spot(c0.x + 0.3, c0.z + 0.3, 0.35, 2.5 * MS);
    if (!c) return;
    take(c.x, c.z, 0.35);
    const y = gy(c.x, c.z), boxes = [], lids = [];
    for (let k = 0; k < 8; k++) { const x = c.x + (k % 4) * 0.09 - 0.135, z = c.z + Math.floor(k / 4) * 0.13 - 0.065; boxes.push([x, y + 0.035, z, 0.06, 0.07, 0.05]); lids.push([x, y + 0.075, z, 0.07, 0.012, 0.06]); }
    instanced("box", std(0xf3ead2), boxes); instanced("box", std(0x2e86c1), lids);
    const beeMesh = new THREE.InstancedMesh(G.sphere, basic(0xf1c232), 24); root.add(beeMesh); // 24 隻蜜蜂一次畫
    const bees = Array.from({ length: 24 }, () => ({ a: rnd() * 6, r: 0.1 + rnd() * 0.3, h: 0.08 + rnd() * 0.12, sp: 1 + rnd() * 2 }));
    hitbox(it.id, c.x, c.z, 0.6, 0.4);
    updaters.push((dt, ctx) => {
      const on = inMonths(it.months, ctx.month) && ctx.minute >= 420 && ctx.minute <= 1050;
      state[it.id] = { flowering: inMonths(it.months, ctx.month) };
      beeMesh.visible = on; if (!on) return;
      bees.forEach((b, i) => { b.a += dt * b.sp; beeMesh.setMatrixAt(i, m4.compose(v3.set(c.x + Math.cos(b.a) * b.r, y + b.h + Math.sin(b.a * 3) * 0.03, c.z + Math.sin(b.a * 1.3) * b.r), q4.identity(), s3.set(0.012, 0.012, 0.012))); });
      beeMesh.instanceMatrix.needsUpdate = true;
    });
  }

  // ── 山區農家（背景，不可點）：鐵皮屋頂的小農舍、晾衣竿、菜園、看門狗 ──
  function farmhouses(it) {
    const ROOF = [0x3f7fbf, 0x3f9a6b, 0xb03a2e, 0x8a939e];
    for (const name of it.districts) {
      const dd = districts.find((x) => x.name === name);
      if (!dd?.polygon) continue;
      const xs = dd.polygon.map((p) => p[0]), zs = dd.polygon.map((p) => p[1]);
      let placed = 0;
      for (let tries = 0; tries < 400 * MS && placed < it.count * MS; tries++) { // 區跟著地圖放大，農家 ×MS 戶
        const x = Math.min(...xs) + rnd() * (Math.max(...xs) - Math.min(...xs)), z = Math.min(...zs) + rnd() * (Math.max(...zs) - Math.min(...zs));
        if (world.districtAt(x, z) !== dd.id || !free(x, z, 0.6) || fieldHit(x, z, 0.3)) continue;
        take(x, z, 0.4);
        const g = new THREE.Group(); g.position.set(x, gy(x, z), z); g.rotation.y = rnd() * Math.PI * 2; // 不加進場景，組好後合併（bake）
        mesh("box", std(0xe9e2d0), [0, 0.055, 0], [0.18, 0.11, 0.13], g); // 農舍
        mesh("box", std(ROOF[placed % ROOF.length]), [0, 0.125, 0], [0.21, 0.012, 0.16], g, [0.18, 0, 0]); // 單斜鐵皮屋頂
        mesh("box", std(0x5a4632), [0, 0.04, 0.066], [0.04, 0.07, 0.004], g); // 門
        for (const px of [0.13, 0.27]) mesh("cyl", std(0x8a6a4a), [px, 0.05, 0.05], [0.006, 0.1, 0.006], g); // 晾衣竿
        mesh("box", std(0x8a6a4a), [0.2, 0.095, 0.05], [0.14, 0.004, 0.004], g);
        [0xd86f6f, 0x6f9fd8, 0xe9d8a6].forEach((col, k) => mesh("box", std(col), [0.16 + k * 0.04, 0.075, 0.05], [0.03, 0.035, 0.003], g));
        mesh("box", std(0x7a5a3a), [-0.2, 0.008, 0.02], [0.14, 0.012, 0.12], g); // 菜園
        for (let r = 0; r < 3; r++) mesh("box", std(0x5f9a4a), [-0.2, 0.018, -0.02 + r * 0.04], [0.12, 0.012, 0.015], g);
        mesh("box", std(0x9a6a3a), [0.05, 0.02, 0.12], [0.025, 0.025, 0.045], g); mesh("box", std(0x9a6a3a), [0.05, 0.04, 0.145], [0.022, 0.022, 0.022], g); // 看門狗
        bake(g);
        placed++;
      }
    }
    flushBaked();
  }

  // ── 載水果的小貨車（背景）：產季時沿經過楠西、南化的公車支線山路來回；6–7 月載芒果、8–9 月載龍眼 ──
  function truckSmall() {
    const g = new THREE.Group();
    mesh("box", std(0xf4f7fa), [0, 0.04, 0.06], [0.08, 0.06, 0.06], g); // 車頭
    mesh("box", std(0x8a939e), [0, 0.025, -0.04], [0.08, 0.02, 0.13], g); // 車斗
    const crates = mesh("box", std(0xf2a33a), [0, 0.05, -0.04], [0.07, 0.04, 0.11], g); // 一箱箱水果
    root.add(g);
    return { g, crates };
  }
  function trucks(it) {
    let list = null, loading = false;
    const ids = new Set(it.districts.map((n) => districtByName.get(n)?.id));
    function build(data) {
      list = [];
      for (const rid of it.routes) {
        const r = data.routes.find((x) => x.id === rid), pat = r?.patterns.find((p) => p.kind === "main" && p.dir === 0) ?? r?.patterns[0];
        if (!pat) continue;
        let best = [], cur = []; // 只留落在楠西、南化的最長一段
        for (const [x, z] of pat.points) { if (ids.has(world.districtAt(x, z))) cur.push({ x, z }); else { if (cur.length > best.length) best = cur; cur = []; } }
        if (cur.length > best.length) best = cur;
        if (best.length < 2) continue;
        const t = truckSmall();
        list.push({ ...t, move: pathMover(best, [t.g], [360, 1080], 0.25 * MS) });
      }
    }
    updaters.push((dt, ctx) => {
      const on = inMonths(it.months, ctx.month);
      if (on && !list && !loading && loadBusBranches) { loading = true; loadBusBranches().then(build).catch(() => (list = [])); }
      if (!list) return;
      for (const tr of list) {
        if (!on) { tr.g.visible = false; continue; }
        tr.crates.material.color.setHex(ctx.month <= 7 ? 0xf2a33a : 0xb5813f); // 芒果橘、龍眼褐
        tr.move(dt, ctx, (x, z) => gy(x, z) + 0.01);
      }
    });
  }

  // ── 台灣藍鵲：兩隻拖著長尾巴的藍鵲在幾棵樹間繞飛 ──
  function magpies(it) {
    const c0 = toWorld(...it.spots[0]), c = spot(c0.x, c0.z, 0.4, 2 * MS) ?? c0, y = gy(c.x, c.z);
    take(c.x, c.z, 0.5);
    for (const [dx, dz] of [[-0.2, -0.1], [0.2, 0.05], [0, 0.22]]) { mesh("cyl", std(0x5a4632), [c.x + dx, y + 0.1, c.z + dz], [0.02, 0.2, 0.02]); mesh("sphere", std(0x3f7d3a), [c.x + dx, y + 0.26, c.z + dz], [0.2, 0.16, 0.2]); }
    const birds = [0, 1].map((k) => {
      const g = new THREE.Group(), wings = [];
      mesh("sphere", std(0x1f5fbf), [0, 0, 0], [0.04, 0.035, 0.07], g); // 藍色身體
      mesh("sphere", std(0x111111), [0, 0.01, 0.045], [0.03, 0.03, 0.03], g); // 黑頭
      mesh("cone", std(0xd8342c), [0, 0.008, 0.07], [0.012, 0.025, 0.012], g, [Math.PI / 2, 0, 0]); // 紅嘴
      mesh("box", std(0x1f5fbf), [0, 0, -0.12], [0.02, 0.006, 0.14], g); // 長尾巴
      mesh("box", std(0xf4f7fa), [0, 0.001, -0.19], [0.022, 0.007, 0.02], g); // 白色尾端
      for (const side of [-1, 1]) { const w = mesh("box", std(0x2a6fd0), [side * 0.045, 0.005, 0], [0.06, 0.006, 0.04], g); wings.push({ w, side }); }
      root.add(g);
      return { g, wings, a: k * Math.PI };
    });
    hitbox(it.id, c.x, c.z, 0.7, 0.6);
    let t = 0;
    updaters.push((dt, ctx) => {
      const day = ctx.minute >= 330 && ctx.minute <= 1110; t += dt;
      for (const b of birds) {
        b.g.visible = day; if (!day) continue;
        b.a += dt * 0.6;
        const x = c.x + Math.sin(b.a) * 0.35, z = c.z + Math.sin(b.a * 2) * 0.18; // 8 字形繞飛
        b.g.position.set(x, y + 0.32 + Math.sin(b.a * 3) * 0.04, z);
        b.g.rotation.y = Math.atan2(Math.cos(b.a) * 0.35, Math.cos(b.a * 2) * 0.36);
        for (const w of b.wings) w.w.rotation.z = w.side * Math.sin(t * 14) * 0.6; // 拍翅
      }
    });
  }

  const BUILD = { clouds, badlands, steam, peak, stars, orchard, fishponds, lagoon, tunnel, noodles, caltrop, dairy, harvest, sugar, kilns, lotus, bamboo, wetland, chickens,
    boat, trail: trailWalk, beehives, farmhouses, trucks, magpies };
  for (const it of data.items) {
    items.set(it.id, it);
    const before = pickables.length;
    try { BUILD[it.kind]?.(it); } catch (e) { console.warn("[scenery]", it.id, e); }
    if (!it.background && pickables.length === before) console.warn(`[scenery] ${it.id} 找不到空地，沒有放上地圖`);
  }

  function update(dt, ctx) {
    if (!root.visible) return;
    for (const u of updaters) u(dt, ctx);
  }
  function setQuality(q) { if (starPts) starPts.material.size = q === "low" ? 1.3 : 1.6; }
  // 卡片：景觀資料＋即時狀態
  function info(id) { const it = items.get(id); return it && { ...it, state: { ...(state[id] || {}) } }; }
  // 某個地標附近有哪些景觀（建築／景點卡片上列出來）
  function anchoredTo(type, id, nameOf) {
    return [...items.values()].filter((it) => it.anchor && ((type === "poi" && it.anchor.poi === id) || (type === "building" && it.anchor.building && nameOf(it.anchor.building) === id)));
  }
  function center(id) { const hb = pickables.find((p) => p.userData.id === id); return hb ? hb.position.clone() : null; }
  return { update, pickables, info, items, anchoredTo, center, setQuality };
}

// 月世界惡地的地形變色範圍（要在建地形之前算，所以獨立出來）
export function badlandPatches(data, projection, S = 1) { // S：地圖放大倍數
  const r = 1.35 * S;
  const P = projection, it = data.items.find((x) => x.kind === "badlands");
  return (it?.spots ?? []).map(([lat, lon]) => ({ x: (lon - P.lon_c) * P.km_x * P.k, z: -(lat - P.lat_c) * P.km_z * P.k, r }));
}
