// 月曆面板：純 DOM，不依賴 Three.js。用 createElement 組 DOM，不用 innerHTML。
// 所有日期都是 UTC 午夜的 Date（和 app.js 的 calDate 一致）。month 一律用 1–12。
const DAY = 86400000;
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const MAX_DOTS = 4;
// 活動顏色：依 events 陣列順序循環指派，色票和 style.css 的 token 同調
const PALETTE = ["#db6a41", "#3e7c8c", "#d98c3a", "#2f8a4b", "#8a4fa3", "#b8412f", "#2f6f9f", "#c08a1e"];

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const todayUTC = () => { const n = new Date(); return utc(n.getFullYear(), n.getMonth() + 1, n.getDate()); };
const md = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;

export function createCalendarPanel({ container, events, getDate, onPickDate, onPickEvent, lunarLabel, occurrencesIn, fmtDate }) {
  const colorOf = new Map(events.map((e, i) => [e.id, PALETTE[i % PALETTE.length]]));
  const cache = new Map(); // `${id}:${year}` → occurrences，農曆換算很貴，算過就留著
  const occsOf = (e, year) => {
    const k = `${e.id}:${year}`;
    if (!cache.has(k)) cache.set(k, occurrencesIn(e.schedule, year));
    return cache.get(k);
  };

  const init = getDate();
  let year = init.getUTCFullYear(), month = init.getUTCMonth() + 1;
  container.classList.add("cal");

  // 這個月每個活動的區間（含跨年：前一年、今年、明年都算，再裁到本月）
  function monthEvents() {
    const first = utc(year, month, 1), last = utc(year, month + 1, 0);
    const out = [];
    for (const e of events) {
      for (const y of [year - 1, year, year + 1]) {
        for (const o of occsOf(e, y)) {
          if (o.end < first || o.start > last) continue;
          out.push({ event: e, occ: o, from: o.start < first ? first : o.start, to: o.end > last ? last : o.end });
        }
      }
    }
    return out.sort((a, b) => a.from - b.from || a.to - b.to);
  }

  function setMonth(y, m) {
    const d = utc(y, m, 1); // 允許 m = 0 或 13，自動進位
    year = d.getUTCFullYear(); month = d.getUTCMonth() + 1;
  }
  function pickDate(d) { onPickDate?.(d); render(); }

  function buildHead() {
    const head = el("div", "cal-head");
    const prev = el("button", "cal-nav", "‹");
    prev.type = "button"; prev.setAttribute("aria-label", "上個月"); prev.title = "上個月";
    prev.addEventListener("click", () => { setMonth(year, month - 1); render(); });
    const next = el("button", "cal-nav", "›");
    next.type = "button"; next.setAttribute("aria-label", "下個月"); next.title = "下個月";
    next.addEventListener("click", () => { setMonth(year, month + 1); render(); });
    const title = el("h2", "cal-title", `${year} 年 ${month} 月`);
    title.setAttribute("aria-live", "polite");
    const today = el("button", "cal-today", "今天");
    today.type = "button"; today.title = "回到今天";
    today.addEventListener("click", () => { const t = todayUTC(); setMonth(t.getUTCFullYear(), t.getUTCMonth() + 1); pickDate(t); });
    head.append(prev, title, next, today);
    return head;
  }

  function buildGrid(list, selected, today) {
    const table = el("table", "cal-grid");
    table.setAttribute("role", "grid");
    table.setAttribute("aria-label", `${year} 年 ${month} 月`);
    const thead = el("thead"), hr = el("tr");
    for (const w of WEEK) { const th = el("th", "cal-wd", w); th.scope = "col"; hr.append(th); }
    thead.append(hr);
    const tbody = el("tbody");
    const offset = utc(year, month, 1).getUTCDay(), days = utc(year, month + 1, 0).getUTCDate();
    const selKey = fmtDate(selected), todayKey = fmtDate(today);
    let tr = el("tr");
    for (let i = 0; i < offset; i++) tr.append(el("td", "cal-day cal-day--empty"));
    for (let d = 1; d <= days; d++) {
      const date = utc(year, month, d), key = fmtDate(date);
      const hits = list.filter((x) => date >= x.from && date <= x.to);
      const td = el("td", "cal-day");
      td.setAttribute("role", "gridcell");
      if (key === todayKey) td.classList.add("cal-day--today");
      if (key === selKey) td.classList.add("cal-day--selected");
      if (hits.length) td.classList.add("cal-day--has");
      const btn = el("button", "cal-daybtn");
      btn.type = "button"; btn.dataset.date = key;
      const names = hits.map((x) => x.event.name + (x.occ.label ? `（${x.occ.label}）` : "")).join("、");
      btn.setAttribute("aria-label", `${key}（${WEEK[date.getUTCDay()]}）${lunarLabel(date)}${names ? "：" + names : ""}`);
      if (key === selKey) btn.setAttribute("aria-pressed", "true");
      if (key === todayKey) btn.setAttribute("aria-current", "date");
      btn.title = names || key;
      btn.append(el("span", "cal-num", String(d)));
      const dots = el("span", "cal-dots");
      const shown = hits.length > MAX_DOTS ? MAX_DOTS - 1 : hits.length;
      for (let i = 0; i < shown; i++) {
        const dot = el("i", "cal-dot");
        dot.style.setProperty("--c", colorOf.get(hits[i].event.id));
        dots.append(dot);
      }
      if (hits.length > MAX_DOTS) dots.append(el("b", "cal-more", `+${hits.length - shown}`));
      btn.append(dots);
      btn.addEventListener("click", () => pickDate(date));
      td.append(btn);
      tr.append(td);
      if (tr.childElementCount === 7) { tbody.append(tr); tr = el("tr"); }
    }
    if (tr.childElementCount) {
      while (tr.childElementCount < 7) tr.append(el("td", "cal-day cal-day--empty"));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    return table;
  }

  function buildList(list, selected) {
    const wrap = el("section", "cal-events");
    wrap.setAttribute("aria-label", "本月活動");
    wrap.append(el("h3", "cal-events-title", `本月活動 ${list.length ? `· ${list.length}` : ""}`));
    if (!list.length) { wrap.append(el("p", "cal-empty", "這個月沒有排定的活動。")); return wrap; }
    const ul = el("ul", "cal-list");
    for (const x of list) {
      const li = el("li", "cal-item");
      const btn = el("button", "cal-ev");
      btn.type = "button"; btn.dataset.event = x.event.id;
      if (selected >= x.occ.start && selected <= x.occ.end) { li.classList.add("cal-item--active"); btn.setAttribute("aria-current", "true"); }
      const dot = el("i", "cal-dot");
      dot.style.setProperty("--c", colorOf.get(x.event.id));
      const range = x.occ.start.getTime() === x.occ.end.getTime() ? md(x.occ.start) : `${md(x.occ.start)}–${md(x.occ.end)}`;
      const district = x.event.districtName ? `（${x.event.districtName}）` : "";
      const label = x.occ.label ? `・${x.occ.label}` : "";
      const text = el("span", "cal-ev-text");
      text.append(el("span", "cal-ev-range", range), " · ", el("span", "cal-ev-name", `${x.event.name}${label}${district}`));
      btn.title = `${fmtDate(x.occ.start)}${x.occ.start.getTime() === x.occ.end.getTime() ? "" : " 到 " + fmtDate(x.occ.end)}`;
      btn.setAttribute("aria-label", `${btn.title} ${x.event.name}${label}${district}`);
      btn.append(dot, text);
      btn.addEventListener("click", () => onPickEvent?.(x.event.id));
      li.append(btn);
      ul.append(li);
    }
    wrap.append(ul);
    return wrap;
  }

  function render() {
    const selected = getDate(), today = todayUTC(), list = monthEvents();
    const caption = el("p", "cal-caption");
    caption.append(el("b", null, `${fmtDate(selected)}（${WEEK[selected.getUTCDay()]}）`), " ", el("span", "cal-lunar", lunarLabel(selected)));
    container.replaceChildren(buildHead(), buildGrid(list, selected, today), caption, buildList(list, selected));
    return container;
  }

  const show = () => { container.hidden = false; container.classList.add("cal--open"); render(); };
  const hide = () => { container.hidden = true; container.classList.remove("cal--open"); };
  const isOpen = () => !container.hidden;
  const toggle = () => (isOpen() ? hide() : show());
  return { render, setMonth, show, hide, toggle, isOpen };
}
