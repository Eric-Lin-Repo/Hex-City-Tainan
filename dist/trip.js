// 一日行程規劃：把地標加進清單、拖曳排序、播放路線、算總距離、產生分享連結。
// 不碰 three.js 與 app.js 內部狀態；地標的名稱與位置由整合端的 resolve({type,id}) 提供，
// 飛過去＋開卡片交給 select(u)。狀態存在 localStorage（hexcity-trip），每次變動呼叫 onChange(list)。
const KEY = "hexcity-trip", MAX = 12, STAY = 6; // 每站停留秒數
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const keyOf = (u) => `${u.type}:${u.id}`;
const parseKey = (s) => { const [type, ...rest] = String(s).split(":"); const id = rest.join(":"); return type && id ? { type, id } : null; };
const planar = (a, b) => Math.hypot(a.x - b.x, a.z - b.z); // 地面直線距離（世界單位），不算高低差

export function createTrip({ t, resolve, flyTo, select, toast, k = 1, onChange, storage } = {}) {
  // t(key, 中文預設, vars)；沒給 t 時自己替換佔位符（node 測試用）
  const tr = (key, zh, vars) => (t ? t(key, zh, vars) : Object.entries(vars || {}).reduce((s, [a, b]) => s.replaceAll(`{${a}}`, String(b)), zh));
  const store = storage !== undefined ? storage : (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();
  const say = (m) => toast?.(m);
  const info = (u) => { try { return resolve?.(u) ?? null; } catch { return null; } };
  const known = (u) => !resolve || !!info(u); // 有 resolve 時，找不到的地標不收

  let items = [];
  const sanitize = (arr) => {
    const out = [], seen = new Set();
    for (const raw of Array.isArray(arr) ? arr : []) {
      const u = typeof raw === "string" ? parseKey(raw) : raw && typeof raw.type === "string" && raw.id != null ? { type: raw.type, id: String(raw.id) } : null;
      if (!u || seen.has(keyOf(u)) || !known(u)) continue;
      seen.add(keyOf(u));
      out.push(u);
      if (out.length >= MAX) break;
    }
    return out;
  };
  try { const raw = store?.getItem(KEY); if (raw) items = sanitize(JSON.parse(raw)); } catch {}

  // ── 純邏輯 ──
  const list = () => items.map((u) => ({ ...u }));
  const serialize = () => items.map((u) => `${encodeURIComponent(u.type)}:${encodeURIComponent(u.id)}`).join(",");
  function distanceKm() {
    let sum = 0, prev = null;
    for (const u of items) {
      const p = info(u)?.pos;
      if (!p) continue;
      if (prev) sum += planar(prev, p);
      prev = p;
    }
    return sum / (k || 1);
  }
  const kmText = () => distanceKm().toFixed(1);
  function changed() {
    try { store?.setItem(KEY, JSON.stringify(items)); } catch {}
    render();
    onChange?.(list());
  }
  function add(u) {
    if (!u || !u.type || u.id == null) return false;
    u = { type: String(u.type), id: String(u.id) };
    if (items.some((x) => keyOf(x) === keyOf(u))) { say(tr("trip.dup", "已經在行程裡")); return false; }
    if (items.length >= MAX) { say(tr("trip.full", "行程最多 12 站")); return false; }
    items.push(u);
    say(tr("trip.added", "已加入行程"));
    bump();
    changed();
    return true;
  }
  function remove(i) {
    if (i < 0 || i >= items.length) return false;
    items.splice(i, 1);
    if (play.on) stop(true);
    changed();
    return true;
  }
  function move(from, to) {
    const n = items.length;
    if (from < 0 || from >= n || to < 0 || to >= n) return false;
    if (from === to) return true;
    const [u] = items.splice(from, 1);
    items.splice(to, 0, u);
    if (play.on) stop(true);
    changed();
    return true;
  }
  function clear() {
    if (play.on) stop(true);
    items = [];
    changed();
  }
  function load(ids) {
    const arr = typeof ids === "string" ? ids.split(",").filter(Boolean) : ids;
    if (play.on) stop(true);
    items = sanitize(arr);
    changed();
    return list();
  }
  function shareUrl(base) {
    const href = base ?? (typeof location !== "undefined" ? location.href : "");
    const url = new URL(href, "http://localhost/");
    const q = new URLSearchParams(url.search);
    q.delete("trip");
    const qs = q.toString();
    url.search = items.length ? `${qs ? qs + "&" : ""}trip=${serialize()}` : qs; // trip 參數不轉義「:」「,」，網址比較好讀
    const s = url.toString();
    copyText(s);
    return s;
  }
  function copyText(s) {
    const ok = () => say(tr("trip.copied", "連結已複製"));
    const fail = () => say(tr("trip.copy_failed", "無法自動複製，請手動複製網址列"));
    try {
      if (globalThis.navigator?.clipboard?.writeText) { navigator.clipboard.writeText(s).then(ok, () => (legacyCopy(s) ? ok() : fail())); return; }
      legacyCopy(s) ? ok() : fail();
    } catch { fail(); }
  }
  function legacyCopy(s) { // 非 https 或舊瀏覽器：用隱藏的 textarea + execCommand
    if (typeof document === "undefined") return false;
    try {
      const ta = document.createElement("textarea");
      ta.value = s; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand?.("copy");
      ta.remove();
      return !!ok;
    } catch { return false; }
  }

  // ── 播放：依序 select(u)，每站停 STAY 秒；update(dt) 由主迴圈餵 ──
  const play = { on: false, i: -1, elapsed: 0 };
  function startPlay() {
    if (!items.length) { say(tr("trip.empty", "從卡片按「加入行程」開始排一天")); return false; }
    play.on = true;
    say(tr("trip.playing", "播放行程：{n} 站，每站停 6 秒，拖曳畫面可停止", { n: items.length }));
    show(0);
    render();
    return true;
  }
  function show(i) {
    play.i = i; play.elapsed = 0;
    select?.({ ...items[i] });
    setActive(i);
  }
  function stop(quiet = false) {
    if (!play.on) return;
    play.on = false; play.i = -1; play.elapsed = 0;
    if (!quiet) render();
  }
  function update(dt) {
    if (!play.on) return;
    play.elapsed += Math.max(0, +dt || 0);
    if (play.elapsed >= STAY) {
      if (play.i + 1 < items.length) show(play.i + 1);
      else { stop(); say(tr("trip.done", "行程播完了")); }
      return;
    }
    if (bar) bar.style.width = `${(100 * play.elapsed / STAY).toFixed(1)}%`;
  }

  // ── 面板 ──
  let el = null, headBtn = null, countEl = null, badgeEl = null, bodyEl = null, listEl = null, emptyEl = null, hintEl = null, playBtn = null, clearBtn = null, shareBtn = null, bar = null;
  let open = false, drag = null;
  const isMobile = () => typeof matchMedia === "function" && matchMedia("(max-width: 800px)").matches;
  function mount(container) {
    if (!container || el) return el;
    el = document.createElement("aside");
    el.className = "trip collapsed";
    el.setAttribute("aria-label", tr("trip.aria", "一日行程面板"));
    el.innerHTML = `<button type="button" class="trip-head" aria-expanded="false" title="${esc(tr("trip.toggle.title", "展開或收合行程"))}"><span class="trip-icon" aria-hidden="true">🧭</span><span class="trip-title">${esc(tr("trip.title", "行程"))}</span><span class="trip-count"></span><span class="trip-badge" aria-hidden="true"></span><span class="trip-caret" aria-hidden="true">▴</span></button>
      <div class="trip-body">
        <p class="trip-empty">${esc(tr("trip.empty", "從卡片按「加入行程」開始排一天"))}</p>
        <ol class="trip-list" aria-label="${esc(tr("trip.list.aria", "行程站點"))}"></ol>
        <p class="trip-hint">${esc(tr("trip.drag_hint", "按住 ⠿ 拖曳可排序"))}</p>
        <div class="trip-actions"><button type="button" class="trip-play" aria-pressed="false"></button><button type="button" class="trip-clear">${esc(tr("trip.clear", "清除"))}</button><button type="button" class="trip-share">${esc(tr("trip.share", "分享連結"))}</button></div>
      </div>`;
    headBtn = el.querySelector(".trip-head"); countEl = el.querySelector(".trip-count"); badgeEl = el.querySelector(".trip-badge");
    bodyEl = el.querySelector(".trip-body"); listEl = el.querySelector(".trip-list"); emptyEl = el.querySelector(".trip-empty"); hintEl = el.querySelector(".trip-hint");
    playBtn = el.querySelector(".trip-play"); clearBtn = el.querySelector(".trip-clear"); shareBtn = el.querySelector(".trip-share");
    headBtn.addEventListener("click", () => setOpen(!open));
    playBtn.addEventListener("click", () => (play.on ? stop() : startPlay()));
    clearBtn.addEventListener("click", () => { if (!items.length) return; clear(); say(tr("trip.cleared", "已清除行程")); });
    shareBtn.addEventListener("click", () => { if (!items.length) { say(tr("trip.empty", "從卡片按「加入行程」開始排一天")); return; } shareUrl(); });
    listEl.addEventListener("click", (e) => {
      const rm = e.target.closest(".trip-remove");
      if (rm) { remove(+rm.dataset.i); return; }
      const go = e.target.closest(".trip-go");
      if (go) { const i = +go.dataset.i; if (play.on) { show(i); render(); } else select?.({ ...items[i] }); }
    });
    listEl.addEventListener("keydown", (e) => { // 鍵盤也能排序：焦點在 ⠿ 上按 ↑↓
      const h = e.target.closest?.(".trip-handle");
      if (!h || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      const i = +h.closest(".trip-item").dataset.i, j = i + (e.key === "ArrowUp" ? -1 : 1);
      if (move(i, j)) listEl.querySelector(`.trip-item[data-i="${j}"] .trip-handle`)?.focus();
      e.preventDefault();
    });
    // 拖曳排序：Pointer Events（滑鼠、觸控、筆都一樣），拖的時候直接搬 DOM，放開才真的 move()
    listEl.addEventListener("pointerdown", (e) => {
      const h = e.target.closest(".trip-handle");
      if (!h || drag || (e.pointerType === "mouse" && e.button !== 0)) return;
      const li = h.closest(".trip-item");
      drag = { li, from: +li.dataset.i, to: +li.dataset.i, id: e.pointerId };
      try { h.setPointerCapture(e.pointerId); } catch {}
      li.classList.add("dragging"); el.classList.add("is-dragging");
      e.preventDefault();
    });
    listEl.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const y = e.clientY, others = [...listEl.children].filter((n) => n !== drag.li);
      const next = others.find((n) => { const r = n.getBoundingClientRect(); return y < r.top + r.height / 2; });
      if (next) { if (drag.li.nextSibling !== next) listEl.insertBefore(drag.li, next); }
      else if (listEl.lastElementChild !== drag.li) listEl.appendChild(drag.li);
      drag.to = [...listEl.children].indexOf(drag.li);
      [...listEl.children].forEach((n, i) => { const b = n.querySelector(".trip-num"); if (b) b.textContent = String(i + 1); });
    });
    const endDrag = (e) => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      const { from, to, li } = drag;
      drag = null;
      li.classList.remove("dragging"); el.classList.remove("is-dragging");
      if (from !== to) move(from, to); else render();
    };
    listEl.addEventListener("pointerup", endDrag);
    listEl.addEventListener("pointercancel", endDrag);
    listEl.addEventListener("lostpointercapture", endDrag);
    container.appendChild(el);
    open = !isMobile() && items.length > 0;
    render();
    return el;
  }
  function setOpen(v) {
    open = !!v;
    if (!el) return;
    el.classList.toggle("collapsed", !open);
    headBtn.setAttribute("aria-expanded", String(open));
  }
  function bump() {
    if (!el) return;
    if (!open && !isMobile()) setOpen(true); // 桌面：第一次加入就展開；手機只閃一下徽章
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
  }
  function setActive(i) {
    if (!listEl) return;
    [...listEl.children].forEach((n, j) => n.classList.toggle("active", j === i));
    bar = listEl.children[i]?.querySelector(".trip-bar") || null;
    if (bar) bar.style.width = "0%";
  }
  function render() {
    if (!el || drag) return;
    const n = items.length;
    el.classList.toggle("has-items", n > 0);
    el.classList.toggle("playing", play.on);
    el.classList.toggle("collapsed", !open);
    headBtn.setAttribute("aria-expanded", String(open));
    countEl.textContent = n ? tr("trip.count", "{n} 站 · 約 {km} 公里", { n, km: kmText() }) : "";
    badgeEl.textContent = n ? String(n) : "";
    emptyEl.hidden = n > 0; hintEl.hidden = n < 2;
    listEl.innerHTML = items.map((u, i) => {
      const r = info(u);
      return `<li class="trip-item${play.on && i === play.i ? " active" : ""}" data-i="${i}">
        <button type="button" class="trip-handle" aria-label="${esc(tr("trip.drag_hint", "按住 ⠿ 拖曳可排序"))}" title="${esc(tr("trip.drag_hint", "按住 ⠿ 拖曳可排序"))}">⠿</button>
        <b class="trip-num">${i + 1}</b>
        <button type="button" class="trip-go" data-i="${i}" title="${esc(tr("trip.go.title", "飛到這一站"))}"><span class="trip-name">${esc(r?.name ?? tr("trip.unknown", "（找不到的地點）"))}</span><small>${esc(r?.districtName ?? "")}</small></button>
        <button type="button" class="trip-remove" data-i="${i}" aria-label="${esc(tr("trip.remove", "移除"))}" title="${esc(tr("trip.remove", "移除"))}">×</button>
        <i class="trip-bar"></i></li>`;
    }).join("");
    playBtn.textContent = play.on ? `■ ${tr("trip.stop", "停止")}` : `▶ ${tr("trip.play", "播放")}`;
    playBtn.setAttribute("aria-pressed", String(play.on));
    playBtn.disabled = clearBtn.disabled = shareBtn.disabled = n === 0;
    if (play.on) setActive(play.i);
  }

  return {
    add, remove, move, clear, list, load, play: startPlay, stop: () => stop(), get playing() { return play.on; }, get current() { return play.i; },
    shareUrl, serialize, distanceKm, mount, update, setOpen, isOpen: () => open, MAX, STAY,
  };
}
