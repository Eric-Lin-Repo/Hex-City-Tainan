// 多語言：中（預設）／英／日。做法是「資料覆蓋」——載入後把翻譯直接寫進 islands、poi、events… 的 name/desc 欄位，
// 所以卡片與清單不用改；介面字串則用 t(key, 中文預設, 變數) 取翻譯，沒有翻譯就顯示中文。
// 語言來源：網址 ?lang=en|ja → localStorage → 瀏覽器語言（只在第一次）；切換語言會重新載入頁面。
const LANGS = { zh: "中", en: "EN", ja: "日" };
const KEY = "hexcity-lang";

export function detectLang(params) {
  const q = params.get("lang");
  if (q && LANGS[q]) return q;
  try { const s = localStorage.getItem(KEY); if (s && LANGS[s]) return s; } catch {}
  const nav = (navigator.language || "").toLowerCase();
  return nav.startsWith("ja") ? "ja" : nav.startsWith("en") ? "en" : "zh";
}

export async function createI18n(lang, loadJson) {
  let ui = {}, data = {};
  if (lang !== "zh") {
    try {
      let extra = {};
      [ui, data, extra] = await Promise.all([loadJson(`./data/i18n/ui.${lang}.json`), loadJson(`./data/i18n/data.${lang}.json`), loadJson(`./data/i18n/ui2.${lang}.json`).catch(() => ({}))]); // ui2 是後加功能的字串，可有可無
      ui = { ...ui, ...extra };
    } catch (e) { console.warn("[hex-city] 翻譯檔載入失敗，退回中文", e); lang = "zh"; }
  }
  document.documentElement.lang = lang === "zh" ? "zh-Hant" : lang;

  // t("card.population", "人口", { n: 3 })：有翻譯用翻譯，否則用中文預設；{n} 佔位符會被替換
  const t = (key, zh, vars) => {
    let s = ui[key] ?? zh;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };

  // 把翻譯覆蓋進資料物件；原文保留在 *_zh，Google 地圖查詢要用原文
  const put = (obj, tr, keys) => { if (!obj || !tr) return; for (const k of keys) if (tr[k] != null && tr[k] !== "") { obj[k + "_zh"] ??= obj[k]; obj[k] = tr[k]; } };
  function applyData({ islands, poi, events, rail, roles, settings, tours, crops, flows, specialties, foods, scenery }) {
    if (lang === "zh") return;
    for (const isl of islands || []) {
      put(isl, data.districts?.[isl.id], ["name", "summary"]);
      for (const b of isl.buildings || []) { const tr = data.buildings?.[b.id]; put(b, tr, ["name"]); put(b, { plain: tr?.desc, facts: tr?.facts }, ["plain", "facts"]); } // 翻譯檔的 desc 對應建築的 plain
    }
    for (const p of poi?.pois || []) put(p, data.pois?.[p.id], ["name", "desc", "hours", "days", "note"]);
    for (const e of events?.events || []) {
      const tr = data.events?.[e.id];
      put(e, tr, ["name", "desc", "when", "where"]);
      if (tr?.labels && Array.isArray(e.schedule)) e.schedule.forEach((sc, i) => put(sc, { label: tr.labels[i] }, ["label"]));
    }
    for (const s of rail?.stations || []) put(s, data.stations?.[s.id], ["name"]);
    for (const l of [...(rail?.lines || []), ...(rail?.services || [])]) put(l, data.lines?.[l.id], ["name"]);
    for (const [k, v] of Object.entries(roles?.roles || {})) { const tr = data.roles?.[k]; put(v, { label: typeof tr === "string" ? tr : tr?.label, description: data.roleDescriptions?.[k] ?? tr?.description }, ["label", "description"]); }
    for (const f of flows || []) put(f, { text: data.flows?.[f.id] }, ["text"]);
    for (const [id, items] of Object.entries(specialties?.byDistrict || {})) items.forEach((it, i) => put(it, { name: data.specialties?.[id]?.[i] }, ["name"]));
    (settings?.dayCycle || []).forEach((d, i) => put(d, data.dayCycle?.[i], ["label", "note"]));
    for (const it of foods?.items || []) put(it, data.foods?.[it.id], ["name", "desc"]); // 吃遍台南
    for (const it of scenery?.items || []) put(it, data.scenery?.[it.id], ["name", "desc", "facts", "note"]); // 山海景觀
    if (scenery?.monkeys) put(scenery.monkeys, data.scenery?.monkeys, ["name", "desc"]);
    for (const tour of tours?.tours || []) {
      const tr = data.tours?.[tour.id];
      put(tour, tr, ["name", "blurb"]);
      if (tr?.captions) tour.cues.forEach((c, i) => put(c, { caption: tr.captions[i] }, ["caption"]));
    }
    for (const [k, c] of Object.entries(crops?.crops || {})) {
      const tr = data.crops?.[k];
      put(c, tr, ["name"]);
      if (tr?.stages) c.stages.forEach((st, i) => put(st, { label: tr.stages[i] }, ["label"]));
    }
  }

  // 靜態 DOM：<el data-i18n="key">中文</el>、data-i18n-title、data-i18n-placeholder、data-i18n-aria
  function applyDom(root = document) {
    if (lang === "zh") return;
    for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n, el.textContent);
    for (const el of root.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle, el.title);
    for (const el of root.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder, el.placeholder);
    for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria, el.getAttribute("aria-label")));
  }

  // 語言切換鈕：中 → EN → 日 → 中，寫進網址與 localStorage 後重新載入
  function mountSwitch(container) {
    const order = Object.keys(LANGS), btn = document.createElement("button");
    btn.id = "lang-switch";
    btn.title = t("btn.lang_title", "切換語言 Language 言語");
    btn.textContent = LANGS[lang];
    btn.setAttribute("aria-label", btn.title);
    btn.addEventListener("click", () => {
      const next = order[(order.indexOf(lang) + 1) % order.length];
      try { localStorage.setItem(KEY, next); } catch {}
      const q = new URLSearchParams(location.search);
      q.set("lang", next);
      location.search = q.toString();
    });
    container.prepend(btn);
    return btn;
  }

  // 日期與數字格式用的 locale
  const locale = lang === "ja" ? "ja-JP" : lang === "en" ? "en-US" : "zh-TW";
  return { lang, t, applyData, applyDom, mountSwitch, locale, machine: lang !== "zh" };
}
