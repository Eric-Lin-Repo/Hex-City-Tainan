// 市民對話：點選行人時，在卡片標題上方冒出三句對話泡泡。內容由 data/talk.json 的句型表加上行人資料拼成，不接 AI。
// 規則：第 1 句永遠是 greet（依年齡層）；第 2 句在 night（23:00～05:00）／rain／status（going 或 rest）之間輪流；
// 第 3 句所在區今天有活動就 event，否則 recommend（住區農特產與夜市）。同一個人連續點兩次會換句（以 id + 點選次數當種子）。
// 用法（app.js）：
//   const talk = createTalk({ t, islands, specialties: specData, pois: world.pois, roles, adjacency: world.adjacency, rnd: mulberry(7), data: talkData });
//   talk.bubbleHtml(talk.linesFor(people.info(id), { minute, raining, eventName }))
// data 可省略，省略時自己 fetch ./data/talk.json，載好前 linesFor 回空陣列、bubbleHtml 回空字串。

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const PLACEHOLDER = /\{(\w+)\}/g;
const NIGHT_FROM = 23 * 60, NIGHT_TO = 5 * 60;

// 字串雜湊（FNV-1a），讓同一個人每個句槽有固定起點，再用點選次數往後推
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const toMap = (src) => (src instanceof Map ? src : new Map((Array.isArray(src) ? src : []).map((x) => [x.id, x])));

export function createTalk({ t = (k, zh) => zh, islands, specialties, pois, roles, adjacency, rnd, data = null } = {}) {
  const islandMap = toMap(islands);
  const byDistrict = specialties?.byDistrict || specialties || {};
  const poiList = pois instanceof Map ? [...pois.values()] : Array.isArray(pois) ? pois : pois?.pois || [];
  const markets = poiList.filter((p) => p.type === "nightmarket");
  const roleMap = roles?.roles || roles || {};
  const salt = typeof rnd === "function" ? Math.floor(rnd() * 0xffff) : 0; // 每次開頁起點不同，但同一頁內連點仍可預期
  const clicks = new Map(); // walker id → 已點次數
  let scenes = data?.scenes || null;
  if (!scenes && typeof fetch === "function") fetch("./data/talk.json", { cache: "no-cache" }).then((r) => r.json()).then((d) => { scenes = d.scenes; }).catch((e) => console.warn("[hex-city] talk.json 載入失敗", e));

  const districtName = (id) => islandMap.get(id)?.name || "";
  const firstSpec = (id) => byDistrict[id]?.[0]?.name || "";
  // 住區的夜市優先，其次鄰近區；都沒有就拿全市任一家。有 open 旗標（world.setToday 設的）時先挑今天有開的
  function marketFor(home) {
    const near = new Set([home, ...(adjacency?.get?.(home) || [])]);
    const pick = (list) => (list.find((m) => m.open) || list[0])?.name || "";
    return pick(markets.filter((m) => near.has(m.district))) || pick(markets);
  }
  const isNight = (minute) => Number.isFinite(minute) && (minute >= NIGHT_FROM || minute < NIGHT_TO);

  // 從句型組裡挑一句：只挑佔位符都拿得到值的句子，索引 = 固定起點 + 點選次數，所以連點必換句
  function pick(scene, vars, seed, n) {
    const list = scenes?.[scene] || [];
    const ok = list.map((zh, i) => [zh, i]).filter(([zh]) => [...zh.matchAll(PLACEHOLDER)].every((m) => vars[m[1]]));
    if (!ok.length) return null;
    const [zh, i] = ok[(hash(`${seed}|${scene}|${salt}`) + n) % ok.length];
    return t(`talk.${scene}.${i + 1}`, zh, vars);
  }

  // info 來自 people.info(id)；ctx = { minute, raining, eventName|null }
  function linesFor(info, ctx = {}) {
    if (!info || !scenes) return [];
    const n = (clicks.get(info.id) || 0) + 1;
    clicks.set(info.id, n);
    const vars = {
      name: info.name || "", role: roleMap[info.role]?.label || info.role || "",
      home: districtName(info.home), at: districtName(info.at), dest: districtName(info.dest),
      spec: firstSpec(info.home), market: marketFor(info.home), event: ctx.eventName || "", carry: info.carry?.name || "",
    };
    const seed = String(info.id), step = n - 1;
    const greet = pick(`greet.${["elder", "child", "adult"].includes(info.age) ? info.age : "adult"}`, vars, seed, step);
    const second = [];
    if (isNight(ctx.minute)) second.push("night");
    if (ctx.raining) second.push("rain");
    second.push(info.status === "travel" || info.status === "flow" ? "going" : "rest");
    const middle = pick(second[step % second.length], vars, seed, step) || pick(second[second.length - 1], vars, seed, step);
    // 提著菜籃的人：第 3 句改聊籃子裡的特產（今天有活動時仍先講活動）
    const third = (vars.event && pick("event", vars, seed, step)) || (vars.carry && pick("basket", vars, seed, step)) || pick("recommend", vars, seed, step);
    return [greet, middle, third].filter(Boolean);
  }

  // 泡泡 HTML：純文字已 esc；三顆泡泡用 CSS nth-child 依序淡入
  function bubbleHtml(lines) {
    if (!lines?.length) return "";
    return `<div class="talk" aria-live="polite">${lines.map((s) => `<p class="talk-bubble"><span>${esc(s)}</span></p>`).join("")}</div>`;
  }

  return { linesFor, bubbleHtml, css: null };
}
