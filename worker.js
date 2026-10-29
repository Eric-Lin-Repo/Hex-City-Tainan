// Cloudflare Worker：/api/reservoir 代理水利署開放資料的水庫水情，並在邊緣快取 1 小時；
// /api/bus 代理交通部 TDX 的台南市公車即時位置（只留六色幹線與支線），邊緣快取 BUS_TTL 秒；其餘路徑交給靜態資產（dist/）。
// 資料：opendata.wra.gov.tw 的「水庫水情資料」（每小時，給有效蓄水量與水位）＋「水庫每日營運狀況」（給名稱、有效容量、滿水位、呆水位），
// 以 reservoiridentifier 對起來算蓄水率。舊的 fhy.wra.gov.tw/WraApi 已停用（503／530）。兩支都失敗就回 data/reservoir_fallback.json。
const OPEN = "https://opendata.wra.gov.tw/api/v2/";
const REALTIME = OPEN + "2be9044c-6e44-4856-aad5-dd108c2e6679?format=JSON&size=1000"; // 水庫水情資料
const DAILY = OPEN + "51023e88-4c76-4dbc-bbb9-470da690d539?format=JSON&size=1000"; // 水庫每日營運狀況
// 水利署水庫代碼 → 本站湖泊名稱（data/water_mrt.json 的 lakes.name）。2026-10-26 以每日營運狀況的 reservoirname 驗證過；
// 尖山埤（台糖經營）不在水利署資料裡，固定回 null。
const IDS = { 30502: "曾文水庫", 30501: "烏山頭水庫", 30503: "南化水庫", 30401: "白河水庫", 30504: "鏡面水庫" };
const NAMES = [...Object.values(IDS), "尖山埤"];
const EDGE_TTL = 3600; // 邊緣快取（秒）
const HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=600" };

const num = (v) => (v === null || v === undefined || v === "" || isNaN(+v) ? null : +v);
const json = (body) => new Response(JSON.stringify(body), { headers: HEADERS });

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (hex-city-tainan)" } });
  const name = url.split("/").pop().split("?")[0].slice(0, 8);
  if (!r.ok) throw new Error(`${name} → ${r.status}`);
  const text = await r.text();
  try { return JSON.parse(text); } catch { throw new Error(`${name} → ${r.status}，${text.length} 字元，不是 JSON：${text.slice(0, 80)}`); } // 錯誤訊息帶回應開頭，方便判斷是被擋還是逾時
}

// 蓄水率 = 最新一筆有效蓄水量 ÷ 有效容量；另外帶水位、滿水位、呆水位給卡片的水位計
export async function fromOpenData() { // 也給 tools/fetch_reservoir.mjs 用來更新備援檔
  const [rt, daily] = await Promise.all([getJson(REALTIME), getJson(DAILY)]);
  if (!Array.isArray(rt) || !Array.isArray(daily)) throw new Error("水利署開放資料回應不是陣列");
  const info = new Map(daily.map((d) => [String(d.reservoiridentifier), d]));
  const latest = new Map(); // 每座只留有蓄水量的最新一筆（同一份資料有多個整點）
  for (const r of rt) {
    const id = String(r.reservoiridentifier ?? "");
    if (!(id in IDS) || num(r.effectivewaterstoragecapacity) === null) continue;
    if (!latest.has(id) || r.observationtime > latest.get(id).observationtime) latest.set(id, r);
  }
  const reservoirs = { 尖山埤: null }, times = [];
  for (const [id, name] of Object.entries(IDS)) {
    const d = info.get(id), cur = latest.get(id);
    const cap = num(d?.capacity), store = num(cur?.effectivewaterstoragecapacity);
    if (cap === null || store === null || cap <= 0) { reservoirs[name] = null; continue; }
    const asOf = cur.observationtime ? cur.observationtime + "+08:00" : null; // 資料是台灣時間、不帶時區
    reservoirs[name] = {
      percent: +Math.min(100, Math.max(0, (store / cap) * 100)).toFixed(1), asOf,
      storage: store, capacity: cap, // 萬立方公尺
      level: num(cur.waterlevel), full: num(d.nwlmax), dead: num(d.dwl), // 公尺
    };
    if (asOf) times.push(asOf);
  }
  if (!times.length) throw new Error("水利署資料對不到任何水庫");
  return { ok: true, asOf: times.sort().at(-1), source: "wra", reservoirs };
}

// 備援：讀靜態資產裡的 reservoir_fallback.json
async function fromFallback(request, env) {
  const r = await env.ASSETS.fetch(new URL("/data/reservoir_fallback.json", request.url));
  if (!r.ok) throw new Error(`fallback → ${r.status}`);
  const d = await r.json();
  const reservoirs = {};
  for (const name of NAMES) {
    const v = d.reservoirs?.[name];
    reservoirs[name] = v && num(v.percent) !== null ? { ...v, percent: num(v.percent), asOf: v.asOf || d.asOf || null } : null;
  }
  return { ok: true, asOf: d.asOf || null, source: "fallback", reservoirs };
}

async function reservoirApi(request, env, ctx) {
  const cache = caches.default;
  const key = new Request(new URL("/api/reservoir?cache=v3", request.url), { method: "GET" }); // 忽略使用者的 query，同一份快取；改資料來源或格式時把 v2 往上加，舊快取就不會再被讀到
  const hit = await cache.match(key);
  if (hit) return json(await hit.json());
  let body;
  try {
    body = await fromOpenData();
  } catch (e) {
    try {
      body = await fromFallback(request, env);
      body.error = String(e.message || e); // 讓前端知道為什麼是備援
    } catch (e2) {
      return new Response(JSON.stringify({ ok: false, error: String(e2.message || e2) }), { status: 502, headers: HEADERS });
    }
  }
  // 快取副本用邊緣 TTL（備援資料縮短到 10 分鐘，API 恢復就能較快切回即時）
  const ttl = body.source === "wra" ? EDGE_TTL : 600;
  const copy = new Response(JSON.stringify(body), { headers: { ...HEADERS, "cache-control": `public, max-age=${ttl}` } });
  const put = cache.put(key, copy);
  ctx?.waitUntil ? ctx.waitUntil(put) : await put;
  return json(body);
}

// ── 公車即時位置（TDX A1：RealTimeByFrequency）──
// 金鑰用 wrangler secret 設定（TDX_CLIENT_ID、TDX_CLIENT_SECRET），只在 Worker 裡用，不會送到瀏覽器。
// TDX 免費方案每月額度很少：只有有人開著網頁時才會打（前端 30 秒問一次，同一個邊緣節點 BUS_TTL 秒內共用一份），
// 額度用完或沒設金鑰時回 ok:false，前端改用模擬行駛。
const TDX_TOKEN = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const TDX_A1 = "https://tdx.transportdata.tw/api/basic/v2/Bus/RealTimeByFrequency/City/Tainan?$format=JSON&$top=2000"
  + "&$select=PlateNumb,RouteName,SubRouteName,Direction,BusPosition,Speed,Azimuth,DutyStatus,BusStatus,GPSTime,UpdateTime";
const BUS_COLOR = /^(藍|綠|紅|橘|黃|棕)(幹線|\d)/; // 六色路線；純數字的市區公車不收
const BUS_STALE_MS = 5 * 60 * 1000; // GPS 超過 5 分鐘沒更新的車不收（TDX 會保留 2 小時內最後一筆）
const busJson = (body, ttl) => new Response(JSON.stringify(body), { headers: { ...HEADERS, "cache-control": `public, max-age=${Math.min(ttl, 30)}` } });

async function tdxToken(env, cache, force = false, now = Date.now()) {
  // token 有效 24 小時：存在 KV（全部機房共用同一個）與邊緣快取，23 小時內重複使用（TDX 要求重複使用 token；每個機房各自重取會撞到頻率限制）
  const key = new Request("https://hexcity.internal/tdx-token?v=1"), kv = env.HEXCITY_QUOTA;
  if (!force) {
    const hit = await cache.match(key);
    if (hit) return (await hit.json()).token;
    const shared = kv && (await kv.get("tdx:token"));
    if (shared) { await cache.put(key, new Response(JSON.stringify({ token: shared }), { headers: { "cache-control": "max-age=3600" } })); return shared; }
  }
  await tdxMinute(env, now); // 取 token 也算一次呼叫
  const r = await fetch(TDX_TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.TDX_CLIENT_ID, client_secret: env.TDX_CLIENT_SECRET }) });
  if (r.status === 429) throw Object.assign(new Error("TDX token 頻率限制（429）"), { code: "busy" });
  if (!r.ok) throw new Error(`TDX token → ${r.status}`);
  const d = await r.json();
  if (!d.access_token) throw new Error("TDX token 回應沒有 access_token");
  const ttl = Math.min(82800, (d.expires_in || 86400) - 600);
  await cache.put(key, new Response(JSON.stringify({ token: d.access_token }), { headers: { "cache-control": `max-age=${ttl}` } }));
  if (kv) await kv.put("tdx:token", d.access_token, { expirationTtl: ttl });
  return d.access_token;
}
// TDX A1 的一筆 → 前端用的精簡格式；不要的（非六色、非營運、太舊、沒座標）回 null
export function slimBus(b, now = Date.now()) {
  const route = b?.RouteName?.Zh_tw ?? "";
  const lat = +b?.BusPosition?.PositionLat, lon = +b?.BusPosition?.PositionLon;
  if (!BUS_COLOR.test(route) || !Number.isFinite(lat) || !Number.isFinite(lon) || !lat || !lon) return null;
  if (b.BusStatus === 99 || b.DutyStatus === 2) return null; // 非營運狀態、結束營運
  const gps = Date.parse(b.GPSTime);
  if (!Number.isFinite(gps) || now - gps > BUS_STALE_MS) return null;
  return { plate: b.PlateNumb, route, sub: b.SubRouteName?.Zh_tw ?? null, dir: b.Direction, lat: +lat.toFixed(6), lon: +lon.toFixed(6),
    speed: Number.isFinite(+b.Speed) ? +b.Speed : null, az: Number.isFinite(+b.Azimuth) ? +b.Azimuth : null, gps: b.GPSTime };
}
// ── TDX 每日額度：免費方案每月 3 點（約 4,500 次），公車、YouBike、台鐵、快速道路共用 ──
// 邊緣快取是每個機房各一份，所以計數放 KV（HEXCITY_QUOTA，key「tdx:台灣日期:用途」）才會全域共用；KV 最終一致，可能多打幾次，上限留了緩衝。
// 合計每天約 137 次 ≈ 每月 4,100 次。沒綁 KV（本機測試）時不設限。
export const TDX_DAILY = { bus: 33, ybStation: 1, ybAvail: 30, traDaily: 6, thsrDaily: 1, traLive: 25, hwSection: 5, hwLive: 12, fwLive: 24 };
const taipeiDay = (now = Date.now()) => new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
const taipeiMinute = (now = Date.now()) => new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 16);
// 每分鐘上限：TDX 每把金鑰每分鐘 5 次（2026-10-29 線上同時抓 6 段台鐵時刻表就被 429），全部用途合計每分鐘最多 4 次（env.TDX_PER_MIN 可改，測試用）；
// 超過丟 code "busy"（只快取 1 分鐘，前端下次輪詢再試）。KV 最終一致，跨機房可能多一兩次，所以留一次緩衝。
export async function tdxMinute(env, now = Date.now()) {
  const kv = env.HEXCITY_QUOTA;
  if (!kv) return;
  const key = `tdxm:${taipeiMinute(now)}`, n = +(await kv.get(key)) || 0;
  if (n >= (+env.TDX_PER_MIN || 4)) throw Object.assign(new Error("TDX 這一分鐘的呼叫次數已滿，稍後再試"), { code: "busy" });
  await kv.put(key, String(n + 1), { expirationTtl: 120 });
}
export async function tdxAllow(env, feed, now = Date.now()) {
  const kv = env.HEXCITY_QUOTA;
  if (!kv) return true;
  const key = `tdx:${taipeiDay(now)}:${feed}`, n = +(await kv.get(key)) || 0;
  if (n >= (TDX_DAILY[feed] ?? 0)) return false;
  await kv.put(key, String(n + 1), { expirationTtl: 3 * 86400 });
  return true;
}
// 被 TDX 擋下（429、403、5xx）的那次不算當天額度
async function tdxRefund(env, feed, now = Date.now()) {
  const kv = env.HEXCITY_QUOTA;
  if (!kv) return;
  const key = `tdx:${taipeiDay(now)}:${feed}`, n = +(await kv.get(key)) || 0;
  if (n > 0) await kv.put(key, String(n - 1), { expirationTtl: 3 * 86400 });
}
// 打一次 TDX：先看每分鐘上限、再扣當天額度，token 過期重取一次。沒金鑰丟 "no-key"、當天額度用完丟 "quota"、頻率限制丟 "busy"
export async function tdxFetch(env, cache, url, feed, now = Date.now()) {
  if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) throw Object.assign(new Error("尚未設定 TDX 金鑰"), { code: "no-key" });
  let token = await tdxToken(env, cache, false, now);
  await tdxMinute(env, now);
  if (!(await tdxAllow(env, feed, now))) throw Object.assign(new Error(`今日 TDX 額度已用完（${feed}）`), { code: "quota" });
  const get = (tk) => fetch(url, { headers: { authorization: `Bearer ${tk}`, accept: "application/json", "accept-encoding": "br, gzip" } });
  let r = await get(token);
  if (r.status === 401) { token = await tdxToken(env, cache, true, now); r = await get(token); } // token 過期就重取一次
  if (r.status === 429 || r.status === 403 || r.status >= 500) await tdxRefund(env, feed, now);
  if (r.status === 429) throw Object.assign(new Error("TDX 頻率限制（429）"), { code: "busy" });
  if (r.status === 403) throw Object.assign(new Error("TDX 拒絕（403，可能是月額度用完）"), { code: "quota" });
  if (!r.ok) throw new Error(`TDX ${url.split("/api/basic/")[1]?.split("?")[0] ?? ""} → ${r.status}`);
  return r.json();
}

export async function fromTdx(env, cache, now = Date.now()) {
  const list = await tdxFetch(env, cache, TDX_A1, "bus", now);
  if (!Array.isArray(list)) throw new Error("TDX 回應不是陣列");
  const buses = list.map((b) => slimBus(b, now)).filter(Boolean);
  const asOf = list.map((b) => b.UpdateTime).filter(Boolean).sort().at(-1) ?? null;
  return { ok: true, source: "tdx", asOf, total: list.length, buses };
}
async function busApi(request, env, ctx) {
  const cache = caches.default;
  const ttl = Math.max(20, +env.BUS_TTL || 60);
  const key = new Request(new URL("/api/bus?cache=v1", request.url), { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return busJson(await hit.json(), ttl);
  let body, keep = ttl;
  try {
    body = await fromTdx(env, cache);
  } catch (e) {
    body = { ok: false, code: e.code || "error", error: String(e.message || e) };
    keep = e.code === "no-key" || e.code === "busy" ? 60 : e.code === "quota" ? 900 : 120; // 失敗時拉長快取，免得一直打 TDX 把額度耗光；沒金鑰只快取 1 分鐘，設好 secret 馬上生效
  }
  const put = cache.put(key, new Response(JSON.stringify(body), { headers: { "cache-control": `public, max-age=${keep}` } }));
  ctx?.waitUntil ? ctx.waitUntil(put) : await put;
  return busJson(body, ttl);
}

// ── 國道與快速道路即時車速（TDX 路況，最多 30 分鐘一次）──
// 國道 1、3、8 號：TDX 的高公局路段即時路況，只抓台南的 56 個路段（data/freeway_sections.json，由 tools/build_traffic.py 從高公局路段檔產生，SectionID 與 TDX 相同）。
//   高公局「交通資料庫」tisvcloud 的 LiveTraffic.xml 免金鑰，但擋 Cloudflare 的連線（2026-10-29 實測 522），所以改走 TDX。
// 台 61、84、86 快速道路：TDX 公路局省道路段；路段清單與線形每天抓一次（/api/expressway-sections）。
// 回 { freeway: { ok, speeds: { id: [km/h, 壅塞等級] } }, express: { 同上 } }
const FREEWAY_TTL = 1800, EXPRESS_TTL = 1800, SECTION_TTL = 86400;
const TDX_ROAD = "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic";
const EXPRESS_ROAD = /(^|[^0-9])(61|84|86)([^0-9]|$)/; // 台61、台84、台86（RoadName 可能是「台61線」「臺61線」）
const TAINAN = { lon: [120.0, 120.7], lat: [22.85, 23.45] }; // 粗略範圍，前端還會再逐段比對
const listOf = (d, key) => (Array.isArray(d) ? d : d?.[key] ?? []);
// TDX 路況（Live/Freeway、Live/Highway）→ { asOf, speeds }，只抓 ids 這些路段；車速 ≤ 0 或資料異常（-99）的不收
export async function liveSpeeds(env, cache, kind, ids, feed) {
  const filter = ids.map((id) => `SectionID eq '${id}'`).join(" or ");
  const d = await tdxFetch(env, cache, `${TDX_ROAD}/Live/${kind}?$format=JSON&$select=SectionID,TravelSpeed,CongestionLevel,DataCollectTime&$filter=${encodeURIComponent(filter)}`, feed);
  const speeds = {};
  let asOf = null;
  for (const x of listOf(d, "LiveTraffics")) {
    if (!(x.TravelSpeed > 0) || x.CongestionLevel < 0) continue;
    speeds[x.SectionID] = [x.TravelSpeed, x.CongestionLevel];
    if (x.DataCollectTime && (!asOf || x.DataCollectTime > asOf)) asOf = x.DataCollectTime;
  }
  return { asOf: asOf ?? d?.UpdateTime ?? null, speeds };
}
const inTainan = (pts) => pts.some(([lon, lat]) => lon >= TAINAN.lon[0] && lon <= TAINAN.lon[1] && lat >= TAINAN.lat[0] && lat <= TAINAN.lat[1]);
const wktPts = (g) => (typeof g === "string" && g.includes("(") ? g.slice(g.indexOf("(") + 1, g.lastIndexOf(")")).replace(/[()]/g, "").split(",").map((p) => p.trim().split(/\s+/).map(Number)) : []);
// 快速道路在台南的路段：Section 找出台 61、84、86 的路段，再分批（一次 100 個路段）抓線形，只留台南範圍內的。
// 進度存 KV（dayPut "hwSections"）：被每分鐘上限打斷時，下次從斷掉的那批接著抓，不重抓路段清單；一次請求最多抓 2 批。
const HW_BATCH = 100, HW_BATCHES_PER_REQ = 2;
export async function expressSections(env, cache, now = Date.now()) {
  let st = await dayGet(env, cache, "hwSections", now);
  if (st?.done) return { ok: true, source: "tdx", sections: st.out };
  if (!st) {
    const sec = await tdxFetch(env, cache, `${TDX_ROAD}/Section/Highway?$format=JSON&$select=SectionID,SectionName,RoadName,RoadDirection,SpeedLimit`, "hwSection", now);
    const cand = listOf(sec, "Sections").filter((x) => EXPRESS_ROAD.test(x.RoadName ?? "")).map((x) => ({ id: x.SectionID, name: x.SectionName ?? x.RoadName, road: x.RoadName.match(EXPRESS_ROAD)[2], dir: x.RoadDirection ?? null, limit: x.SpeedLimit ?? null }));
    st = { cand, next: 0, out: [], done: !cand.length };
    await dayPut(env, cache, "hwSections", st, now);
  }
  for (let k = 0; k < HW_BATCHES_PER_REQ && st.next < st.cand.length; k++) {
    const ids = st.cand.slice(st.next, st.next + HW_BATCH), filter = ids.map((x) => `SectionID eq '${x.id}'`).join(" or ");
    const shp = await tdxFetch(env, cache, `${TDX_ROAD}/SectionShape/Highway?$format=JSON&$select=SectionID,Geometry&$filter=${encodeURIComponent(filter)}`, "hwSection", now);
    const geo = new Map(listOf(shp, "SectionShapes").map((x) => [x.SectionID, wktPts(x.Geometry)]));
    for (const x of ids) {
      const pts = geo.get(x.id) || [];
      if (pts.length >= 2 && inTainan(pts)) st.out.push({ id: x.id, name: x.name, route: `pr${x.road}`, dir: x.dir, limit: x.limit, pts: pts.map(([lon, lat]) => [+lon.toFixed(5), +lat.toFixed(5)]) });
    }
    st.next += ids.length;
    st.done = st.next >= st.cand.length;
    await dayPut(env, cache, "hwSections", st, now);
  }
  if (!st.done) throw Object.assign(new Error(`快速道路路段下載中（${st.next}/${st.cand.length}）`), { code: "loading" });
  return { ok: true, source: "tdx", sections: st.out };
}
// 每天一份的資料（台鐵各段時刻表、高鐵時刻表、YouBike 站點、快速道路路段）：存 KV「day:台灣日期:名稱」，全部機房共用，
// 一天只向 TDX 抓一次（邊緣快取是每個機房各一份，2026-10-29 線上實測不同機房各抓一次把當天額度用完）。沒綁 KV（本機）時用邊緣快取。
const dayKey = (name, now = Date.now()) => `day:${taipeiDay(now)}:${name}`;
export async function dayGet(env, cache, name, now = Date.now()) {
  if (env.HEXCITY_QUOTA) { const v = await env.HEXCITY_QUOTA.get(dayKey(name, now)); return v ? JSON.parse(v) : null; }
  const hit = await cache.match(new Request(`https://hexcity.internal/${dayKey(name, now)}`));
  return hit ? hit.json() : null;
}
export async function dayPut(env, cache, name, value, now = Date.now()) {
  const text = JSON.stringify(value);
  if (env.HEXCITY_QUOTA) return env.HEXCITY_QUOTA.put(dayKey(name, now), text, { expirationTtl: 2 * 86400 });
  await cache.put(new Request(`https://hexcity.internal/${dayKey(name, now)}`), new Response(text, { headers: { "cache-control": "max-age=86400" } }));
}
const SHORT = new Set(["no-key", "busy", "loading"]); // 這些失敗只快取 1 分鐘：設好金鑰、下一分鐘、下次補抓就會好
async function cached(cache, url, ttl, make, failTtl = ttl) { // 邊緣快取包一層：失敗也快取（failTtl），免得一直重打
  const key = new Request(url), hit = await cache.match(key);
  if (hit) return hit.json();
  let body, keep = ttl;
  try { body = await make(); } catch (e) { body = { ok: false, code: e.code || "error", error: String(e.message || e) }; keep = SHORT.has(e.code) ? 60 : failTtl; }
  await cache.put(key, new Response(JSON.stringify(body), { headers: { "cache-control": `public, max-age=${keep}` } }));
  return body;
}
async function freewayApi(request, env, ctx) {
  const cache = caches.default, base = new URL(request.url).origin;
  const sectionsBody = () => cached(cache, `${base}/api/expressway-sections?cache=v3`, SECTION_TTL, () => expressSections(env, cache), 3600);
  if (new URL(request.url).pathname === "/api/expressway-sections") return json(await sectionsBody());
  const freeway = await cached(cache, `${base}/api/freeway?cache=v2`, FREEWAY_TTL, async () => {
    const meta = await env.ASSETS.fetch(new URL("/data/freeway_sections.json", request.url)).then((r) => r.json());
    const live = await liveSpeeds(env, cache, "Freeway", meta.sections.map((x) => x.id), "fwLive");
    if (!Object.keys(live.speeds).length) throw Object.assign(new Error("TDX 國道路況對不到台南的路段"), { code: "no-data" });
    return { ok: true, source: "tdx", ...live };
  }, FREEWAY_TTL);
  const express = await cached(cache, `${base}/api/freeway-express?cache=v3`, EXPRESS_TTL, async () => {
    const secs = await sectionsBody();
    if (!secs.ok) throw Object.assign(new Error(secs.error || "快速道路路段清單取得失敗"), { code: secs.code });
    if (!secs.sections.length) throw Object.assign(new Error("TDX 沒有台 61、84、86 在台南的路段"), { code: "no-data" });
    return { ok: true, source: "tdx", ...(await liveSpeeds(env, cache, "Highway", secs.sections.map((x) => x.id), "hwLive")) };
  }, EXPRESS_TTL);
  return new Response(JSON.stringify({ ok: freeway.ok, freeway, express }), { headers: { ...HEADERS, "cache-control": "public, max-age=30" } });
}

// ── YouBike 2.0（台南 793 站，涵蓋 37 區）──
// 主要用 TDX：站點清單每天一次（ybStation）、可借可還每 3 分鐘一次（ybAvail）；TDX 額度用完或失敗時改抓 YouBike 官網前端用的 feed
// （apis.youbike.com.tw，非正式公告的 API、授權未明，只當備援；全國約 6 MB，只留台南 area_code 13）。
// 回 { ok, source, asOf, stations: [[id, 站名, lat, lon, 車位數, 可借, 可還, 其中電輔車, 狀態 1 正常／0 停止／2 暫停]] }
const TDX_BIKE = "https://tdx.transportdata.tw/api/basic/v2/Bike";
const YB_FEED = "https://apis.youbike.com.tw/json/station-yb2.json";
const YB_TTL = 180;
const ybName = (n) => String(n ?? "").replace(/^YouBike2\.0_/, "");
export function mergeBike(stations, avail) {
  const a = new Map(listOf(avail, "").map((x) => [x.StationUID, x]));
  let asOf = null;
  const out = [];
  for (const s of listOf(stations, "")) {
    const v = a.get(s.StationUID), lat = +s.StationPosition?.PositionLat, lon = +s.StationPosition?.PositionLon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !lat) continue;
    if (v?.UpdateTime && (!asOf || v.UpdateTime > asOf)) asOf = v.UpdateTime;
    out.push([s.StationUID, ybName(s.StationName?.Zh_tw), +lat.toFixed(5), +lon.toFixed(5), s.BikesCapacity ?? null,
      v ? v.AvailableRentBikes ?? null : null, v ? v.AvailableReturnBikes ?? null : null, v?.AvailableRentBikesDetail?.ElectricBikes ?? null, v ? v.ServiceStatus ?? 1 : null]);
  }
  return { asOf, stations: out };
}
export function fromYbFeed(list) { // 官網 feed → 同樣格式；available_spaces 是可借、empty_spaces 是可還
  const out = [];
  let asOf = null;
  for (const x of Array.isArray(list) ? list : []) {
    if (String(x.area_code) !== "13") continue;
    const lat = +x.lat, lon = +x.lng;
    if (!Number.isFinite(lat) || !lat) continue;
    if (x.updated_at && (!asOf || x.updated_at > asOf)) asOf = x.updated_at;
    out.push([`TNN${x.station_no}`, ybName(x.name_tw), +lat.toFixed(5), +lon.toFixed(5), num(x.parking_spaces), num(x.available_spaces), num(x.empty_spaces),
      x.available_spaces_detail?.eyb ?? null, +x.status === 1 ? 1 : 0]);
  }
  return { asOf: asOf ? asOf.replace(" ", "T") + "+08:00" : null, stations: out };
}
async function youbikeApi(request, env) {
  const cache = caches.default, base = new URL(request.url).origin;
  const body = await cached(cache, `${base}/api/youbike?cache=v3`, YB_TTL, async () => {
    try {
      let stations = await dayGet(env, cache, "ybStations");
      if (!stations) { stations = await tdxFetch(env, cache, `${TDX_BIKE}/Station/City/Tainan?$format=JSON&$top=2000&$select=StationUID,StationName,StationPosition,BikesCapacity`, "ybStation"); await dayPut(env, cache, "ybStations", stations); }
      const avail = await tdxFetch(env, cache, `${TDX_BIKE}/Availability/City/Tainan?$format=JSON&$top=2000&$select=StationUID,ServiceStatus,AvailableRentBikes,AvailableReturnBikes,AvailableRentBikesDetail,UpdateTime`, "ybAvail");
      const m = mergeBike(stations, avail);
      if (!m.stations.length) throw new Error("TDX 沒有台南的 YouBike 站");
      return { ok: true, source: "tdx", ...m };
    } catch (e) { // TDX 不行就用官網 feed
      const r = await fetch(YB_FEED, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (hex-city-tainan)" } });
      if (!r.ok) throw new Error(`TDX：${e.message}；YouBike 官網 → ${r.status}`);
      const m = fromYbFeed(await r.json());
      if (!m.stations.length) throw new Error(`TDX：${e.message}；YouBike 官網沒有台南的站`);
      return { ok: true, source: "youbike", tdxError: String(e.message || e), ...m };
    }
  }, 300);
  return new Response(JSON.stringify(body), { headers: { ...HEADERS, "cache-control": "public, max-age=60" } });
}

// ── 台鐵、高鐵的真實班表（TDX）──
// 免費 Worker 每次只有約 10 ms CPU，不能解析全國整天的時刻表（好幾 MB），所以台鐵用起迄站時刻表（含途經站）分段抓：
// 嘉義↔臺南、臺南↔高雄、臺南↔沙崙各兩個方向，一天 6 次，用車次合併、只留台南 17 站；台南境內起訖、不經過嘉義或高雄的區間車會漏掉。
// 每段各自快取一天；TDX 每分鐘只能 5 次，所以一次請求最多補抓 TRA_PARTS_PER_REQ 段，前端輪詢幾次（5 分鐘一次）才會補齊，補齊前 tra 回 code "loading"。
// 高鐵沒有即時位置，抓整天時刻表（約 150 班）只留台南站的到離站時間；不停台南站的直達車也會漏掉。
// 台鐵誤點：TrainLiveBoard（列車最後經過的車站與誤點分鐘），5 分鐘一次。
const TDX_TRA = "https://tdx.transportdata.tw/api/basic/v3/Rail/TRA", TDX_THSR = "https://tdx.transportdata.tw/api/basic/v2/Rail/THSR";
export const TRA_TAINAN = ["4110", "4120", "4130", "4140", "4150", "4160", "4170", "4180", "4190", "4200", "4210", "4220", "4250", "4260", "4270", "4271", "4272"]; // 臺鐵官方站碼（後壁～沙崙）
const TRA_OD = [["4080", "4220"], ["4220", "4080"], ["4220", "4400"], ["4400", "4220"], ["4220", "4272"], ["4272", "4220"]]; // 嘉義、臺南、高雄、沙崙
const DELAY_TTL = 300, TRA_PARTS_PER_REQ = 2;
const toMin = (hhmm) => { const m = String(hhmm ?? "").match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
// 起迄站時刻表（數份）→ [{ no, type, dest, stops: [[站碼, 到站分, 離站分]] }]，只留台南的站；跨午夜的站加 1440
export function traTrains(parts) {
  const byNo = new Map(), keep = new Set(TRA_TAINAN);
  for (const part of parts) for (const tt of listOf(part, "TrainTimetables")) {
    const info = tt.TrainInfo ?? {}, no = info.TrainNo;
    if (!no) continue;
    const t = byNo.get(no) ?? { no, type: info.TrainTypeName?.Zh_tw ?? "", dest: info.EndingStationName?.Zh_tw ?? "", stops: new Map() };
    for (const st of tt.StopTimes ?? []) if (keep.has(st.StationID) && !t.stops.has(st.StationID)) t.stops.set(st.StationID, [st.StopSequence ?? 0, toMin(st.ArrivalTime ?? st.DepartureTime), toMin(st.DepartureTime ?? st.ArrivalTime)]);
    byNo.set(no, t);
  }
  const out = [];
  for (const t of byNo.values()) {
    const stops = [...t.stops].sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]).map(([sid, [, arr, dep]]) => [sid, arr, dep]);
    let prev = -1, add = 0;
    for (const st of stops) { if (st[1] + add < prev - 600) add += 1440; st[1] += add; st[2] += add; if (st[2] < st[1]) st[2] += 1440; prev = st[2]; }
    if (stops.length && stops.every((s) => s[1] != null)) out.push({ no: t.no, type: t.type, dest: t.dest, stops });
  }
  return out.sort((a, b) => a.stops[0][1] - b.stops[0][1]);
}
// 高鐵整天時刻表 → [{ no, dir（0 南下、1 北上）, dest, arr, dep }]（台南站）
export function thsrTrains(list) {
  const out = [];
  for (const tt of listOf(list, "")) {
    const st = (tt.StopTimes ?? []).find((x) => x.StationName?.En === "Tainan" || /台南|臺南/.test(x.StationName?.Zh_tw ?? ""));
    const info = tt.DailyTrainInfo ?? {};
    if (!st || !info.TrainNo) continue;
    const arr = toMin(st.ArrivalTime ?? st.DepartureTime), dep = toMin(st.DepartureTime ?? st.ArrivalTime);
    if (arr == null) continue;
    out.push({ no: info.TrainNo, dir: info.Direction ?? 0, dest: info.EndingStationName?.Zh_tw ?? "", arr, dep: dep < arr ? dep + 1440 : dep });
  }
  return out.sort((a, b) => a.arr - b.arr);
}
async function railApi(request, env) {
  const cache = caches.default, base = new URL(request.url).origin, day = taipeiDay();
  let tra;
  if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) tra = { ok: false, code: "no-key", error: "尚未設定 TDX 金鑰" };
  else {
    const parts = [];
    let budget = TRA_PARTS_PER_REQ, err = null;
    for (const [o, d] of TRA_OD) { // 已經抓過的段從快取拿；沒抓過的這次最多補 2 段
      const hit = await dayGet(env, cache, `tra:${o}-${d}`);
      if (hit) { parts.push(hit); continue; }
      if (budget <= 0 || err) continue;
      budget--;
      try {
        const part = await tdxFetch(env, cache, `${TDX_TRA}/DailyTrainTimetable/OD/Inclusive/${o}/to/${d}/${day}?$format=JSON`, "traDaily");
        await dayPut(env, cache, `tra:${o}-${d}`, part);
        parts.push(part);
      } catch (e) { err = e; }
    }
    const trains = parts.length === TRA_OD.length ? traTrains(parts) : [];
    tra = trains.length ? { ok: true, trains }
      : parts.length === TRA_OD.length ? { ok: false, code: "no-data", error: "TDX 台鐵時刻表沒有台南的車次" }
      : { ok: false, code: err?.code === "quota" || err?.code === "no-key" ? err.code : "loading", error: err ? String(err.message || err) : `台鐵時刻表下載中（${parts.length}/${TRA_OD.length}）`, have: parts.length };
  }
  const thsr = await cached(cache, `${base}/api/rail-thsr?date=${day}&v=3`, 3600, async () => {
    let trains = await dayGet(env, cache, "thsr");
    if (!trains) { trains = thsrTrains(await tdxFetch(env, cache, `${TDX_THSR}/DailyTimetable/TrainDate/${day}?$format=JSON`, "thsrDaily")); await dayPut(env, cache, "thsr", trains); }
    if (!trains.length) throw Object.assign(new Error("TDX 高鐵時刻表沒有台南站"), { code: "no-data" });
    return { ok: true, trains };
  }, 3600);
  const delays = await cached(cache, `${base}/api/rail-delay?v=2`, DELAY_TTL, async () => {
    const d = await tdxFetch(env, cache, `${TDX_TRA}/TrainLiveBoard?$format=JSON&$select=TrainNo,StationID,DelayTime,UpdateTime`, "traLive");
    const map = {};
    for (const x of listOf(d, "TrainLiveBoards")) if (x.TrainNo && Number.isFinite(+x.DelayTime)) map[x.TrainNo] = +x.DelayTime;
    return { ok: true, asOf: d?.UpdateTime ?? null, delays: map };
  }, DELAY_TTL);
  return new Response(JSON.stringify({ ok: tra.ok || thsr.ok, date: day, tra, thsr, delays }), { headers: { ...HEADERS, "cache-control": "public, max-age=60" } });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/reservoir") return reservoirApi(request, env, ctx);
    if (pathname === "/api/bus") return busApi(request, env, ctx);
    if (pathname === "/api/freeway" || pathname === "/api/expressway-sections") return freewayApi(request, env, ctx);
    if (pathname === "/api/youbike") return youbikeApi(request, env);
    if (pathname === "/api/rail") return railApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
