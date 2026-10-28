// 農特產互動：點特產 → 產地各區冒光柱與圖示；「當季」開關 → 每區上空浮出當月產季的特產；特產卡片與一日遊路線。
// 資料：data/specialties.json（區 → 特產）＋ data/spec_seasons.json（特產 → 產季月份、菜籃顏色）。
// createSpecs({ THREE, scene, CSS2DObject, specData, seasons, centers, groundY, t, esc })
//   → { names, info(name), districtsOf(name), inSeason(name, month), seasonalOf(id, month), highlight(name), clear(), setSeasonal(on), setMonth(m), update(dt), cardHtml(name, month, islandBtn) }
const GLOW = 0xffc94d, HOLD = 7; // 光柱顏色、亮幾秒

export function createSpecs({ THREE, scene, CSS2DObject, specData, seasons, centers, groundY, scale: S = 1, t = (k, zh) => zh, esc }) {
  const byName = new Map(); // 名稱 → { name, icon, districts: [id] }
  for (const [id, items] of Object.entries(specData.byDistrict || {})) {
    for (const it of items) {
      const key = it.name_zh ?? it.name; // 翻譯後 name 會被換掉，用原文當 key
      if (!byName.has(key)) byName.set(key, { key, name: it.name, icon: it.icon, districts: [] });
      byName.get(key).districts.push(id);
    }
  }
  const season = (key) => seasons?.byName?.[key] || null;
  const inSeason = (key, month) => !!season(key)?.months?.includes(month);
  const seasonalOf = (id, month) => (specData.byDistrict[id] || []).filter((it) => inSeason(it.name_zh ?? it.name, month));

  // ── 產地高亮：每個產區一根半透明光柱＋上方的特產圖示，脈動幾秒後淡出 ──
  const beamGeo = new THREE.CylinderGeometry(0.55 * S, 0.9 * S, 7 * S, 20, 1, true).translate(0, 3.5 * S, 0); // 產區光柱是給全景看的，跟著地圖放大
  const beamMat = new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const beams = [], tags = [];
  let left = 0, current = null;
  function clear() {
    for (const b of beams) group.remove(b);
    for (const o of tags) { group.remove(o); o.element.remove(); }
    beams.length = tags.length = 0;
    group.visible = false; current = null; left = 0;
  }
  function highlight(key) {
    clear();
    const s = byName.get(key);
    if (!s) return [];
    for (const id of s.districts) {
      const c = centers.get(id);
      if (!c) continue;
      const y = groundY(c.x, c.z);
      const m = new THREE.Mesh(beamGeo, beamMat);
      m.position.set(c.x, y, c.z);
      m.renderOrder = 3;
      group.add(m); beams.push(m);
      const el = document.createElement("div");
      el.className = "spec-beacon";
      el.innerHTML = `<span>${esc(s.icon)}</span>`; // 內層 span 做出現時的放大，外層的 transform 由 CSS2DRenderer 每幀改寫
      const o = new CSS2DObject(el);
      o.position.set(c.x, y + 3.4 * S, c.z);
      group.add(o); tags.push(o);
    }
    group.visible = true; current = key; left = HOLD;
    return s.districts;
  }
  let pulse = 0;
  function update(dt) {
    if (!current) return;
    left -= dt; pulse += dt;
    const fade = Math.min(1, left / 1.2); // 最後 1.2 秒淡出
    beamMat.opacity = Math.max(0, (0.28 + Math.sin(pulse * 4) * 0.08) * fade);
    for (const o of tags) o.element.style.opacity = String(Math.max(0, fade));
    if (left <= 0) clear();
  }

  // ── 當季：每區一個浮在區名上方的小牌，列出這個月當季的特產圖示 ──
  const seasonTags = new Map(); // 區 id → CSS2DObject
  let seasonalOn = false, month = 1;
  for (const id of Object.keys(specData.byDistrict || {})) {
    const c = centers.get(id);
    if (!c) continue;
    const el = document.createElement("button");
    el.className = "season-tag";
    el.dataset.island = id;
    const o = new CSS2DObject(el);
    o.position.set(c.x, groundY(c.x, c.z) + 1.7, c.z); // 跟區名同一點，再用 CSS 往上推到區名正上方
    o.visible = false;
    scene.add(o);
    seasonTags.set(id, o);
  }
  function refreshSeasonal() {
    for (const [id, o] of seasonTags) {
      const list = seasonalOf(id, month);
      o.visible = seasonalOn && list.length > 0;
      o.element.innerHTML = `<span>${esc(list.map((it) => it.icon).join(""))}</span>`; // 內層 span 往上移，避開區名牌
      o.element.title = list.map((it) => it.name).join("、");
    }
  }
  const setSeasonal = (on) => { seasonalOn = !!on; refreshSeasonal(); };
  const setMonth = (m) => { month = m; refreshSeasonal(); };

  // 產季文字：1–12 月全有就說「全年」，否則把連續月份併成區段（11–2 月跨年也併）
  function monthsText(key) {
    const ms = season(key)?.months;
    if (!ms?.length) return "";
    if (ms.length >= 12) return t("spec.all_year", "全年");
    const set = new Set(ms), runs = [];
    let start = ms.find((m) => !set.has(((m + 10) % 12) + 1)) ?? ms[0]; // 找一個前一個月不在產季的月份當起點
    for (let i = 0, m = start, from = null; i < 13; i++, m = (m % 12) + 1) {
      if (set.has(m) && from == null) from = m;
      if (!set.has(m) && from != null) { const to = ((m + 10) % 12) + 1; runs.push(from === to ? t("spec.month", "{m} 月", { m: from }) : t("spec.months", "{a}–{b} 月", { a: from, b: to })); from = null; }
    }
    return runs.join(t("list.separator", "、"));
  }
  function cardHtml(key, m, islandBtn) {
    const s = byName.get(key);
    if (!s) return "";
    const now = inSeason(key, m), sz = season(key);
    return `<div class="eyebrow">${esc(t("spec.eyebrow", "農特產"))}</div><h2>${esc(s.icon)} ${esc(s.name)}${now ? ` <span class="spec-now">${esc(t("spec.now", "當季"))}</span>` : ""}</h2>
      ${sz ? `<p>${esc(t("spec.season", "產季：{months}", { months: monthsText(key) }))}${sz.unsure ? ` <span class="muted">${esc(t("spec.unsure", "（月份待校對）"))}</span>` : ""}</p>` : ""}
      <h3>${esc(t("spec.where", "產地（{n} 區）", { n: s.districts.length }))}</h3><p class="spec-where">${s.districts.map((id) => islandBtn(id)).join(" ")}</p>
      <p><button class="chip act" data-spec-trip="${esc(key)}">${esc(s.districts.length > 1 ? t("spec.trip", "排成一日遊") : t("trip.add", "加入行程"))}</button>
        <button class="chip" data-spec-glow="${esc(key)}">${esc(t("spec.glow", "再亮一次"))}</button></p>
      <p class="muted">${esc(t("spec.hint", "地圖上發光的就是產地；點區名可以飛過去。"))}</p>`;
  }

  return {
    names: [...byName.keys()], info: (key) => byName.get(key) || null, districtsOf: (key) => byName.get(key)?.districts || [], color: (key) => season(key)?.color || "#c9a27a",
    inSeason, seasonalOf, monthsText, highlight, clear, setSeasonal, setMonth, update, cardHtml, get current() { return current; },
  };
}
