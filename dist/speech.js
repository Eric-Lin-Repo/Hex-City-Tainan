// 語音朗讀：用瀏覽器內建 Web Speech API（speechSynthesis）唸卡片內容與導覽字幕。
// 不依賴任何外部服務；沒開啟（enabled=false）時完全沒有副作用。
//
// 用法：
//   const speech = createSpeech({ lang: i18n.lang, t });
//   speech.unlock();                 // iOS Safari：在使用者手勢（按鈕 click）內呼叫一次才能出聲
//   if (!speech.setEnabled(true)) toast(speech.reason);
//   speech.speakCard(cardContent);   // 卡片 DOM → 文字 → 朗讀
//   speech.speakText(cue.caption);   // 導覽字幕
//   speech.stop();                   // 關卡片、換語言、結束導覽時

// 每種介面語言可接受的語音 lang 標籤，前面的優先
const VOICE_PREFS = {
  zh: ["zh-tw", "zh-hant", "zh-hk", "zh-cn", "zh-hans", "zh"],
  en: ["en-us", "en"],
  ja: ["ja-jp", "ja"],
};
// 沒有語音時找不到 voice，utterance 仍要帶 lang 讓瀏覽器自己挑
const UTTER_LANG = { zh: "zh-TW", en: "en-US", ja: "ja-JP" };
// 「沒有{lang}語音」裡的語言名稱，用該語言自己的寫法
const LANG_LABEL = { zh: "中文", en: "English", ja: "日本語" };
// 句子之間、欄位名與值之間的分隔，依語言
const PUNCT = {
  zh: { sentence: "。", colon: "：", comma: "，", list: "、", arrow: "到", both: "與" },
  ja: { sentence: "。", colon: "：", comma: "、", list: "・", arrow: "から", both: "と" },
  en: { sentence: ". ", colon: ": ", comma: ", ", list: ", ", arrow: " to ", both: " and " },
};
const MAX_CHARS = 600; // 一張卡片最多唸這麼多字
const CHUNK_CHARS = 180; // Chrome 桌面版的 Google 語音唸超過約 15 秒會中斷，所以切成短段依序排隊

const norm = (s) => (s || "").toLowerCase().replace("_", "-");

// ── 卡片 DOM → 文字 ──
// 只拿 h2（含 small）、第一段 p、dl.meta 的 dt/dd、.stats 的 b+span；
// 略過按鈕（dd 裡的區名 chip 例外，那是欄位的值）、.muted 備註、連結文字（例如「在 Google Maps 開啟」）。
function skipNode(el, inDd) {
  const tag = el.tagName;
  if (tag === "A" || tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE") return true;
  if (tag === "BUTTON" && !inDd) return true;
  if (el.classList?.contains("muted")) return true;
  return el.getAttribute?.("aria-hidden") === "true";
}
function textOf(node, { inDd = false, except = null } = {}) {
  if (!node) return "";
  if (node.nodeType === 3) return node.nodeValue || "";
  if (node.nodeType !== 1) return "";
  if (node === except || skipNode(node, inDd)) return "";
  if (node.tagName === "BR") return "\n";
  let out = "";
  for (const c of node.childNodes || []) out += textOf(c, { inDd, except });
  return out;
}
// 深度優先找所有符合條件的元素（不依賴 querySelector，方便在沒有 DOM 的環境測）
function findAll(root, pred, out = []) {
  for (const el of root.children || []) {
    if (pred(el)) out.push(el);
    findAll(el, pred, out);
  }
  return out;
}
const hasClass = (el, c) => !!el.classList?.contains(c);
const insideList = (el, root) => { for (let p = el.parentNode; p && p !== root; p = p.parentNode) if (p.tagName === "LI" || p.tagName === "UL") return true; return false; };

function tidy(s, P) {
  return s
    .replace(/ /g, " ")
    .replace(/[↗↘↖↙]/g, "")
    .replace(/\s*⇄\s*/g, P.both)
    .replace(/\s*(→|->)\s*/g, P.arrow)
    .replace(/（\s*）|\(\s*\)/g, "") // 連結被拿掉後留下的空括號
    .replace(/[ \t\r\f]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim();
}
const stripEnd = (s) => s.replace(/[\s。．.!！?？]+$/u, "");

export function cardToText(cardEl, lang = "zh") {
  const P = PUNCT[lang] || PUNCT.zh;
  if (!cardEl) return "";
  const out = [];
  const push = (s) => { s = stripEnd(tidy(s, P)); if (s) out.push(s); };

  // 標題 h2 ＋ 副標 small
  const h2 = findAll(cardEl, (el) => el.tagName === "H2")[0];
  if (h2) {
    const small = findAll(h2, (el) => el.tagName === "SMALL")[0];
    const title = tidy(textOf(h2, { except: small }), P), sub = small ? tidy(textOf(small), P) : "";
    push(sub ? `${title}${P.comma}${sub}` : title);
  }
  // 第一段 p（不在清單裡、不是備註、拿掉按鈕與連結後還有字）
  for (const p of findAll(cardEl, (el) => el.tagName === "P")) {
    if (hasClass(p, "muted") || insideList(p, cardEl)) continue;
    const s = tidy(textOf(p), P);
    if (s) { push(s); break; }
  }
  // dl.meta：dt／dd 配對 → 「人口：約 74 千人」
  for (const dl of findAll(cardEl, (el) => el.tagName === "DL" && hasClass(el, "meta"))) {
    let dt = "";
    for (const c of dl.children || []) {
      if (c.tagName === "DT") dt = tidy(textOf(c), P);
      else if (c.tagName === "DD") {
        const dd = tidy(textOf(c, { inDd: true }), P).split("\n").map((x) => x.trim()).filter(Boolean).join(P.list);
        if (dt && dd) push(`${dt}${P.colon}${dd}`);
      }
    }
  }
  // .stats：每格 b（值）＋ span（欄位名） → 「人口：約 74 千人」
  for (const st of findAll(cardEl, (el) => hasClass(el, "stats"))) {
    for (const cell of st.children || []) {
      const b = findAll(cell, (el) => el.tagName === "B")[0], sp = findAll(cell, (el) => el.tagName === "SPAN")[0];
      const v = b ? tidy(textOf(b), P) : "", k = sp ? tidy(textOf(sp), P) : "";
      if (k && v) push(`${k}${P.colon}${v}`);
    }
  }

  let text = out.join(P.sentence);
  if (text.length > MAX_CHARS) {
    const cut = text.lastIndexOf(P.sentence, MAX_CHARS);
    text = cut > MAX_CHARS / 2 ? text.slice(0, cut) : text.slice(0, MAX_CHARS);
  }
  return text.trim();
}

// 把長文字切成幾段短的 utterance（在句號處切，不夠就硬切）
function chunk(text, P) {
  const parts = [];
  const sep = P.sentence.trim();
  let cur = "";
  for (const s of text.split(sep)) {
    const piece = s.trim();
    if (!piece) continue;
    const next = cur ? cur + P.sentence + piece : piece;
    if (next.length > CHUNK_CHARS && cur) { parts.push(cur); cur = piece; } else cur = next;
  }
  if (cur) parts.push(cur);
  // 還是太長的段（沒有句號）再硬切
  return parts.flatMap((p) => { const r = []; for (let i = 0; i < p.length; i += CHUNK_CHARS) r.push(p.slice(i, i + CHUNK_CHARS)); return r; });
}

export function createSpeech({ lang = "zh", t = (k, zh) => zh } = {}) {
  const L = VOICE_PREFS[lang] ? lang : "zh";
  const P = PUNCT[L];
  const g = typeof globalThis !== "undefined" ? globalThis : {};
  const synth = g.speechSynthesis && typeof g.SpeechSynthesisUtterance === "function" ? g.speechSynthesis : null;

  let enabled = false, unlocked = false, voice = null, voicesSeen = false, reason = "", gen = 0, timer = 0;

  // 依偏好順序挑語音；同一個 lang 標籤有多個時優先 default，再來本機語音
  function pickVoice() {
    if (!synth) return null;
    let list = [];
    try { list = synth.getVoices() || []; } catch { list = []; }
    if (!list.length) return null;
    voicesSeen = true;
    for (const want of VOICE_PREFS[L]) {
      const hits = list.filter((v) => { const vl = norm(v.lang); return want.includes("-") ? vl === want : vl === want || vl.startsWith(want + "-"); });
      if (hits.length) return hits.find((v) => v.default) || hits.find((v) => v.localService) || hits[0];
    }
    return null;
  }
  function refreshVoices() { voice = pickVoice(); }
  refreshVoices();
  // Chrome 第一次 getVoices() 常是空的，要等 voiceschanged
  if (synth) {
    try {
      if (typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", refreshVoices);
      else synth.onvoiceschanged = refreshVoices;
    } catch {}
    // 離開頁面（例如切語言重新載入）時把還在唸的停掉
    try { g.addEventListener?.("pagehide", () => { if (enabled) cancel(); }); } catch {}
  }

  // supported：有 speechSynthesis，而且（清單已載入時）有這個語言的語音。清單還沒載入時先樂觀視為可用。
  const supported = () => !!synth && (!voicesSeen ? true : !!(voice || pickVoice()));

  function cancel() {
    gen++;
    if (timer) { clearTimeout(timer); timer = 0; }
    try { synth?.cancel(); } catch {}
  }
  function utter(text) {
    const u = new g.SpeechSynthesisUtterance(text);
    if (!voice) refreshVoices();
    if (voice) u.voice = voice;
    u.lang = voice?.lang || UTTER_LANG[L];
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1;
    return u;
  }
  function speak(text) {
    if (!enabled || !synth) return;
    text = (text || "").trim();
    cancel();
    if (!text) return;
    const my = gen;
    // Chrome 在 cancel() 後立刻 speak() 偶爾會被吃掉，延後一個 tick 再排隊
    timer = setTimeout(() => {
      timer = 0;
      if (my !== gen || !enabled) return;
      try { if (synth.paused) synth.resume(); } catch {}
      for (const part of chunk(text, P)) { try { synth.speak(utter(part)); } catch {} }
    }, 0);
  }

  return {
    get supported() { return supported(); },
    get enabled() { return enabled; },
    get voiceName() { if (!voice) refreshVoices(); return voice?.name || ""; },
    get reason() { return reason; },
    get speaking() { try { return !!synth?.speaking; } catch { return false; } },
    lang: L,
    // iOS Safari：要在使用者手勢內先 speak 一次才會解鎖；之後的 speak 才能在非手勢（例如導覽換頁）時出聲
    unlock() {
      if (!synth || unlocked) return unlocked;
      try { const u = new g.SpeechSynthesisUtterance(" "); u.volume = 0; u.lang = UTTER_LANG[L]; synth.speak(u); unlocked = true; } catch {}
      return unlocked;
    },
    // 回傳是否成功；失敗時 reason 有翻譯好的原因
    setEnabled(on) {
      reason = "";
      if (!on) { enabled = false; cancel(); return true; }
      if (!synth) { reason = t("speech.unsupported", "這個瀏覽器沒有可用的語音"); return false; }
      if (!voice) refreshVoices();
      if (voicesSeen && !voice) { reason = t("speech.no_voice", "沒有{lang}語音，請在系統安裝", { lang: LANG_LABEL[L] }); return false; }
      enabled = true;
      return true;
    },
    speakCard(cardEl) { if (enabled) speak(cardToText(cardEl, L)); },
    speakText(text) { if (enabled) speak(text); },
    cardText: (cardEl) => cardToText(cardEl, L),
    stop() { if (synth) cancel(); },
  };
}
