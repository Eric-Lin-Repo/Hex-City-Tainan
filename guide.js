// 劍獅小嚮導：左下角一隻劍獅（SVG）加對話泡泡，依你在看的地方說一句話。內容由資料拼出來，不接 AI。
// 觸發：選取（區、建築、景點、活動、特產）、入夜、下雨、閒置 45 秒；同一句不會連說，泡泡 9 秒後收起。
// 桌機預設展開、手機預設收合（只剩劍獅頭）；點劍獅切換。收合狀態存 localStorage。
// createGuide({ t, esc, speak }) → { mount(container), say(text, { force }), setCollapsed(on), get collapsed }
const KEY = "hexcity-guide-collapsed";

// 安平劍獅：圓盾、鬃毛、銜著一把劍
const LION = `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" fill="#e08a2e"/>
<g fill="#c4651c">${Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return `<circle cx="${(32 + Math.cos(a) * 25).toFixed(1)}" cy="${(32 + Math.sin(a) * 25).toFixed(1)}" r="5.5"/>`; }).join("")}</g>
<circle cx="32" cy="33" r="19" fill="#f6d79a"/><circle cx="25" cy="29" r="3.2" fill="#211d1d"/><circle cx="39" cy="29" r="3.2" fill="#211d1d"/>
<circle cx="26" cy="28" r="1" fill="#fff"/><circle cx="40" cy="28" r="1" fill="#fff"/><path d="M28 35 h8 l-4 4z" fill="#8a3b12"/>
<rect x="6" y="40" width="52" height="4" rx="2" fill="#b9c2cc" transform="rotate(-8 32 42)"/><rect x="50" y="36" width="5" height="12" rx="1.5" fill="#7a4a24" transform="rotate(-8 32 42)"/>
<path d="M24 44 q8 6 16 0" stroke="#8a3b12" stroke-width="2" fill="none"/></svg>`;

export function createGuide({ t, esc, speak }) {
  let root, bubble, collapsed, hideTimer = 0, last = "";
  try { const v = localStorage.getItem(KEY); collapsed = v === null ? matchMedia("(max-width: 800px)").matches : v === "1"; } catch { collapsed = matchMedia("(max-width: 800px)").matches; }

  function mount(container) {
    root = document.createElement("div");
    root.className = "guide";
    root.innerHTML = `<button type="button" class="guide-lion" aria-label="${esc(t("guide.toggle", "劍獅小嚮導：顯示或收起"))}" title="${esc(t("guide.name", "劍獅小嚮導"))}">${LION}</button>
      <div class="guide-bubble" role="status" aria-live="polite"></div>`;
    bubble = root.querySelector(".guide-bubble");
    root.querySelector(".guide-lion").addEventListener("click", () => setCollapsed(!collapsed));
    container.appendChild(root);
    apply();
  }
  function apply() {
    root.classList.toggle("collapsed", collapsed);
    root.querySelector(".guide-lion").setAttribute("aria-expanded", String(!collapsed));
  }
  function setCollapsed(on) {
    collapsed = !!on; apply();
    try { localStorage.setItem(KEY, collapsed ? "1" : "0"); } catch {}
    if (!collapsed && !bubble.textContent) say(t("guide.hello", "我是安平劍獅！點地圖上的區或建築，我跟你說說那裡。"), { force: true });
  }
  // 說一句：收合時只讓劍獅頭跳一下提醒；同一句不重複
  function say(text, { force = false } = {}) {
    if (!root || !text || (!force && text === last)) return;
    last = text;
    root.classList.remove("nudge"); void root.offsetWidth; root.classList.add("nudge");
    if (collapsed) return;
    bubble.innerHTML = `<span>${esc(text)}</span>`;
    bubble.classList.add("show");
    speak?.(text);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => bubble.classList.remove("show"), 9000);
  }
  return { mount, say, setCollapsed, get collapsed() { return collapsed; } };
}
