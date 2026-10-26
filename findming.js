// 找找阿明：一位戴紅毛帽、穿紅白條紋衣、戴圓眼鏡的市民，每天（依本機日期）藏在固定的一區散步，同一天大家找的是同一個地方。
// 開始後面板依序揭露三個線索（0／30／60 秒）：住區特產（市區沒有特產就說是舊台南市區）→ 附近的地標 → 區號。
// 點到他就過關，記下秒數；每天的成績與連續天數存 localStorage。遊戲沒開始時阿明不出現。
// createFindMing({ THREE, scene, world, islands, specData, t, esc, toast, onGiveUp, onFound })
//   → { button(container), update(dt), pickables, found(), get active }
const KEY = "hexcity-ming", CLUE_AT = [0, 30, 60], URBAN = new Set(["中西區", "東區", "南區", "北區", "安平區", "安南區"]);

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

export function createFindMing({ THREE, scene, world, islands, specData, t, esc, toast, onGiveUp, onFound }) {
  // ── 阿明的模型：比一般行人略大一點，條紋衣用五段紅白圓柱 ──
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body); g.visible = false; scene.add(g);
  const std = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const part = (geo, mat, pos, sc) => { const m = new THREE.Mesh(geo, mat); m.position.set(...pos); m.scale.set(...sc); m.castShadow = true; m.userData = { type: "ming" }; body.add(m); return m; };
  const cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12), sph = new THREE.SphereGeometry(0.5, 12, 9), tor = new THREE.TorusGeometry(0.5, 0.12, 6, 14);
  const red = std(0xd8342c), white = std(0xffffff), skin = std(0xf3d2b8), blue = std(0x2f4f8f), ink = std(0x211d1d);
  const legs = [-0.045, 0.045].map((x) => part(cyl, blue, [x, 0.09, 0], [0.065, 0.18, 0.065]));
  for (let i = 0; i < 5; i++) part(cyl, i % 2 ? white : red, [0, 0.2 + i * 0.03, 0], [0.19 - Math.abs(i - 2) * 0.012, 0.03, 0.16]); // 條紋衣
  part(sph, skin, [0, 0.42, 0], [0.24, 0.23, 0.23]); // 頭
  part(sph, red, [0, 0.5, 0], [0.25, 0.16, 0.25]); // 毛帽
  part(sph, white, [0, 0.6, 0], [0.07, 0.07, 0.07]); // 帽球
  for (const x of [-0.05, 0.05]) part(tor, ink, [x, 0.43, 0.115], [0.05, 0.05, 0.05]); // 圓眼鏡
  part(cyl, red, [0.13, 0.36, 0], [0.012, 0.3, 0.012]); // 手杖（好認）
  const pickables = body.children;

  // ── 今天的位置：依日期決定區與起點，散步範圍限在起點附近（線索的地標才準）──
  const ids = [...islands.keys()];
  const day = today(), rnd = seeded(hash("ming|" + day));
  const district = ids[hash(day) % ids.length], isl = islands.get(district);
  const home = world.randomPoint(district, rnd);
  const pos = home.clone(), target = home.clone();
  let wait = 0;
  // 線索 2 用離起點最近的建築
  const nearB = isl.buildings.map((b) => ({ b, p: world.buildingPos.get(b.id) })).filter((x) => x.p).sort((a, c) => a.p.distanceTo(home) - c.p.distanceTo(home))[0]?.b;
  const spec = (specData.byDistrict[district] || [])[0];
  const clues = [
    spec ? t("ming.clue.spec", "他住的那一區以「{spec}」出名。", { spec: spec.name }) : URBAN.has(isl.name_zh ?? isl.name) ? t("ming.clue.urban", "他在舊台南市的市區，附近很熱鬧。") : t("ming.clue.rural", "他在比較鄉下的地方散步。"),
    nearB ? t("ming.clue.near", "他身邊不遠處有「{name}」。", { name: nearB.name }) : t("ming.clue.near_none", "他在區中心附近晃。"),
    t("ming.clue.number", "他在第 {n} 號區（地圖上區名前的數字）。", { n: isl.number }),
  ];

  let rec = {};
  try { rec = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch {} };
  let state = null; // { t, shown }
  let btn, panel;

  function button(container) {
    btn = document.createElement("button");
    btn.type = "button"; btn.dataset.play = "ming";
    btn.textContent = t("ming.btn", "🔍 找找阿明");
    btn.addEventListener("click", () => open());
    container.appendChild(btn);
    panel = document.createElement("div");
    panel.className = "stamps quiz ming"; panel.hidden = true; panel.setAttribute("role", "dialog");
    document.querySelector("#app").appendChild(panel);
    panel.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) close();
      else if (e.target.closest("[data-ming-start]")) start();
      else if (e.target.closest("[data-ming-give]")) giveUp();
    });
  }
  const head = (sub = "") => `<div class="stamps-head"><b>${esc(t("ming.title", "🔍 找找阿明"))}</b><span>${sub}</span><button type="button" data-close aria-label="${esc(t("card.close", "關閉（Esc）"))}">×</button></div>`;
  const doneToday = () => rec.days?.[day];
  function streak() { // 連續完成天數（含今天或到昨天為止）
    let n = 0; const d = new Date();
    if (!rec.days?.[day]) d.setDate(d.getDate() - 1);
    for (;;) { const p = (x) => String(x).padStart(2, "0"), k = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; if (!rec.days?.[k]) break; n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function open() {
    panel.hidden = false;
    if (state) return render();
    const done = doneToday();
    panel.innerHTML = `${head(streak() ? esc(t("ming.streak", "連續 {n} 天", { n: streak() })) : "")}
      <div class="ming-face" aria-hidden="true">🧢</div>
      <p>${esc(t("ming.intro", "阿明戴紅毛帽、穿紅白條紋衣、戴圓眼鏡，拿著一根手杖。他每天躲在不同的區散步，同一天大家找的都是同一個地方。"))}</p>
      ${done ? `<p class="quiz-msg">✅ ${esc(t("ming.done_today", "今天已經找到了，花了 {s} 秒。明天他會換地方。", { s: done }))}</p>` : ""}
      <p><button type="button" class="chip act" data-ming-start>${esc(done ? t("ming.again", "再找一次") : t("ming.start", "開始找"))}</button></p>`;
  }
  function close() { panel.hidden = true; }
  function start() {
    state = { t: 0, shown: 1 };
    g.visible = true; pos.copy(home); target.copy(home); wait = 0;
    render();
  }
  function render() {
    if (!state) return;
    panel.innerHTML = `${head(esc(t("ming.timer", "{s} 秒", { s: Math.floor(state.t) })))}
      <ol class="ming-clues">${clues.slice(0, state.shown).map((c) => `<li>${esc(c)}</li>`).join("")}</ol>
      ${state.shown < 3 ? `<p class="muted">${esc(t("ming.next_clue", "{s} 秒後給下一個線索", { s: Math.max(0, Math.ceil(CLUE_AT[state.shown] - state.t)) }))}</p>` : ""}
      <p class="muted">${esc(t("ming.how", "拉近畫面在人群裡找，點到他就過關。"))}</p>
      <p><button type="button" class="chip" data-ming-give>${esc(t("ming.give", "放棄，看他在哪"))}</button></p>`;
  }
  function found() {
    if (!state) return false;
    const s = Math.max(1, Math.round(state.t));
    rec.days = rec.days || {};
    const first = !rec.days[day];
    if (first || s < rec.days[day]) rec.days[day] = s;
    rec.best = Math.min(rec.best || Infinity, s);
    save();
    state = null;
    panel.hidden = false;
    panel.innerHTML = `${head(esc(t("ming.streak", "連續 {n} 天", { n: streak() })))}
      <p class="quiz-q">🎉 ${esc(t("ming.found", "找到阿明了！花了 {s} 秒。", { s }))}</p>
      <p class="muted">${esc(t("ming.best", "最快紀錄 {s} 秒", { s: rec.best }))} · ${esc(t("ming.where", "他今天在{name}", { name: isl.name }))}</p>
      <p class="muted">${esc(t("ming.tomorrow", "明天他會換一區，記得回來找。"))}</p>`;
    toast?.(t("ming.found_toast", "找到阿明了！"));
    onFound?.({ seconds: s, first });
    setTimeout(() => { if (!state) g.visible = false; }, 4000);
    return true;
  }
  function giveUp() {
    if (!state) return;
    state = null;
    panel.innerHTML = `${head()}<p>${esc(t("ming.gave_up", "阿明在{name}，鏡頭帶你過去看他。", { name: isl.name }))}</p>
      <p><button type="button" class="chip act" data-ming-start>${esc(t("ming.again", "再找一次"))}</button></p>`;
    onGiveUp?.(pos.clone());
    setTimeout(() => { if (!state) g.visible = false; }, 8000);
  }

  let tick = 0;
  function update(dt, paused = false) {
    if (!g.visible) return;
    if (paused) dt = 0; // 「暫停」時阿明也停住（計時也停）
    // 散步：到點停 1～3 秒，再往起點附近另一個空地走
    if (wait > 0) wait -= dt;
    else {
      const d = target.distanceTo(pos);
      if (d < 0.03) {
        const next = world.randomPointNear(district, home, rnd);
        if (world.segmentClear(district, pos, next)) target.copy(next);
        wait = 1 + rnd() * 2;
      } else {
        const step = Math.min(d, 0.35 * dt);
        g.rotation.y = Math.atan2(target.x - pos.x, target.z - pos.z);
        pos.addScaledVector(target.clone().sub(pos).normalize(), step);
      }
    }
    const s = 0.75 * world.zoneScale(district); // 跟一般成人行人同大小（市區一樣會縮）
    g.scale.setScalar(s);
    g.position.set(pos.x, world.groundY(pos.x, pos.z), pos.z);
    const swing = wait > 0 || paused ? 0 : Math.sin(performance.now() / 120) * 0.5;
    legs[0].rotation.x = swing; legs[1].rotation.x = -swing;
    if (!state) return;
    state.t += dt;
    const shown = CLUE_AT.filter((x) => state.t >= x).length;
    if ((tick += dt) > 0.5 || shown !== state.shown) { tick = 0; state.shown = shown; if (!panel.hidden) render(); }
  }
  return { button, update, pickables, found, get active() { return !!state; }, get visible() { return g.visible; }, district };
}
