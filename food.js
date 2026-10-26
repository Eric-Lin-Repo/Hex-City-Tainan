// 吃遍台南：data/food.json 的各區代表小吃，每樣綁一個地點（建築或景點）；打開那個地點的卡片就算「吃到」。
// 「🎮 玩」選單裡的美食圖鑑面板依區列出，吃完全部放煙火。進度存 localStorage。
// createFood({ t, esc, data, islands, keyOf, toast, onComplete, onPick })
//   keyOf(item) → "building:<id>" 或 "poi:<id>"（由 app 依建築名稱查出 id）
//   → { button(container), visit(u) → 新吃到的項目陣列, itemsAt(u), cardHtml(u), count, total }
const KEY = "hexcity-food";

export function createFood({ t, esc, data, islands, keyOf, toast, onComplete, onPick }) {
  const items = (data?.items || []).map((it) => ({ ...it, key: keyOf(it) })).filter((it) => it.key);
  const byKey = new Map();
  for (const it of items) { if (!byKey.has(it.key)) byKey.set(it.key, []); byKey.get(it.key).push(it); }
  const total = items.length;
  let got = new Set();
  try { got = new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...got])); } catch {} };
  const keyOfSel = (u) => (u && (u.type === "building" || u.type === "poi") ? `${u.type}:${u.id}` : "");
  let btn, panel;

  function button(container) {
    btn = document.createElement("button");
    btn.type = "button"; btn.dataset.play = "food";
    container.appendChild(btn);
    panel = document.createElement("div");
    panel.className = "stamps food"; panel.hidden = true; panel.setAttribute("role", "dialog");
    document.querySelector("#app").appendChild(panel);
    btn.addEventListener("click", () => { panel.hidden = false; render(); });
    panel.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) panel.hidden = true;
      else if (e.target.closest("[data-reset]")) { got.clear(); save(); render(); toast?.(t("food.reset_done", "美食圖鑑已重設")); }
      else { const c = e.target.closest("[data-food]"); if (c) { panel.hidden = true; onPick?.(items.find((x) => x.id === c.dataset.food)); } }
    });
    render();
  }
  function render() {
    if (!btn) return;
    btn.textContent = t("food.btn", "🍜 美食圖鑑 {n}/{total}", { n: got.size, total });
    if (!panel || panel.hidden) return;
    // 依區分組，區照編號排
    const groups = new Map();
    for (const it of items) { const isl = [...islands.values()].find((x) => (x.name_zh ?? x.name) === it.district); const k = isl?.id || it.district; if (!groups.has(k)) groups.set(k, { isl, list: [] }); groups.get(k).list.push(it); }
    const sorted = [...groups.values()].sort((a, b) => (a.isl?.number ?? 99) - (b.isl?.number ?? 99));
    panel.innerHTML = `<div class="stamps-head"><b>${esc(t("food.title", "🍜 吃遍台南"))}</b><span>${got.size} / ${total}</span><button type="button" data-close aria-label="${esc(t("card.close", "關閉（Esc）"))}">×</button></div>
      <p class="muted">${esc(t("food.hint", "打開小吃所在地點的卡片就算吃到；點格子可以飛過去。"))}</p>
      <div class="stamps-grid">${sorted.flatMap(({ isl, list }) => list.map((it) => { const on = got.has(it.id); return `<button type="button" class="stamp${on ? " on" : ""}" data-food="${esc(it.id)}" style="--c:${isl?.color || "#999"}" title="${esc(on ? it.desc : t("food.locked", "還沒吃：飛過去找找"))}"><i>${esc(isl?.name || it.district)}</i><b>${esc(it.icon)} ${esc(it.name)}</b><small>${on ? "✔ " + esc(t("food.eaten", "吃過了")) : "？"}</small></button>`; })).join("")}</div>
      <div class="stamps-foot"><button type="button" class="chip" data-reset>${esc(t("stamps.reset", "重設"))}</button></div>`;
  }
  const itemsAt = (u) => byKey.get(keyOfSel(u)) || [];
  // 選取地點時呼叫：這裡有沒吃過的小吃就記下來
  function visit(u) {
    const fresh = itemsAt(u).filter((it) => !got.has(it.id));
    if (!fresh.length) return [];
    for (const it of fresh) got.add(it.id);
    save(); render();
    toast?.(t("food.got", "吃到了！{list}（{n}/{total}）", { list: fresh.map((it) => it.icon + " " + it.name).join(t("list.separator", "、")), n: got.size, total }));
    if (got.size === total) onComplete?.();
    return fresh;
  }
  // 卡片上的「這裡可以吃到」
  function cardHtml(u) {
    const list = itemsAt(u);
    if (!list.length) return "";
    return `<h3>${esc(t("food.here", "這裡可以吃到"))}</h3><ul class="facts food-here">${list.map((it) => `<li><b>${esc(it.icon)} ${esc(it.name)}</b>${it.unsure ? ` <span class="muted">${esc(t("food.unsure", "（待查證）"))}</span>` : ""}<br><span class="muted">${esc(it.desc)}</span></li>`).join("")}</ul>`;
  }
  return { button, visit, itemsAt, cardHtml, get count() { return got.size; }, total };
}
