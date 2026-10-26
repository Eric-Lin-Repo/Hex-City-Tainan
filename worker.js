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

async function tdxToken(env, cache, force = false) {
  // token 有效 24 小時；存在邊緣快取 23 小時（TDX 要求重複使用 token，不要每次重取）
  const key = new Request("https://hexcity.internal/tdx-token?v=1");
  if (!force) { const hit = await cache.match(key); if (hit) return (await hit.json()).token; }
  const r = await fetch(TDX_TOKEN, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env.TDX_CLIENT_ID, client_secret: env.TDX_CLIENT_SECRET }) });
  if (!r.ok) throw new Error(`TDX token → ${r.status}`);
  const d = await r.json();
  if (!d.access_token) throw new Error("TDX token 回應沒有 access_token");
  await cache.put(key, new Response(JSON.stringify({ token: d.access_token }), { headers: { "cache-control": `max-age=${Math.min(82800, (d.expires_in || 86400) - 600)}` } }));
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
export async function fromTdx(env, cache, now = Date.now()) {
  if (!env.TDX_CLIENT_ID || !env.TDX_CLIENT_SECRET) throw Object.assign(new Error("尚未設定 TDX 金鑰"), { code: "no-key" });
  let token = await tdxToken(env, cache);
  const get = (tk) => fetch(TDX_A1, { headers: { authorization: `Bearer ${tk}`, accept: "application/json", "accept-encoding": "br, gzip" } });
  let r = await get(token);
  if (r.status === 401) { token = await tdxToken(env, cache, true); r = await get(token); } // token 過期就重取一次
  if (r.status === 429 || r.status === 403) throw Object.assign(new Error(`TDX 額度或頻率限制（${r.status}）`), { code: "quota" });
  if (!r.ok) throw new Error(`TDX A1 → ${r.status}`);
  const list = await r.json();
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
    keep = e.code === "no-key" ? 600 : e.code === "quota" ? 900 : 120; // 失敗時拉長快取，免得一直打 TDX 把額度耗光
  }
  const put = cache.put(key, new Response(JSON.stringify(body), { headers: { "cache-control": `public, max-age=${keep}` } }));
  ctx?.waitUntil ? ctx.waitUntil(put) : await put;
  return busJson(body, ttl);
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/reservoir") return reservoirApi(request, env, ctx);
    if (pathname === "/api/bus") return busApi(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
};
