// 民俗活動的動態效果：蜂炮（粒子）、燒王船（火焰與煙）、蜈蚣陣（繞廟前進的隊伍）、太祖夜祭（篝火與圍圈牽手舞）。
import { TOP } from "./world.js";

export function createEvents(THREE, scene, world, events, rnd) {
  const group = new THREE.Group();
  scene.add(group);
  const basic = (c, extra = {}) => new THREE.MeshBasicMaterial({ color: c, ...extra });
  const std = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
  const geo = { box: new THREE.BoxGeometry(1, 1, 1), sphere: new THREE.SphereGeometry(0.5, 10, 8), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10), cone: new THREE.ConeGeometry(0.5, 1, 8) };
  const mesh = (g, m, pos, sc, parent = null, rot) => {
    parent = parent || current || group; const o = new THREE.Mesh(geo[g], m); o.position.set(...pos); o.scale.set(...sc); if (rot) o.rotation.set(...rot); o.castShadow = g !== "sphere"; parent.add(o); return o; };

  // 在地點附近找一個在陸地上的擺放位置：優先朝區中心方向
  function spotNear(ev, dist) {
    const p = ev.pos, hub = ev.hub;
    const base = Math.atan2(hub.z - p.z, hub.x - p.x);
    for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, Math.PI]) {
      const a = base + off, x = p.x + Math.cos(a) * dist, z = p.z + Math.sin(a) * dist;
      if (world.onLand(x, z)) return new THREE.Vector3(x, world.groundY(x, z), z);
    }
    return p.clone();
  }

  const updaters = [];
  const groupOf = new Map();
  let current = null;
  const addTo = (ev) => { const g = new THREE.Group(); group.add(g); groupOf.set(ev.id, g); current = g; return g; };

  // ── 蜂炮 ──
  function fireworks(ev) {
    const grp = addTo(ev);
    const at = spotNear(ev, 1.0);
    world.addObstacle(ev.district, at.x, at.z, 0.7);
    // 炮城
    mesh("box", std(0xb8412f), [at.x, at.y + 0.3, at.z], [0.5, 0.6, 0.5]);
    mesh("box", std(0x211d1d), [at.x, at.y + 0.62, at.z], [0.56, 0.04, 0.56]);
    for (let i = 0; i < 9; i++) mesh("cyl", std(0xfcea8b), [at.x - 0.16 + (i % 3) * 0.16, at.y + 0.7, at.z - 0.16 + Math.floor(i / 3) * 0.16], [0.06, 0.12, 0.06]);
    const N = 600;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3), life = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
    pts.frustumCulled = false;
    grp.add(pts);
    const palette = [[1, 0.85, 0.3], [1, 0.45, 0.2], [1, 0.95, 0.8], [0.4, 0.9, 1], [1, 0.4, 0.7]];
    let next = 0, acc = 0;
    const tmp = new THREE.Color();
    updaters.push((dt, night) => {
      if (!grp.visible) return;
      acc += dt;
      const rate = 0.05 + (1 - night) * 0.04; // 夜晚更密集
      while (acc > rate) {
        acc -= rate;
        for (let k = 0; k < 6; k++) {
          const i = next; next = (next + 1) % N;
          const a = rnd() * Math.PI * 2, sp = 1.4 + rnd() * 2.2, up = 2.2 + rnd() * 2.0;
          pos[i * 3] = at.x + (rnd() - 0.5) * 0.3; pos[i * 3 + 1] = at.y + 0.75; pos[i * 3 + 2] = at.z + (rnd() - 0.5) * 0.3;
          vel[i * 3] = Math.cos(a) * sp; vel[i * 3 + 1] = up; vel[i * 3 + 2] = Math.sin(a) * sp;
          life[i] = 0.6 + rnd() * 0.7;
          const c = palette[Math.floor(rnd() * palette.length)];
          col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
        }
      }
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) { pos[i * 3 + 1] = -50; continue; }
        life[i] -= dt;
        vel[i * 3 + 1] -= 5.5 * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < at.y + 0.02) life[i] = 0;
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    });
  }

  // ── 大型煙火（跨年、迎春）：火箭升空後在高點炸開 ──
  function bigFireworks(ev) {
    const grp = addTo(ev);
    const at = ev.pos.clone();
    const N = 900;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N), kind = new Uint8Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false;
    grp.add(pts);
    const palette = [[1, 0.3, 0.3], [1, 0.8, 0.2], [0.5, 1, 0.5], [0.5, 0.8, 1], [1, 0.6, 1], [1, 1, 1]];
    let next = 0, acc = 0;
    const spawn = (x, y, z, vx, vy, vz, c, l, k) => { const i = next; next = (next + 1) % N; pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz; col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; life[i] = l; kind[i] = k; };
    updaters.push((dt) => {
      if (!grp.visible) return;
      acc += dt;
      while (acc > 0.55) { acc -= 0.55; spawn(at.x + (rnd() - 0.5) * 0.8, at.y + 0.2, at.z + (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 0.6, 5.5 + rnd() * 1.5, (rnd() - 0.5) * 0.6, [1, 0.9, 0.7], 1.0 + rnd() * 0.3, 1); }
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) { pos[i * 3 + 1] = -50; continue; }
        life[i] -= dt;
        vel[i * 3 + 1] -= (kind[i] === 1 ? 3.5 : 2.2) * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (kind[i] === 1 && life[i] <= 0) { // 火箭到頂：炸成一圈火花
          const c = palette[Math.floor(rnd() * palette.length)];
          for (let k = 0; k < 36; k++) { const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), sp = 1.2 + rnd() * 1.4; spawn(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp, Math.sin(ph) * Math.sin(th) * sp, c, 0.9 + rnd() * 0.6, 2); }
        }
        if (pos[i * 3 + 1] < at.y + 0.02) life[i] = 0;
      }
      g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    });
  }

  // ── 燈節：水面與岸邊的發光裝置，光暈當倒影 ──
  function lanterns(ev) {
    const grp = addTo(ev);
    const c = ev.pos;
    const items = [];
    const palette = [0xffb347, 0xff6b9d, 0x7fd3ff, 0xfff1a8, 0xa8ff9d];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rnd() * 0.4, d = 0.5 + rnd() * 0.9;
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (!world.onLand(x, z)) continue;
      const y = world.groundY(x, z);
      const color = palette[i % palette.length];
      const kindI = i % 3;
      if (kindI === 0) mesh("sphere", basic(color), [x, y + 0.3, z], [0.22, 0.26, 0.22]); // 燈球
      else if (kindI === 1) { mesh("box", basic(color), [x, y + 0.28, z], [0.14, 0.4, 0.14]); mesh("cone", basic(color), [x, y + 0.56, z], [0.2, 0.16, 0.2]); } // 燈塔
      else mesh("cyl", basic(color), [x, y + 0.2, z], [0.3, 0.06, 0.3]); // 漂浮燈盤
      const halo = mesh("cyl", basic(color, { transparent: true, opacity: 0.25 }), [x, y + 0.015, z], [0.7, 0.01, 0.7]); // 倒影光暈
      items.push({ halo, phase: rnd() * 6 });
    }
    world.addObstacle(ev.district, c.x, c.z, 1.0);
    let t = 0;
    updaters.push((dt) => { if (!grp.visible) return; t += dt; items.forEach((it, i) => { const k = 0.8 + Math.sin(t * 1.5 + it.phase) * 0.25; it.halo.scale.set(0.7 * k, 0.01, 0.7 * k); }); });
  }

  // ── 山林燈節：山坡上一圈發光燈柱與緩緩漂浮的光點 ──
  function hillLights(ev) {
    const grp = addTo(ev);
    const c = ev.pos;
    const motes = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, d = 0.9 + (i % 2) * 0.5;
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (!world.onLand(x, z)) continue;
      const y = world.groundY(x, z);
      mesh("cyl", basic(i % 2 ? 0xa8ff9d : 0xfff1a8), [x, y + 0.35, z], [0.06, 0.7, 0.06]); // 燈柱
      mesh("sphere", basic(0xffffff), [x, y + 0.72, z], [0.1, 0.1, 0.1]);
    }
    for (let i = 0; i < 24; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * 1.4, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      const m = mesh("sphere", basic(0xfff8c0, { transparent: true, opacity: 0.8 }), [x, world.groundY(x, z) + 0.2 + rnd() * 0.8, z], [0.05, 0.05, 0.05]);
      motes.push({ m, base: m.position.y, phase: rnd() * 6, speed: 0.3 + rnd() * 0.4 });
    }
    world.addObstacle(ev.district, c.x, c.z, 0.7);
    let t = 0;
    updaters.push((dt) => { if (!grp.visible) return; t += dt; for (const mo of motes) mo.m.position.y = mo.base + Math.sin(t * mo.speed + mo.phase) * 0.15; });
  }

  // ── 海灘舞台：舞台、音響塔、閃動的燈光 ──
  function beachStage(ev) {
    const grp = addTo(ev);
    const at = spotNear(ev, 1.2);
    ev.focus = at; // 相機對準舞台而不是地點本身
    const ry = Math.atan2(ev.hub.x - at.x, ev.hub.z - at.z);
    const b = new THREE.Group(); b.position.copy(at); b.rotation.y = ry; grp.add(b);
    mesh("box", std(0x3a3a44), [0, 0.12, 0], [1.4, 0.24, 0.8], b); // 舞台
    mesh("box", std(0x211d1d), [0, 0.6, -0.36], [1.5, 0.8, 0.08], b); // 背板
    mesh("box", basic(0xff6b9d), [0, 0.62, -0.31], [1.1, 0.3, 0.01], b); // 背板螢幕
    for (const x of [-0.85, 0.85]) { mesh("box", std(0x211d1d), [x, 0.5, -0.1], [0.25, 1.0, 0.25], b); mesh("sphere", basic(0xffffff), [x, 1.08, -0.1], [0.12, 0.12, 0.12], b); } // 音響塔
    for (const x of [-0.7, 0.7]) mesh("box", std(0x9aa4b2), [x, 0.8, 0.3], [0.04, 1.6, 0.04], b); // 燈架
    mesh("box", std(0x9aa4b2), [0, 1.6, 0.3], [1.5, 0.04, 0.04], b);
    const lights = [];
    for (let i = 0; i < 6; i++) lights.push(mesh("sphere", basic([0xff4d6d, 0xffd166, 0x06d6a0, 0x118ab2, 0xef476f, 0xffffff][i]), [-0.6 + i * 0.24, 1.52, 0.3], [0.1, 0.1, 0.1], b));
    world.addObstacle(ev.district, at.x, at.z, 1.1);
    let t = 0;
    updaters.push((dt) => { if (!grp.visible) return; t += dt; lights.forEach((l, i) => { const on = Math.sin(t * 6 + i * 1.1) > 0; l.scale.setScalar(on ? 0.16 : 0.07); }); });
  }

  // ── 遊行：神轎與信眾在兩地之間沿路線往返 ──
  function procession(ev) {
    const grp = addTo(ev);
    if (!ev.toPos) return;
    const pts = [ev.pos.clone(), ...world.route(ev.district, ev.toDistrict), ev.toPos.clone()];
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i - 1].distanceTo(pts[i]));
    const total = cum[cum.length - 1];
    const n = 9, members = [];
    const skin = std(0xf3d2b8);
    for (let i = 0; i < n; i++) {
      const s = new THREE.Group(); grp.add(s);
      if (i === 3) { // 神轎
        mesh("box", std(0xb8412f), [0, 0.3, 0], [0.3, 0.26, 0.3], s);
        mesh("cone", std(0xd9a441), [0, 0.52, 0], [0.4, 0.2, 0.4], s);
        for (const x of [-0.2, 0.2]) mesh("cyl", std(0x8a6a4a), [x, 0.22, 0], [0.025, 0.025, 0.9], s, [Math.PI / 2, 0, 0]);
        for (const z of [-0.32, 0.32]) for (const x of [-0.2, 0.2]) { mesh("cyl", std(0xdb6a41), [x, 0.07, z], [0.06, 0.14, 0.06], s); mesh("sphere", skin, [x, 0.18, z], [0.07, 0.07, 0.07], s); }
      } else {
        const shirt = [0xdb6a41, 0xfcea8b, 0x4a7fc1, 0xffffff][i % 4];
        mesh("cyl", std(shirt), [0, 0.1, 0], [0.07, 0.2, 0.07], s);
        mesh("sphere", skin, [0, 0.24, 0], [0.08, 0.08, 0.08], s);
        if (i % 2 === 0) { mesh("cyl", std(0x8a6a4a), [0.06, 0.3, 0], [0.012, 0.5, 0.012], s); mesh("box", std(i % 4 ? 0xd9a441 : 0xb8412f), [0.1, 0.5, 0], [0.08, 0.12, 0.01], s); } // 旗
        else mesh("sphere", basic(0xff6b3d), [0.06, 0.34, 0], [0.05, 0.06, 0.05], s); // 燈籠
      }
      members.push(s);
    }
    const state = { s: 0, dir: 1, wait: 0 };
    const place = (obj, d) => {
      const sc = Math.max(0, Math.min(total, d));
      let i = 0; while (i < cum.length - 2 && sc > cum[i + 1]) i++;
      const a = pts[i], b = pts[i + 1], seg = cum[i + 1] - cum[i] || 1, t = (sc - cum[i]) / seg;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      obj.position.set(x, world.groundY(x, z), z);
      obj.rotation.y = Math.atan2((b.x - a.x) * state.dir, (b.z - a.z) * state.dir);
    };
    updaters.push((dt, night, speedMul) => {
      if (!grp.visible) return;
      if (state.wait > 0) state.wait -= dt;
      else {
        state.s += state.dir * 0.5 * Math.min(1.2, speedMul) * dt;
        if (state.s >= total) { state.s = total; state.dir = -1; state.wait = 4; }
        if (state.s <= 0) { state.s = 0; state.dir = 1; state.wait = 4; }
      }
      members.forEach((m, i) => place(m, state.s - state.dir * i * 0.28));
    });
    // 去程／回程：啟用時依排程段決定從哪一端出發
    grp.userData.setDirection = (index) => { state.dir = index === 1 ? -1 : 1; state.s = index === 1 ? total : 0; state.wait = 1; };
  }

  // ── 整區換樹色：木棉（橘紅）、落羽松（橘）、梅花（白）──
  function treeColor(ev, color) {
    const grp = addTo(ev);
    grp.userData.onActive = (on) => world.setTreeColor(ev.district, on ? color : null);
  }
  const kapok = (ev) => treeColor(ev, 0xe8562a);

  // ── 蓮花季：池面冒出荷葉與粉紅蓮花 ──
  function lotus(ev) {
    const grp = addTo(ev);
    const c = ev.pos;
    for (let i = 0; i < 22; i++) {
      const a = rnd() * Math.PI * 2, d = 0.25 + rnd() * 0.75, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (!world.onLand(x, z)) continue;
      const y = world.groundY(x, z);
      mesh("cyl", std(0x3f7f4a), [x, y + 0.035, z], [0.16 + rnd() * 0.08, 0.012, 0.16 + rnd() * 0.08]); // 荷葉
      if (i % 2 === 0) { mesh("cyl", std(0x5f8f4a), [x, y + 0.12, z], [0.012, 0.18, 0.012]); mesh("cone", std([0xf4a3c2, 0xf7b7d0, 0xffffff][i % 3]), [x, y + 0.26, z], [0.09, 0.12, 0.09]); } // 蓮花
    }
    world.addObstacle(ev.district, c.x, c.z, 0.9);
  }

  // ── 螢火蟲：夜間漂浮閃爍的綠光點 ──
  function fireflies(ev) {
    const grp = addTo(ev);
    const c = ev.pos, motes = [];
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, d = rnd() * 1.6, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      const m = mesh("sphere", basic(0xb8ff6a, { transparent: true, opacity: 0.9 }), [x, world.groundY(x, z) + 0.15 + rnd() * 0.6, z], [0.035, 0.035, 0.035]);
      motes.push({ m, base: m.position.y, bx: x, bz: z, phase: rnd() * 6, speed: 0.5 + rnd() * 0.8 });
    }
    let t = 0;
    updaters.push((dt, night) => {
      if (!grp.visible) return;
      t += dt;
      for (const mo of motes) {
        mo.m.position.set(mo.bx + Math.sin(t * mo.speed + mo.phase) * 0.12, mo.base + Math.sin(t * mo.speed * 1.3 + mo.phase) * 0.1, mo.bz + Math.cos(t * mo.speed * 0.7 + mo.phase) * 0.12);
        const blink = Math.sin(t * 4 + mo.phase * 3) > 0.3 ? 1 : 0.15;
        mo.m.material.opacity = blink * (0.3 + night * 0.7); // 白天幾乎看不見
      }
    });
  }

  // ── 候鳥：一群白鳥在潟湖上空盤旋 ──
  function birds(ev) {
    const grp = addTo(ev);
    const c = ev.pos, flock = [];
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Group(); grp.add(g);
      mesh("box", std(0xffffff), [0, 0, 0], [0.05, 0.03, 0.12], g); // 身體
      const wl = mesh("box", std(0xffffff), [-0.07, 0.01, 0], [0.12, 0.012, 0.05], g), wr = mesh("box", std(0xffffff), [0.07, 0.01, 0], [0.12, 0.012, 0.05], g);
      mesh("box", std(0x211d1d), [0, 0, 0.09], [0.015, 0.015, 0.07], g); // 黑色長喙
      flock.push({ g, wl, wr, r: 0.5 + rnd() * 1.1, h: 0.9 + rnd() * 0.7, phase: rnd() * 6, speed: 0.5 + rnd() * 0.3 });
    }
    let t = 0;
    updaters.push((dt) => {
      if (!grp.visible) return;
      t += dt;
      for (const b of flock) {
        const a = t * b.speed + b.phase;
        b.g.position.set(c.x + Math.cos(a) * b.r, world.groundY(c.x, c.z) + b.h + Math.sin(t * 2 + b.phase) * 0.08, c.z + Math.sin(a) * b.r);
        b.g.rotation.y = -a; // 朝切線方向
        const flap = Math.sin(t * 9 + b.phase) * 0.5;
        b.wl.rotation.z = flap; b.wr.rotation.z = -flap;
      }
    });
  }

  // ── 菱角季：水田轉深綠、採菱小船 ──
  function paddy(ev) {
    if (ev.crop === "rice") return ricePaddy(ev);
    const grp = addTo(ev);
    const c = ev.pos;
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2, d = 0.3 + rnd() * 1.1, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (!world.onLand(x, z)) continue;
      const y = world.groundY(x, z);
      mesh("box", std(0x2f6b3f), [x, y + 0.02, z], [0.8, 0.03, 0.55], null, [0, rnd() * Math.PI, 0]); // 深綠菱角田
      mesh("box", std(0x5fa06a), [x, y + 0.04, z], [0.6, 0.012, 0.4], null, [0, 0.3, 0]); // 浮葉
      if (i % 3 === 0) { mesh("box", std(0x8a6a4a), [x, y + 0.06, z], [0.1, 0.04, 0.28]); mesh("sphere", std(0xf3d2b8), [x, y + 0.14, z], [0.06, 0.06, 0.06]); mesh("cone", std(0xd9a441), [x, y + 0.2, z], [0.1, 0.05, 0.1]); } // 採菱人與斗笠
    }
    world.addObstacle(ev.district, c.x, c.z, 0.8);
  }

  // ── 好米季：彩繪稻田（金黃稻田上用紫、綠稻排出圖案）、稻草堆與割稻的人，稻穗隨風起伏 ──
  function ricePaddy(ev) {
    const grp = addTo(ev);
    const at = spotNear(ev, 1.4), N = 7, cell = 0.17, tiles = [];
    ev.focus = at; // 鏡頭對準稻田，不是錨點建築
    const ry = Math.atan2(ev.hub.x - at.x, ev.hub.z - at.z);
    const f = new THREE.Group(); f.position.copy(at); f.rotation.y = ry; grp.add(f);
    const PATTERN = ["..ggg..", ".gpppg.", "gppyppg", "gpyyypg", "gppyppg", ".gpppg.", "..ggg.."]; // 一朵稻花：y 金、p 紫、g 綠、. 金黃底
    const COL = { ".": 0xe2c25a, y: 0xf3dc7a, p: 0x7a4f8f, g: 0x5f9a4a };
    mesh("box", std(0x8a6a4a), [0, 0.012, 0], [N * cell + 0.12, 0.02, N * cell + 0.12], f); // 田埂
    for (let r = 0; r < N; r++) for (let q = 0; q < N; q++) {
      const ch = PATTERN[r][q], x = (q - (N - 1) / 2) * cell, z = (r - (N - 1) / 2) * cell;
      tiles.push(mesh("box", std(COL[ch]), [x, 0.05, z], [cell * 0.96, 0.07, cell * 0.96], f));
    }
    for (const [x, z] of [[-0.75, 0.5], [-0.85, -0.2]]) mesh("cone", std(0xd9b64a), [x, 0.12, z], [0.22, 0.24, 0.22], f); // 稻草堆
    mesh("cyl", std(0x4a7fc1), [0.75, 0.1, 0.3], [0.07, 0.2, 0.07], f); mesh("sphere", std(0xf3d2b8), [0.75, 0.24, 0.3], [0.08, 0.08, 0.08], f); mesh("cone", std(0xd9a441), [0.75, 0.3, 0.3], [0.16, 0.06, 0.16], f); // 割稻的人
    world.addObstacle(ev.district, at.x, at.z, 0.9);
    let t = 0;
    updaters.push((dt) => { if (!grp.visible) return; t += dt; tiles.forEach((m, i) => { m.scale.y = 0.07 * (1 + Math.sin(t * 2 + (i % N) * 0.6) * 0.18); }); }); // 風吹稻浪
  }

  // ── 祭孔：孔廟前 6×6 的八佾舞方陣（黃袍紅帽、手持羽籥），兩側紅燈籠與鼓，舞生緩緩擺動 ──
  function ceremony(ev) {
    const grp = addTo(ev);
    const at = spotNear(ev, 1.1), dancers = [];
    ev.focus = at;
    const ry = Math.atan2(ev.pos.x - at.x, ev.pos.z - at.z); // 面向孔廟
    const b = new THREE.Group(); b.position.copy(at); b.rotation.y = ry; grp.add(b);
    mesh("box", std(0xc9b9a3), [0, 0.01, 0], [1.25, 0.02, 1.25], b); // 丹墀
    const robe = std(0xe8c547), hat = std(0xb8412f), skin = std(0xf3d2b8), feather = std(0xdb6a41);
    for (let r = 0; r < 6; r++) for (let q = 0; q < 6; q++) {
      const d = new THREE.Group(); d.position.set((q - 2.5) * 0.18, 0.02, (r - 2.5) * 0.18); b.add(d);
      mesh("cone", robe, [0, 0.1, 0], [0.09, 0.2, 0.09], d); // 長袍
      mesh("sphere", skin, [0, 0.22, 0], [0.06, 0.06, 0.06], d);
      mesh("cyl", hat, [0, 0.26, 0], [0.06, 0.03, 0.06], d);
      const arm = new THREE.Group(); arm.position.set(0.04, 0.17, 0); d.add(arm);
      mesh("cyl", std(0x8a6a4a), [0, 0.07, 0], [0.008, 0.14, 0.008], arm); // 籥
      mesh("cone", feather, [0, 0.16, 0], [0.025, 0.06, 0.025], arm); // 羽
      dancers.push({ d, arm, k: r + q });
    }
    for (const x of [-0.75, 0.75]) { mesh("cyl", std(0x5a3a2a), [x, 0.3, -0.5], [0.02, 0.6, 0.02], b); mesh("sphere", basic(0xff4d2e), [x, 0.6, -0.5], [0.11, 0.14, 0.11], b); } // 燈籠
    mesh("cyl", std(0xb8412f), [0.75, 0.12, 0.45], [0.2, 0.16, 0.2], b, [Math.PI / 2, 0, 0]); // 鼓
    world.addObstacle(ev.district, at.x, at.z, 0.9);
    let t = 0;
    updaters.push((dt) => {
      if (!grp.visible) return;
      t += dt;
      for (const { d, arm, k } of dancers) { const s = Math.sin(t * 1.2 - k * 0.15); d.rotation.y = s * 0.35; arm.rotation.z = -0.3 + s * 0.5; }
    });
  }

  // ── 龍舟賽：沿運河（ev.path，世界座標）畫一條水道，三艘彩色龍舟來回競渡，划手的槳一起擺動 ──
  function dragonBoats(ev) {
    const grp = addTo(ev);
    const pts = (ev.path || []).map(([x, z]) => new THREE.Vector3(x, world.groundY(x, z) + 0.035, z));
    if (pts.length < 2) return;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i - 1].distanceTo(pts[i]));
    const total = cum[cum.length - 1];
    const water = basic(0x4f8fbf, { transparent: true, opacity: 0.85 });
    for (let i = 1; i < pts.length; i++) { // 水道：每段一塊扁平藍色長條
      const a = pts[i - 1], b2 = pts[i], m = a.clone().add(b2).multiplyScalar(0.5), len = a.distanceTo(b2);
      mesh("box", water, [m.x, m.y - 0.01, m.z], [0.4, 0.02, len + 0.4], null, [0, Math.atan2(b2.x - a.x, b2.z - a.z), 0]);
      world.addObstacle(ev.district, m.x, m.z, 0.3);
    }
    ev.focus = pts[Math.floor(pts.length / 2)].clone();
    const at = (d, lane) => { // 路線上距離 d、往旁邊偏 lane 的位置與方向
      d = Math.max(0, Math.min(total, d));
      let i = 0; while (i < cum.length - 2 && d > cum[i + 1]) i++;
      const a = pts[i], b2 = pts[i + 1], t = (d - cum[i]) / (cum[i + 1] - cum[i] || 1);
      const dx = b2.x - a.x, dz = b2.z - a.z, L = Math.hypot(dx, dz) || 1;
      return { x: a.x + dx * t - (dz / L) * lane, y: a.y + (b2.y - a.y) * t, z: a.z + dz * t + (dx / L) * lane, yaw: Math.atan2(dx, dz) };
    };
    const boats = [0xb8412f, 0x2f74b5, 0x3f9a6b].map((color, k) => {
      const b = new THREE.Group(); grp.add(b);
      mesh("box", std(color), [0, 0.03, 0], [0.12, 0.05, 0.75], b); // 船身
      mesh("cone", std(0xd9a441), [0, 0.08, 0.42], [0.08, 0.14, 0.08], b, [Math.PI / 2, 0, 0]); // 龍頭
      mesh("cone", std(color), [0, 0.06, -0.42], [0.06, 0.1, 0.06], b, [-Math.PI / 2, 0, 0]); // 龍尾
      mesh("cyl", std(0x8a6a4a), [0, 0.1, 0.32], [0.05, 0.06, 0.05], b); // 鼓
      const oars = [];
      for (let i = 0; i < 6; i++) {
        const z = -0.27 + i * 0.1, side = i % 2 ? 1 : -1;
        mesh("sphere", std(0xf3d2b8), [side * 0.03, 0.1, z], [0.045, 0.045, 0.045], b); // 划手
        const o = new THREE.Group(); o.position.set(side * 0.07, 0.07, z); b.add(o);
        mesh("box", std(0x5a3a2a), [side * 0.06, -0.02, 0], [0.12, 0.01, 0.02], o);
        oars.push(o);
      }
      return { b, oars, lane: (k - 1) * 0.13, speed: 0.55 + k * 0.06, d: k * 0.2, dir: 1, wait: 0 };
    });
    let t = 0;
    updaters.push((dt, night, speedMul) => {
      if (!grp.visible) return;
      t += dt;
      for (const bt of boats) {
        if (bt.wait > 0) bt.wait -= dt;
        else {
          bt.d += bt.dir * bt.speed * Math.min(1.5, speedMul) * dt;
          if (bt.d >= total || bt.d <= 0) { bt.d = Math.max(0, Math.min(total, bt.d)); bt.dir *= -1; bt.wait = 2.5; } // 到終點停一下再划回去
        }
        const p = at(bt.d, bt.lane);
        bt.b.position.set(p.x, p.y, p.z);
        bt.b.rotation.y = p.yaw + (bt.dir < 0 ? Math.PI : 0);
        const stroke = bt.wait > 0 ? 0 : Math.sin(t * 7);
        bt.oars.forEach((o) => { o.rotation.y = stroke * 0.5; });
      }
    });
  }

  // ── 農產市集（芒果、文旦、鳳梨、咖啡）：三個攤位、攤上堆著特產（ev.fruit 顏色），咖啡節會冒熱氣 ──
  function market(ev) {
    if (ev.steam !== false) return steamFair(ev, ev.fruit);
    const grp = addTo(ev);
    const at = spotNear(ev, 1.2);
    ev.focus = at;
    stalls(at, ev.fruit);
    world.addObstacle(ev.district, at.x, at.z, 0.8);
    grp.userData.fruit = ev.fruit;
  }
  function stalls(at, fruit) {
    for (let i = 0; i < 3; i++) {
      const x = at.x + (i - 1) * 0.36, y = world.groundY(x, at.z);
      mesh("box", std(0xb48560), [x, y + 0.12, at.z], [0.28, 0.22, 0.24]);
      mesh("cone", std([0xdb6a41, 0xfcea8b, 0x3f9a6b][i]), [x, y + 0.3, at.z], [0.36, 0.12, 0.36]);
      if (fruit) for (let k = 0; k < 4; k++) mesh("sphere", std(parseInt(fruit.slice(1), 16)), [x - 0.06 + (k % 2) * 0.12, y + 0.26 + (k > 1 ? 0.04 : 0), at.z + 0.06 - (k % 2) * 0.02], [0.08, 0.07, 0.08]); // 攤上的特產
      else mesh("sphere", basic(0xff6b3d), [x, y + 0.42, at.z], [0.06, 0.07, 0.06]);
    }
  }

  // ── 蘭展：發光的展覽溫室與成排蘭花 ──
  function orchid(ev) {
    const grp = addTo(ev);
    const at = spotNear(ev, 1.3);
    const ry = Math.atan2(ev.hub.x - at.x, ev.hub.z - at.z);
    const b = new THREE.Group(); b.position.copy(at); b.rotation.y = ry; grp.add(b);
    mesh("box", basic(0xdff3ec, { transparent: true, opacity: 0.55 }), [0, 0.32, 0], [1.3, 0.6, 0.8], b); // 玻璃展館
    mesh("box", std(0x211d1d), [0, 0.63, 0], [1.34, 0.03, 0.84], b);
    for (const x of [-0.6, -0.2, 0.2, 0.6]) mesh("box", std(0x211d1d), [x, 0.32, 0.41], [0.02, 0.6, 0.02], b);
    for (let i = 0; i < 12; i++) { const x = -0.5 + (i % 6) * 0.2, z = i < 6 ? -0.18 : 0.18; mesh("cyl", std(0x5f8f4a), [x, 0.12, z], [0.03, 0.22, 0.03], b); mesh("sphere", basic([0xff5fa2, 0xfff1a8, 0xffffff, 0xb57bff, 0xff8c42][i % 5]), [x, 0.26, z], [0.09, 0.07, 0.09], b); } // 蘭花
    mesh("box", basic(0xffffff), [0, 0.5, 0.42], [0.6, 0.1, 0.01], b); // 招牌
    world.addObstacle(ev.district, at.x, at.z, 0.9);
  }

  // ── 溫泉美食節：蒸氣與美食攤位 ──
  function steamFair(ev, fruit = null) {
    const grp = addTo(ev);
    const c = ev.pos, puffs = [];
    for (let i = 0; i < 8; i++) {
      const x = c.x + (rnd() - 0.5) * 0.6, z = c.z + (rnd() - 0.5) * 0.6;
      puffs.push(mesh("sphere", basic(0xf5efe6, { transparent: true, opacity: 0.45 }), [x, world.groundY(x, z) + 0.2 + i * 0.12, z], [0.14, 0.14, 0.14]));
    }
    const at = spotNear(ev, 1.2);
    stalls(at, fruit);
    world.addObstacle(ev.district, at.x, at.z, 0.8);
    let t = 0;
    updaters.push((dt) => { if (!grp.visible) return; t += dt; puffs.forEach((p, i) => { p.position.y += dt * 0.25; const k = 0.1 + (p.position.y - world.groundY(c.x, c.z)) * 0.1; p.scale.set(k, k, k); p.material.opacity = Math.max(0, 0.5 - (p.position.y - world.groundY(c.x, c.z) - 0.2) * 0.25); if (p.position.y > world.groundY(c.x, c.z) + 2.2) p.position.y = world.groundY(c.x, c.z) + 0.2; }); });
  }

  // ── 燒王船 ──
  function boat(ev) {
    const g = addTo(ev);
    const at = spotNear(ev, 1.3);
    ev.focus = at;
    world.addObstacle(ev.district, at.x, at.z, 1.0);
    const ry = rnd() * Math.PI;
    const b = new THREE.Group();
    b.position.copy(at); b.rotation.y = ry; g.add(b);
    mesh("box", std(0xb8412f), [0, 0.16, 0], [0.4, 0.22, 1.1], b); // 船身
    mesh("box", std(0xd9a441), [0, 0.3, 0], [0.44, 0.04, 1.14], b);
    mesh("cone", std(0xb8412f), [0, 0.3, 0.62], [0.3, 0.3, 0.3], b, [Math.PI / 2, 0, 0]); // 船首
    mesh("box", std(0x7a4a36), [0, 0.42, 0.2], [0.3, 0.2, 0.36], b); // 艙房
    mesh("cyl", std(0x5a3a2a), [0, 0.75, -0.1], [0.03, 0.9, 0.03], b); // 桅杆
    mesh("box", std(0xfff1c9), [0, 0.8, -0.1], [0.02, 0.5, 0.4], b); // 帆
    for (const z of [-0.4, 0.5]) mesh("sphere", basic(0xff6b3d), [0, 0.5, z], [0.08, 0.1, 0.08], b); // 燈籠
    // 火焰與煙
    const flames = [], smokes = [];
    for (let i = 0; i < 10; i++) flames.push(mesh("sphere", basic([0xff5a1f, 0xffa43d, 0xfff1a8][i % 3]), [(rnd() - 0.5) * 0.3, 0.35, (rnd() - 0.5) * 0.9], [0.1, 0.14, 0.1], b));
    for (let i = 0; i < 6; i++) smokes.push(mesh("sphere", basic(0x55575c, { transparent: true, opacity: 0.35 }), [(rnd() - 0.5) * 0.3, 0.6 + i * 0.25, (rnd() - 0.5) * 0.6], [0.12, 0.12, 0.12], b));
    let t = 0;
    updaters.push((dt) => {
      if (!g.visible) return;
      t += dt;
      flames.forEach((f, i) => { const k = 0.8 + Math.sin(t * 9 + i * 1.7) * 0.35; f.scale.set(0.1 * k, 0.16 * k + Math.sin(t * 13 + i) * 0.03, 0.1 * k); f.position.y = 0.36 + Math.sin(t * 7 + i) * 0.02; });
      smokes.forEach((s, i) => { s.position.y += dt * 0.35; const k = 0.08 + (s.position.y - 0.6) * 0.12; s.scale.set(k, k, k); s.material.opacity = Math.max(0, 0.4 - (s.position.y - 0.6) * 0.18); if (s.position.y > 2.6) s.position.y = 0.6; });
    });
  }

  // ── 蜈蚣陣 ──
  function centipede(ev) {
    const g = addTo(ev);
    const center = ev.pos;
    let radius = 1.3;
    const onLoop = (r) => { for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; if (!world.onLand(center.x + Math.cos(a) * r, center.z + Math.sin(a) * r)) return false; } return true; };
    while (radius > 0.9 && !onLoop(radius)) radius -= 0.1;
    world.addObstacle(ev.district, center.x, center.z, radius + 0.35);
    const N = 20, spacing = 0.3, segs = [];
    const skin = std(0xf3d2b8), platform = std(0xb8412f), gold = std(0xd9a441);
    for (let i = 0; i < N; i++) {
      const s = new THREE.Group();
      g.add(s);
      if (i === 0) { // 龍頭
        mesh("cone", platform, [0, 0.22, 0.12], [0.26, 0.3, 0.26], s, [Math.PI / 2, 0, 0]);
        mesh("sphere", basic(0xfcea8b), [0.06, 0.3, 0.1], [0.05, 0.05, 0.05], s); mesh("sphere", basic(0xfcea8b), [-0.06, 0.3, 0.1], [0.05, 0.05, 0.05], s);
        mesh("box", gold, [0, 0.4, 0], [0.06, 0.16, 0.04], s, [0.3, 0, 0.4]); mesh("box", gold, [0, 0.4, 0], [0.06, 0.16, 0.04], s, [0.3, 0, -0.4]);
      } else if (i === N - 1) { // 鳳尾
        mesh("cone", gold, [0, 0.22, -0.12], [0.2, 0.36, 0.1], s, [-Math.PI / 2, 0, 0]);
      }
      mesh("box", platform, [0, 0.12, 0], [0.24, 0.05, 0.24], s); // 平台
      for (const x of [-0.08, 0.08]) { // 兩名扛陣的人
        mesh("cyl", std([0x4a7fc1, 0xdb6a41, 0x3f9a6b][i % 3]), [x, 0.07, -0.14], [0.06, 0.14, 0.06], s);
        mesh("sphere", skin, [x, 0.17, -0.14], [0.07, 0.07, 0.07], s);
      }
      mesh("cyl", std([0xfcea8b, 0xff6b3d, 0x7a6fb5][i % 3]), [0, 0.2, 0], [0.07, 0.12, 0.07], s); // 坐在平台上的孩童
      mesh("sphere", skin, [0, 0.3, 0], [0.08, 0.08, 0.08], s);
      mesh("box", gold, [0, 0.38, 0], [0.1, 0.06, 0.02], s); // 頭冠
      if (i % 4 === 0) mesh("sphere", basic(0xff6b3d), [0.14, 0.34, 0], [0.05, 0.06, 0.05], s); // 燈籠
      segs.push(s);
    }
    let t = 0;
    const speed = 0.45 / radius;
    updaters.push((dt, night, speedMul) => {
      if (!g.visible) return;
      t += dt * speed * Math.min(1.2, speedMul);
      segs.forEach((s, i) => {
        const a = t - (i * spacing) / radius;
        const sx = center.x + Math.cos(a) * radius, sz = center.z + Math.sin(a) * radius;
        s.position.set(sx, world.groundY(sx, sz) + Math.abs(Math.sin(t * 6 + i)) * 0.01, sz);
        s.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a)) + Math.PI / 2 - Math.PI; // 面向前進方向
      });
    });
  }

  // ── 西拉雅太祖夜祭（大內頭社）：夜裡公廨前點篝火，族人牽手圍成圈跳舞唱歌 ──
  function nightRitual(ev) {
    const g = addTo(ev);
    const c = ev.pos, cy = c.y;
    // 圍圈半徑：先檢查整圈都踩得到陸地，踩不到就縮小（比照蜈蚣陣）
    let radius = 0.9;
    const onLoop = (r) => { for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; if (!world.onLand(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r)) return false; } return true; };
    while (radius > 0.5 && !onLoop(radius)) radius -= 0.1;
    world.addObstacle(ev.district, c.x, c.z, radius + 0.4);
    // 篝火：底下一圈深色石頭、交叉的柴薪
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; mesh("sphere", std(0x4a4542), [c.x + Math.cos(a) * 0.2, cy + 0.03, c.z + Math.sin(a) * 0.2], [0.08, 0.05, 0.08]); }
    for (let i = 0; i < 3; i++) mesh("cyl", std(0x5a3a2a), [c.x, cy + 0.05, c.z], [0.03, 0.3, 0.03], null, [Math.PI / 2.4, (i / 3) * Math.PI, 0]);
    // 火焰：橘黃 glow 球疊起來，更新時會閃爍
    const flames = [];
    for (let i = 0; i < 7; i++) flames.push(mesh("sphere", basic([0xff5a1f, 0xffa43d, 0xfff1a8][i % 3]), [c.x + (rnd() - 0.5) * 0.12, cy + 0.1 + i * 0.05, c.z + (rnd() - 0.5) * 0.12], [0.1, 0.14, 0.1]));
    // 火星：往上飄的小粒子，飄到頂就回到火堆重來
    const sparks = [];
    for (let i = 0; i < 12; i++) {
      const m = mesh("sphere", basic(0xffc46b, { transparent: true, opacity: 0.9 }), [c.x, cy + 0.3 + rnd() * 0.9, c.z], [0.025, 0.025, 0.025]);
      sparks.push({ m, vy: 0.35 + rnd() * 0.3, phase: rnd() * 6, dx: (rnd() - 0.5) * 0.2, dz: (rnd() - 0.5) * 0.2 });
    }
    // 祀壺：小圓柱壺身 + 細頸，壺口插一枝澤蘭；立在火旁，踩不到陸地就放火堆邊
    let px = c.x + 0.35, pz = c.z + 0.1;
    if (!world.onLand(px, pz)) { px = c.x + 0.25; pz = c.z; }
    const py = world.groundY(px, pz);
    mesh("cyl", std(0xb48560), [px, py + 0.06, pz], [0.1, 0.12, 0.1]);
    mesh("cyl", std(0x8a6a4a), [px, py + 0.15, pz], [0.05, 0.06, 0.05]);
    mesh("sphere", std(0x5f8f4a), [px, py + 0.21, pz], [0.05, 0.06, 0.05]);
    // 兩根竹竿掛著紅黃綵帶
    const ribbons = [];
    for (const side of [-1, 1]) {
      const bx = c.x + side * 0.5, bz = c.z - 0.25, by = world.groundY(bx, bz);
      mesh("cyl", std(0x8aa36b), [bx, by + 0.5, bz], [0.02, 1.0, 0.02]);
      for (let k = 0; k < 3; k++) ribbons.push({ m: mesh("box", std(k % 2 ? 0xfcea8b : 0xb8412f), [bx + side * 0.04, by + 0.9 - k * 0.2, bz], [0.04, 0.16, 0.01]), phase: rnd() * 6 + k });
    }
    // 圍圈的人：12 位簡化人形，衣服白、紅、黑三色交替（象徵西拉雅服飾），手臂橫伸象徵牽手
    const N = 12, dancers = [];
    const skin = std(0xf3d2b8);
    for (let i = 0; i < N; i++) {
      const s = new THREE.Group(); g.add(s);
      mesh("box", std([0xffffff, 0xb8412f, 0x211d1d][i % 3]), [0, 0.1, 0], [0.1, 0.2, 0.08], s); // 身體
      mesh("sphere", skin, [0, 0.25, 0], [0.08, 0.08, 0.08], s); // 頭
      mesh("box", skin, [0, 0.17, 0], [0.4, 0.025, 0.025], s); // 兩臂橫伸，與鄰人牽手
      dancers.push(s);
    }
    let t = 0, ang = 0;
    updaters.push((dt, night, speedMul) => {
      if (!g.visible) return;
      t += dt;
      // 白天（night < 0.3）火光與火星縮到幾乎看不見，入夜後逐漸亮起
      const glow = 0.08 + 0.92 * Math.max(0, Math.min(1, (night - 0.3) / 0.4));
      flames.forEach((f, i) => { const k = (0.8 + Math.sin(t * 9 + i * 1.7) * 0.35) * glow; f.scale.set(0.1 * k, (0.16 + Math.sin(t * 13 + i) * 0.03) * k, 0.1 * k); f.position.y = cy + 0.1 + i * 0.05 + Math.sin(t * 7 + i) * 0.02; });
      for (const s of sparks) {
        s.m.position.y += s.vy * dt;
        if (s.m.position.y > cy + 1.3) s.m.position.y = cy + 0.3;
        const h = s.m.position.y - cy;
        s.m.position.x = c.x + s.dx * h + Math.sin(t * 2 + s.phase) * 0.05; s.m.position.z = c.z + s.dz * h + Math.cos(t * 1.7 + s.phase) * 0.05;
        s.m.scale.setScalar(0.025 * glow);
        s.m.material.opacity = glow * Math.max(0, 1 - (h - 0.3));
      }
      ribbons.forEach((r) => { r.m.rotation.z = Math.sin(t * 2 + r.phase) * 0.2; });
      // 族人沿圓逆時針（從上往下看）慢慢繞，同時上下微彈跳
      ang -= dt * 0.25 * Math.min(1.2, speedMul);
      dancers.forEach((s, i) => {
        const a = ang + (i / N) * Math.PI * 2;
        const x = c.x + Math.cos(a) * radius, z = c.z + Math.sin(a) * radius;
        s.position.set(x, world.groundY(x, z) + Math.abs(Math.sin(t * 4 + i * 0.5)) * 0.04, z);
        s.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a)); // 面向篝火
      });
    });
  }

  const pickables = [], list = [];
  for (const ev of events) {
    const e = { ...ev, pos: new THREE.Vector3(ev.pos[0], world.groundY(ev.pos[0], ev.pos[1]), ev.pos[1]), hub: new THREE.Vector3(ev.hub[0], world.groundY(ev.hub[0], ev.hub[1]), ev.hub[1]) };
    list.push(e);
    if (e.toPos) { e.toPos = new THREE.Vector3(e.toPos[0], world.groundY(e.toPos[0], e.toPos[1]), e.toPos[1]); }
    if (e.effect === "fireworks") fireworks(e);
    else if (e.effect === "bigfireworks") bigFireworks(e);
    else if (e.effect === "boat") boat(e);
    else if (e.effect === "centipede") centipede(e);
    else if (e.effect === "lanterns") lanterns(e);
    else if (e.effect === "hilllights") hillLights(e);
    else if (e.effect === "beachstage") beachStage(e);
    else if (e.effect === "procession") procession(e);
    else if (e.effect === "kapok") kapok(e);
    else if (e.effect === "treecolor") treeColor(e, parseInt((e.color || "#e8562a").slice(1), 16));
    else if (e.effect === "lotus") lotus(e);
    else if (e.effect === "fireflies") fireflies(e);
    else if (e.effect === "birds") birds(e);
    else if (e.effect === "paddy") paddy(e);
    else if (e.effect === "orchid") orchid(e);
    else if (e.effect === "steamfair") steamFair(e);
    else if (e.effect === "nightritual") nightRitual(e);
    else if (e.effect === "ceremony") ceremony(e);
    else if (e.effect === "dragonboats") dragonBoats(e);
    else if (e.effect === "market") market(e);
    const hb = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 2.6), new THREE.MeshBasicMaterial());
    hb.position.set(e.pos.x, e.pos.y + 0.6, e.pos.z);
    hb.visible = false;
    hb.userData = { type: "event", id: e.id };
    scene.add(hb);
    pickables.push(hb);
  }

  function update(dt, night, speedMul = 1) { if (group.visible) for (const u of updaters) u(dt, night, speedMul); }
  function setVisible(v) { group.visible = v; }
  // 目前看得見的效果種類（給聲音層用；會配置陣列，不要每幀呼叫）
  function activeKinds() { const s = new Set(); if (group.visible) for (const e of list) if (groupOf.get(e.id)?.visible) s.add(e.effect); return [...s]; }
  function setActive(id, on, index = 0) {
    const g = groupOf.get(id);
    if (!g) return;
    const was = g.visible;
    g.visible = on;
    g.userData.onActive?.(on);
    if (on && !was) g.userData.setDirection?.(index);
  }
  return { update, setVisible, setActive, activeKinds, events: list, pickables };
}
