// 找獼猴：山區藏著 10 群台灣獼猴（data/scenery.json 的 monkeys），每群幾隻猴子在一棵樹上下跳；點到一群就算找到。
// 只有南化烏山獼猴區是查證過的棲地，其他是依山區分布示意的位置（卡片會註明）。進度存 localStorage，找齊放煙火。
// 「🎮 玩」選單裡的面板只列出各區還剩幾群，不提供直接飛過去（要自己在山裡找）。
// createMonkeys({ THREE, scene, world, data, projection, t, esc, islands, toast, onComplete })
//   → { button(container), update(dt, ctx), pickables, found(id) → 是否新找到, info(id), get count, total }
const KEY = "hexcity-monkeys";

export function createMonkeys({ THREE, scene, world, data, projection: P, scale: S = 1, t, esc, islands, toast, onComplete }) {
  const toWorld = (lat, lon) => ({ x: (lon - P.lon_c) * P.km_x * P.k, z: -(lat - P.lat_c) * P.km_z * P.k });
  const gy = (x, z) => world.groundY(x, z);
  const fur = new THREE.MeshStandardMaterial({ color: 0x8a7a63, roughness: 0.9 }), face = new THREE.MeshStandardMaterial({ color: 0xe8a28c, roughness: 0.8 });
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 }), leafM = new THREE.MeshStandardMaterial({ color: 0x3f6f3a, roughness: 0.9 });
  const G = { box: new THREE.BoxGeometry(1, 1, 1), sphere: new THREE.SphereGeometry(0.5, 10, 8), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 8) };
  const part = (g, m, pos, sc, parent) => { const o = new THREE.Mesh(G[g], m); o.position.set(...pos); o.scale.set(...sc); o.castShadow = true; parent.add(o); return o; };
  function monkey() { // 坐姿：身體、頭、紅臉、尾巴
    const g = new THREE.Group();
    part("sphere", fur, [0, 0.035, 0], [0.05, 0.06, 0.045], g);
    part("sphere", fur, [0, 0.08, 0.01], [0.04, 0.04, 0.04], g);
    part("sphere", face, [0, 0.078, 0.028], [0.026, 0.024, 0.012], g);
    part("cyl", fur, [0, 0.02, -0.035], [0.008, 0.05, 0.008], g).rotation.x = 0.9;
    return g;
  }
  let got = new Set();
  try { got = new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...got])); } catch {} };

  const troops = [], pickables = [];
  for (const tr of data.troops) {
    let { x, z } = toWorld(...tr.at);
    // 貼回陸地，避開建築與道路附近
    let ok = world.onLand(x, z) && world.isClear(x, z, 0.4);
    for (let r = 0.15; !ok && r <= 3 * S; r += 0.15) for (let k = 0; k < 16 && !ok; k++) { const a = (k / 16) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (world.onLand(px, pz) && world.isClear(px, pz, 0.4)) { x = px; z = pz; ok = true; } }
    const district = world.districtAt(x, z);
    const g = new THREE.Group(); g.position.set(x, gy(x, z), z); scene.add(g);
    part("cyl", trunkM, [0, 0.14, 0], [0.04, 0.28, 0.04], g);
    part("cyl", trunkM, [0.06, 0.2, 0], [0.015, 0.14, 0.015], g).rotation.z = -0.8; // 樹枝
    part("sphere", leafM, [0, 0.33, 0], [0.32, 0.2, 0.3], g);
    const ms = [];
    const seats = [[0.11, 0.24, 0.02], [-0.12, 0.0, 0.08], [0.06, 0.0, -0.12], [-0.05, 0.4, 0.05]];
    seats.forEach((p, i) => { const m = monkey(); m.position.set(...p); g.add(m); ms.push({ m, base: p[1], phase: i * 1.7 }); });
    const hb = new THREE.Mesh(G.box, new THREE.MeshBasicMaterial()); // 點擊範圍比猴子大很多，才點得到
    hb.position.set(x, gy(x, z) + 0.25, z); hb.scale.set(0.7, 0.6, 0.7); hb.visible = false;
    hb.userData = { type: "monkey", id: tr.id };
    scene.add(hb); pickables.push(hb);
    troops.push({ ...tr, x, z, district, g, ms });
  }
  const total = troops.length;
  let btn, panel;
  function button(container) {
    btn = document.createElement("button");
    btn.type = "button"; btn.dataset.play = "monkeys";
    container.appendChild(btn);
    panel = document.createElement("div");
    panel.className = "stamps monkeys"; panel.hidden = true; panel.setAttribute("role", "dialog");
    document.querySelector("#app").appendChild(panel);
    btn.addEventListener("click", () => { panel.hidden = false; render(); });
    panel.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) panel.hidden = true;
      else if (e.target.closest("[data-reset]")) { got.clear(); save(); render(); toast?.(t("monkey.reset_done", "找獼猴已重設")); }
    });
    render();
  }
  function render() {
    if (!btn) return;
    btn.textContent = t("monkey.btn", "🐒 找獼猴 {n}/{total}", { n: got.size, total });
    if (!panel || panel.hidden) return;
    const by = new Map(); // 區 → [找到, 總數]
    for (const tr of troops) { const k = tr.district; if (!by.has(k)) by.set(k, [0, 0]); const v = by.get(k); v[1]++; if (got.has(tr.id)) v[0]++; }
    const rows = [...by].sort((a, b) => (islands.get(a[0])?.number ?? 99) - (islands.get(b[0])?.number ?? 99))
      .map(([id, [n, all]]) => `<li><b style="--c:${islands.get(id)?.color || "#999"}">${esc(islands.get(id)?.name || "")}</b> ${"🐒".repeat(n)}${"·".repeat(all - n)} <span class="muted">${n}/${all}</span></li>`).join("");
    panel.innerHTML = `<div class="stamps-head"><b>${esc(t("monkey.title", "🐒 找台灣獼猴"))}</b><span>${got.size} / ${total}</span><button type="button" data-close aria-label="${esc(t("card.close", "關閉（Esc）"))}">×</button></div>
      <p class="muted">${esc(t("monkey.hint", "台灣獼猴群居在低海拔山區。拉近東邊的山，找樹上的猴群，點到就算找到。下面是各區還藏著幾群。"))}</p>
      <ul class="monkey-list">${rows}</ul>
      <div class="stamps-foot"><button type="button" class="chip" data-reset>${esc(t("stamps.reset", "重設"))}</button></div>`;
  }
  function found(id) {
    if (got.has(id) || !troops.some((tr) => tr.id === id)) return false;
    got.add(id); save(); render();
    toast?.(t("monkey.found", "找到一群台灣獼猴！（{n}/{total}）", { n: got.size, total }));
    if (got.size === total) onComplete?.();
    return true;
  }
  const info = (id) => { const tr = troops.find((x) => x.id === id); return tr && { id, verified: !!tr.verified, district: tr.district, found: got.has(id), pos: new THREE.Vector3(tr.x, gy(tr.x, tr.z), tr.z) }; };
  let time = 0;
  function update(dt, ctx = {}) {
    time += dt;
    const awake = ctx.minute == null || (ctx.minute >= 330 && ctx.minute <= 1110); // 晚上回樹上休息（不跳）
    for (const tr of troops) for (const m of tr.ms) {
      const hop = awake ? Math.max(0, Math.sin(time * 3 + m.phase)) * 0.05 : 0;
      m.m.position.y = m.base + hop;
      m.m.rotation.y = Math.sin(time * 0.7 + m.phase) * 0.8;
    }
  }
  return { button, update, pickables, found, info, get count() { return got.size; }, total };
}
