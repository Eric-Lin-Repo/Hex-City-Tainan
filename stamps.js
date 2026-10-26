// 集章：37 區各一個代表地標（data/stamps.json），點到地標卡片就蓋章；進度存 localStorage，集滿觸發慶祝。
const KEY = "hexcity-stamps";

export function createStamps({ t, data, islands, esc, onComplete, onPickDistrict, toast }) {
  const entries = Object.entries(data.byDistrict).filter(([, s]) => s); // [districtId, {type,id,name}]
  const total = entries.length;
  const byTarget = new Map(entries.map(([d, s]) => [`${s.type}:${s.id}`, d]));
  let got = new Set();
  try { got = new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...got])); } catch {} };

  let btn, panel;
  function mount(toolbar, app) {
    btn = document.createElement("button");
    btn.id = "stamp-btn";
    btn.setAttribute("aria-controls", "stamps");
    btn.setAttribute("aria-expanded", "false");
    toolbar.insertBefore(btn, toolbar.querySelector("#sidebar-toggle"));
    panel = document.createElement("div");
    panel.id = "stamps"; panel.className = "stamps"; panel.hidden = true; panel.setAttribute("role", "dialog");
    app.appendChild(panel);
    btn.addEventListener("click", () => setOpen(panel.hidden));
    panel.addEventListener("click", (e) => {
      const close = e.target.closest("[data-close]"), reset = e.target.closest("[data-reset]"), cell = e.target.closest("[data-district]");
      if (close) setOpen(false);
      else if (reset) { got.clear(); save(); render(); toast?.(t("stamps.reset_done", "集章已重設")); }
      else if (cell) { setOpen(false); onPickDistrict?.(cell.dataset.district); }
    });
    render();
  }
  const setOpen = (open) => { panel.hidden = !open; btn.setAttribute("aria-expanded", String(open)); };
  function render() {
    if (!btn) return;
    btn.textContent = matchMedia("(max-width: 800px)").matches && !btn.closest(".play-menu") ? `📘 ${got.size}/${total}` : t("stamps.btn", "📘 集章 {n}/{total}", { n: got.size, total }); // 手機只放數字
    btn.title = t("stamps.title", "集章簿");
    panel.innerHTML = `<div class="stamps-head"><b>${esc(t("stamps.title", "集章簿"))}</b><span>${got.size} / ${total}</span><button type="button" data-close aria-label="${esc(t("card.close", "關閉（Esc）"))}">×</button></div>
      <p class="muted">${esc(t("stamps.hint", "點到每區的代表地標就會蓋章；點格子可以飛到那個區去找。"))}</p>
      <div class="stamps-grid">${entries.map(([d, s]) => { const isl = islands.get(d), on = got.has(d); return `<button type="button" class="stamp${on ? " on" : ""}" data-district="${d}" style="--c:${isl?.color || "#999"}" title="${esc(on ? s.name : t("stamps.locked", "還沒蓋：飛過去找找"))}"><i>${isl?.number ?? ""}</i><b>${esc(isl?.name || d)}</b><small>${on ? "✔ " + esc(s.name) : "？"}</small></button>`; }).join("")}</div>
      <div class="stamps-foot"><button type="button" class="chip" data-reset>${esc(t("stamps.reset", "重設"))}</button></div>`;
  }
  // 選取時呼叫：是代表地標且還沒蓋就蓋章
  function visit(u) {
    if (!u || !u.id) return false;
    const d = byTarget.get(`${u.type}:${u.id}`);
    if (!d || got.has(d)) return false;
    got.add(d); save(); render();
    const s = data.byDistrict[d];
    toast?.(t("stamps.got", "蓋章！{name}（{n}/{total}）", { name: s.name, n: got.size, total }));
    if (got.size === total) onComplete?.();
    return true;
  }
  return { mount, visit, render, count: () => got.size, total, setOpen };
}
