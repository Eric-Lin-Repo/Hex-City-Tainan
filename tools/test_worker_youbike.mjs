// worker.js 的 /api/youbike 測試：假的 TDX、YouBike 官網 feed、caches 與 KV，不會連網、不需要金鑰。
// 用法（專案根目錄）：node tools/test_worker_youbike.mjs
import assert from "node:assert/strict";

const store = new Map();
globalThis.caches = { default: {
  match: async (req) => { const v = store.get(typeof req === "string" ? req : req.url); return v ? new Response(v) : undefined; },
  put: async (req, res) => { store.set(typeof req === "string" ? req : req.url, await res.text()); },
} };
const STATIONS = [
  { StationUID: "TNN501201001", StationName: { Zh_tw: "YouBike2.0_臺南火車站(前站)" }, StationPosition: { PositionLat: 22.99716, PositionLon: 120.21234 }, BikesCapacity: 40 },
  { StationUID: "TNN501201002", StationName: { Zh_tw: "YouBike2.0_成大光復校區" }, StationPosition: { PositionLat: 22.99812, PositionLon: 120.21961 }, BikesCapacity: 30 },
  { StationUID: "TNNBAD", StationName: { Zh_tw: "沒座標" }, StationPosition: {} },
];
const AVAIL = [
  { StationUID: "TNN501201001", ServiceStatus: 1, AvailableRentBikes: 12, AvailableReturnBikes: 28, AvailableRentBikesDetail: { GeneralBikes: 9, ElectricBikes: 3 }, UpdateTime: "2026-10-29T17:01:20+08:00" },
  { StationUID: "TNN501201002", ServiceStatus: 2, AvailableRentBikes: 0, AvailableReturnBikes: 30, UpdateTime: "2026-10-29T17:00:50+08:00" },
];
const FEED = [
  { station_no: "501201001", name_tw: "臺南火車站(前站)", area_code: "13", lat: "22.99716", lng: "120.21234", parking_spaces: "40", available_spaces: 5, empty_spaces: 35, available_spaces_detail: { yb2: 4, eyb: 1 }, status: 1, updated_at: "2026-10-29 17:02:00" },
  { station_no: "500101001", name_tw: "捷運科技大樓站", area_code: "00", lat: "25.02605", lng: "121.5436", parking_spaces: "28", available_spaces: 3, empty_spaces: 25, status: 1 }, // 台北：不收
];
let tdxStatus = 200, calls = [];
globalThis.fetch = async (url) => {
  url = String(url); calls.push(url);
  if (url.includes("openid-connect/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 86400 }));
  if (url.includes("/Bike/Station/City/Tainan")) { assert.match(url, /\$top=2000/); return new Response(JSON.stringify(STATIONS)); }
  if (url.includes("/Bike/Availability/City/Tainan")) return tdxStatus === 200 ? new Response(JSON.stringify(AVAIL)) : new Response("limit", { status: tdxStatus });
  if (url.includes("apis.youbike.com.tw")) return new Response(JSON.stringify(FEED));
  throw new Error("unexpected fetch " + url);
};
const kvData = new Map(), kv = { get: async (k) => kvData.get(k) ?? null, put: async (k, v) => { kvData.set(k, v); } };
const worker = (await import("../worker.js")).default;
const env = { TDX_CLIENT_ID: "id", TDX_CLIENT_SECRET: "secret", HEXCITY_QUOTA: kv, TDX_PER_MIN: "100" };
const get = async (e = env) => (await worker.fetch(new Request("https://hexcity.ericlin.io/api/youbike"), e, { waitUntil() {} })).json();
let n = 0;
const ok = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error("✗", name); throw e; } };

await ok("TDX：站點＋可借可還合併，站名去掉 YouBike2.0_ 前綴", async () => {
  const d = await get();
  assert.equal(d.source, "tdx");
  assert.deepEqual(d.stations, [
    ["TNN501201001", "臺南火車站(前站)", 22.99716, 120.21234, 40, 12, 28, 3, 1],
    ["TNN501201002", "成大光復校區", 22.99812, 120.21961, 30, 0, 30, null, 2],
  ]);
  assert.equal(d.asOf, "2026-10-29T17:01:20+08:00");
});
await ok("快取 3 分鐘：第二次不打 TDX", async () => {
  const before = calls.length; await get(); assert.equal(calls.length, before);
});
await ok("站點清單一天一次：可借可還過期重抓時不再抓站點", async () => {
  store.delete("https://hexcity.ericlin.io/api/youbike?cache=v3");
  const before = calls.filter((u) => u.includes("/Bike/Station/")).length;
  await get();
  assert.equal(calls.filter((u) => u.includes("/Bike/Station/")).length, before);
});
await ok("TDX 額度用完：改用 YouBike 官網 feed，只留台南", async () => {
  store.delete("https://hexcity.ericlin.io/api/youbike?cache=v3"); tdxStatus = 429;
  const d = await get();
  assert.equal(d.source, "youbike");
  assert.match(d.tdxError, /429/);
  assert.deepEqual(d.stations, [["TNN501201001", "臺南火車站(前站)", 22.99716, 120.21234, 40, 5, 35, 1, 1]]);
  assert.equal(d.asOf, "2026-10-29T17:02:00+08:00");
  tdxStatus = 200;
});
await ok("沒 TDX 金鑰：直接用官網 feed", async () => {
  store.clear();
  const d = await get({});
  assert.equal(d.source, "youbike");
  assert.match(d.tdxError, /金鑰/);
});
await ok("額度計數：站點 ybStation、可借可還 ybAvail", async () => {
  const day = [...kvData.keys()].find((k) => /^tdx:\d{4}-/.test(k)).split(":")[1];
  assert.equal(kvData.get(`tdx:${day}:ybStation`), "1");
  assert.equal(kvData.get(`tdx:${day}:ybAvail`), "2"); // 第 1、3 次；第 4 次被 429 擋，退回額度
});
console.log(`test_worker_youbike: ${n} 項全部通過`);
