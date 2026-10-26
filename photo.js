// 拍照模式：收起所有介面與標籤，底部出現拍照列（濾鏡、相框、拍照、離開）。拍照時把 3D 畫面重畫一次立刻讀出，
// 套濾鏡、加相框與浮水印「HEX CITY 台南 · 地點 · 日期」，存成 PNG 下載。HTML 標籤不在 WebGL 畫布裡，所以不會出現在照片上。
// createPhoto({ t, esc, canvas, renderNow, placeName, dateText, toast, onEnter, onExit })
//   → { button(container), enter(), exit(), get active }
const FILTERS = [
  ["none", "photo.f.none", "原色", "none"],
  ["film", "photo.f.film", "底片", "sepia(0.22) contrast(1.06) saturate(0.92) brightness(1.02)"],
  ["dusk", "photo.f.dusk", "黃昏", "sepia(0.35) saturate(1.35) hue-rotate(-12deg) brightness(1.02)"],
  ["mono", "photo.f.mono", "黑白", "grayscale(1) contrast(1.12)"],
  ["fresh", "photo.f.fresh", "清新", "saturate(1.18) brightness(1.08) contrast(0.95)"],
];
const FRAMES = [["none", "photo.fr.none", "無"], ["polaroid", "photo.fr.polaroid", "拍立得"], ["postcard", "photo.fr.postcard", "明信片"]];

export function createPhoto({ t, esc, canvas, renderNow, placeName, dateText, toast, onEnter, onExit }) {
  let active = false, filter = "none", frame = "polaroid", bar = null;
  const filterCss = () => FILTERS.find((f) => f[0] === filter)[3];

  function button(container) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.play = "photo";
    b.textContent = t("photo.btn", "📷 拍照模式");
    b.addEventListener("click", enter);
    container.appendChild(b);
    return b;
  }
  function renderBar() {
    const chips = (list, cur, attr) => list.map(([id, k, zh]) => `<button type="button" class="chip${id === cur ? " on" : ""}" data-${attr}="${id}" aria-pressed="${id === cur}">${esc(t(k, zh))}</button>`).join("");
    bar.innerHTML = `<div class="photo-row"><span>${esc(t("photo.filter", "濾鏡"))}</span>${chips(FILTERS, filter, "pf")}</div>
      <div class="photo-row"><span>${esc(t("photo.frame", "相框"))}</span>${chips(FRAMES, frame, "pfr")}</div>
      <div class="photo-row photo-actions"><button type="button" class="photo-shot" data-shot>${esc(t("photo.shoot", "📸 拍照"))}</button><button type="button" class="chip" data-exit>${esc(t("photo.exit", "離開"))}</button></div>
      <p class="photo-hint">${esc(t("photo.hint", "拖曳畫面調整角度；標籤不會出現在照片裡。Esc 離開。"))}</p>`;
  }
  function enter() {
    if (active) return;
    active = true;
    onEnter?.();
    document.body.classList.add("photo-mode");
    bar = document.createElement("div");
    bar.className = "photo-bar"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", t("photo.title", "拍照模式"));
    document.body.appendChild(bar);
    renderBar();
    canvas.style.filter = filterCss();
    bar.addEventListener("click", (e) => {
      const f = e.target.closest("[data-pf]"), fr = e.target.closest("[data-pfr]");
      if (f) { filter = f.dataset.pf; canvas.style.filter = filterCss(); renderBar(); }
      else if (fr) { frame = fr.dataset.pfr; renderBar(); }
      else if (e.target.closest("[data-shot]")) shoot();
      else if (e.target.closest("[data-exit]")) exit();
    });
    addEventListener("keydown", onKey);
  }
  function exit() {
    if (!active) return;
    active = false;
    document.body.classList.remove("photo-mode");
    canvas.style.filter = "";
    bar?.remove(); bar = null;
    removeEventListener("keydown", onKey);
    onExit?.();
  }
  const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); exit(); } };

  // 合成：畫面 → 濾鏡 → 相框 → 浮水印
  function shoot() {
    renderNow(); // 沒開 preserveDrawingBuffer：重畫後同一個工作階段內讀取才拿得到像素
    const W = canvas.width, H = canvas.height, k = Math.max(1, W / 1400); // 依解析度放大邊框與字
    const pad = frame === "none" ? 0 : Math.round(28 * k), bottom = frame === "polaroid" ? Math.round(110 * k) : frame === "postcard" ? Math.round(36 * k) : 0;
    const out = document.createElement("canvas");
    out.width = W + pad * 2; out.height = H + pad * 2 + bottom - (frame === "polaroid" ? pad : 0);
    const ctx = out.getContext("2d");
    ctx.fillStyle = frame === "postcard" ? "#f6efe2" : "#fffdf8";
    ctx.fillRect(0, 0, out.width, out.height);
    if ("filter" in ctx) ctx.filter = filterCss(); // Safari 舊版不支援 ctx.filter：照片就是原色
    ctx.drawImage(canvas, pad, pad);
    ctx.filter = "none";
    const place = placeName(), when = dateText(), font = (px, w = 600) => `${w} ${Math.round(px * k)}px -apple-system, "PingFang TC", "Noto Sans TC", sans-serif`;
    if (frame === "polaroid") {
      ctx.fillStyle = "#211d1d"; ctx.font = font(30, 700); ctx.textBaseline = "middle";
      ctx.fillText(place || "HEX CITY 台南", pad, H + pad + bottom / 2 - 14 * k);
      ctx.fillStyle = "#78685e"; ctx.font = font(20, 500);
      ctx.fillText(`HEX CITY 台南 · ${when}`, pad, H + pad + bottom / 2 + 22 * k);
    } else if (frame === "postcard") {
      ctx.strokeStyle = "#c94f3d"; ctx.lineWidth = 3 * k; ctx.setLineDash([10 * k, 6 * k]);
      ctx.strokeRect(pad / 2, pad / 2, out.width - pad, out.height - pad); ctx.setLineDash([]);
      const sw = 120 * k, sh = 140 * k, sx = out.width - pad - sw - 16 * k, sy = pad + 16 * k; // 郵票
      ctx.fillStyle = "#fffdf8"; ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = "#c94f3d"; ctx.lineWidth = 2 * k; ctx.strokeRect(sx + 6 * k, sy + 6 * k, sw - 12 * k, sh - 12 * k);
      ctx.fillStyle = "#c94f3d"; ctx.font = font(34, 800); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("台南", sx + sw / 2, sy + sh / 2 - 12 * k); ctx.font = font(16, 700); ctx.fillText("TAINAN", sx + sw / 2, sy + sh / 2 + 24 * k);
      ctx.textAlign = "left"; ctx.fillStyle = "#211d1d"; ctx.font = font(22, 700); ctx.textBaseline = "alphabetic";
      ctx.fillText(`${place ? place + " · " : ""}${when}`, pad + 8 * k, out.height - pad / 2 - 10 * k);
    } else {
      const text = `HEX CITY 台南${place ? " · " + place : ""} · ${when}`;
      ctx.font = font(20, 700); const tw = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(255,248,244,0.82)"; ctx.fillRect(W - tw - 36 * k, H - 50 * k, tw + 24 * k, 36 * k);
      ctx.fillStyle = "#211d1d"; ctx.textBaseline = "middle"; ctx.fillText(text, W - tw - 24 * k, H - 32 * k);
    }
    out.toBlob((blob) => {
      if (!blob) { toast?.(t("photo.fail", "拍照失敗，請再試一次")); return; }
      const a = document.createElement("a"), d = new Date(), p2 = (n) => String(n).padStart(2, "0");
      a.href = URL.createObjectURL(blob);
      a.download = `hexcity-tainan-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      document.body.classList.add("photo-flash"); setTimeout(() => document.body.classList.remove("photo-flash"), 250); // 快門閃一下
      toast?.(t("photo.saved", "照片已下載"));
    }, "image/png");
  }
  return { button, enter, exit, get active() { return active; } };
}
