// worker.js 的 /api/bus 測試：用假的 fetch 與 caches 模擬 TDX，不會連網、不需要金鑰。
// 用法（專案根目錄）：node tools/test_worker_bus.mjs
import assert from "node:assert/strict";

const store = new Map();
globalThis.caches = { default: {
  match: async (req) => { const v = store.get(typeof req === "string" ? req : req.url); return v ? new Response(v) : undefined; },
  put: async (req, res) => { store.set(typeof req === "string" ? req : req.url, await res.text()); },
} };
const calls = [];
let a1Status = 200, tokenN = 0;
const NOW = Date.parse("2026-10-26T19:20:00+08:00");
const bus = (over) => ({ PlateNumb: "052-U9", RouteName: { Zh_tw: "綠10", En: "G10" }, SubRouteName: { Zh_tw: "綠10 山上→新化" }, Direction: 1,
  BusPosition: { PositionLon: 120.30947, PositionLat: 23.03579 }, Speed: 21, Azimuth: 345, DutyStatus: 0, BusStatus: 0,
  GPSTime: "2026-10-26T19:19:10+08:00", UpdateTime: "2026-10-26T19:19:30+08:00", ...over });
const A1 = [
  bus({}),
  bus({ PlateNumb: "KKA-001", RouteName: { Zh_tw: "藍幹線" }, Direction: 0 }),
  bus({ PlateNumb: "CITY-19", RouteName: { Zh_tw: "19" } }),                       // 市區公車：不收
  bus({ PlateNumb: "OLD-1", GPSTime: "2026-10-26T18:50:00+08:00" }),            // 太舊：不收
  bus({ PlateNumb: "OFF-1", BusStatus: 99 }),                                   // 非營運：不收
  bus({ PlateNumb: "END-1", DutyStatus: 2 }),                                   // 結束營運：不收
  bus({ PlateNumb: "NOPOS", BusPosition: { PositionLon: 0, PositionLat: 0 } }), // 沒座標：不收
  bus({ PlateNumb: "Y-101", RouteName: { Zh_tw: "黃10-1" } }),
];
globalThis.fetch = async (url, opt = {}) => {
  url = String(url); calls.push(url);
  if (url.includes("openid-connect/token")) {
    tokenN++;
    assert.match(String(opt.body), /grant_type=client_credentials/);
    return new Response(JSON.stringify({ access_token: `tok${tokenN}`, expires_in: 86400 }));
  }
  if (url.includes("RealTimeByFrequency/City/Tainan")) {
    assert.match(url, /\$top=2000/);
    const auth = opt.headers?.authorization;
    if (a1Status === 401 && auth === "Bearer tok1") return new Response("expired", { status: 401 });
    if (a1Status !== 200 && a1Status !== 401) return new Response("limit", { status: a1Status });
    return new Response(JSON.stringify(A1));
  }
  throw new Error("unexpected fetch " + url);
};
const { slimBus, fromTdx, default: worker } = await import("../worker.js");
const ctx = { waitUntil: (p) => p };
const req = (path) => new Request("https://hexcity.ericlin.io" + path);

// 1. 篩選：只留六色、營運中、5 分鐘內、有座標
const slim = A1.map((b) => slimBus(b, NOW)).filter(Boolean);
assert.deepEqual(slim.map((b) => b.plate), ["052-U9", "KKA-001", "Y-101"]);
assert.deepEqual(Object.keys(slim[0]).sort(), ["az", "dir", "gps", "lat", "lon", "plate", "route", "speed", "sub"]);
assert.equal(slim[0].route, "綠10");

// 2. 沒有金鑰：ok:false、code no-key，而且不會打 TDX
store.clear(); calls.length = 0;
let r = await (await worker.fetch(req("/api/bus"), {}, ctx)).json();
assert.equal(r.ok, false); assert.equal(r.code, "no-key"); assert.equal(calls.length, 0);

// 3. 有金鑰：取 token、打 A1；第二次在快取期間內不再打 TDX
store.clear(); calls.length = 0;
const env = { TDX_CLIENT_ID: "id", TDX_CLIENT_SECRET: "secret", BUS_TTL: "60" };
const d = await fromTdx(env, caches.default, NOW);
assert.equal(d.ok, true); assert.equal(d.source, "tdx"); assert.equal(d.total, A1.length);
assert.equal(d.buses.length, 3); assert.equal(d.asOf, "2026-10-26T19:19:30+08:00");
store.clear(); calls.length = 0;
r = await (await worker.fetch(req("/api/bus"), env, ctx)).json();
assert.equal(r.ok, true);
const n = calls.length;
r = await (await worker.fetch(req("/api/bus?x=1"), env, ctx)).json();
assert.equal(calls.length, n, "快取期間不應再打 TDX");

// 4. token 重複使用：清掉公車快取但留 token，再打一次只會打 A1
for (const k of [...store.keys()]) if (k.includes("/api/bus")) store.delete(k);
calls.length = 0;
await worker.fetch(req("/api/bus"), env, ctx);
assert.equal(calls.filter((u) => u.includes("token")).length, 0, "token 要重複使用");

// 5. token 過期（401）：重取 token 再打一次
store.clear(); calls.length = 0; tokenN = 0; a1Status = 401;
r = await (await worker.fetch(req("/api/bus"), env, ctx)).json();
assert.equal(r.ok, true); assert.equal(tokenN, 2);

// 6. 額度用完（429）：ok:false、code quota
store.clear(); a1Status = 429;
r = await (await worker.fetch(req("/api/bus"), env, ctx)).json();
assert.equal(r.ok, false); assert.equal(r.code, "quota");

// 7. /api/reservoir 與靜態資產路由不受影響
const assets = { fetch: async () => new Response("asset") };
assert.equal(await (await worker.fetch(req("/index.html"), { ASSETS: assets }, ctx)).text(), "asset");
console.log("test_worker_bus: 7 項全部通過");
