// worker.js 的 /api/rail 測試：假的 TDX（台鐵起迄站時刻表、高鐵整天時刻表、台鐵即時看板）與 caches、KV，不會連網、不需要金鑰。
// 用法（專案根目錄）：node tools/test_worker_rail.mjs
import assert from "node:assert/strict";

const store = new Map();
globalThis.caches = { default: {
  match: async (req) => { const v = store.get(typeof req === "string" ? req : req.url); return v ? new Response(v) : undefined; },
  put: async (req, res) => { store.set(typeof req === "string" ? req : req.url, await res.text()); },
} };
const stop = (seq, id, arr, dep = arr) => ({ StopSequence: seq, StationID: id, StationName: { Zh_tw: id }, ArrivalTime: arr, DepartureTime: dep });
const train = (no, type, dest, stops) => ({ TrainInfo: { TrainNo: no, TrainTypeName: { Zh_tw: type }, EndingStationName: { Zh_tw: dest } }, StopTimes: stops });
const OD = {
  "4080/to/4220": [ // 嘉義→臺南：自強 105 停新營、臺南；區間 2131 每站停
    train("105", "自強", "潮州", [stop(10, "4080", "08:00"), stop(12, "4120", "08:14", "08:15"), stop(17, "4220", "08:40", "08:43")]),
    train("2131", "區間", "屏東", [stop(30, "4080", "07:30"), stop(31, "4110", "07:41", "07:42"), stop(32, "4120", "07:49", "07:50"), stop(42, "4220", "08:35", "08:38")]),
  ],
  "4220/to/4400": [ // 臺南→高雄：同一班 105 接下去，臺南重複出現要只留一次
    train("105", "自強", "潮州", [stop(17, "4220", "08:40", "08:43"), stop(19, "4400", "09:10")]),
    train("2131", "區間", "屏東", [stop(42, "4220", "08:35", "08:38"), stop(43, "4250", "08:44", "08:45"), stop(45, "4270", "08:52", "08:53"), stop(46, "4290", "08:57")]),
  ],
  "4272/to/4220": [train("3708", "區間", "臺南", [stop(1, "4272", "23:50"), stop(2, "4271", "23:55", "23:56"), stop(3, "4270", "23:59", "00:00"), stop(5, "4220", "00:09")])], // 跨午夜
};
let calls = [];
globalThis.fetch = async (url) => {
  url = String(url); calls.push(url);
  if (url.includes("openid-connect/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 86400 }));
  const od = url.match(/OD\/Inclusive\/(\d+\/to\/\d+)\//);
  if (od) return new Response(JSON.stringify({ TrainTimetables: OD[od[1]] ?? [] }));
  if (url.includes("/THSR/DailyTimetable/TrainDate/")) return new Response(JSON.stringify([
    { DailyTrainInfo: { TrainNo: "0803", Direction: 0, EndingStationName: { Zh_tw: "左營" } }, StopTimes: [{ StationName: { Zh_tw: "嘉義", En: "Chiayi" }, ArrivalTime: "09:00" }, { StationName: { Zh_tw: "台南", En: "Tainan" }, ArrivalTime: "09:13", DepartureTime: "09:15" }] },
    { DailyTrainInfo: { TrainNo: "0116", Direction: 1, EndingStationName: { Zh_tw: "南港" } }, StopTimes: [{ StationName: { Zh_tw: "左營", En: "Zuoying" }, DepartureTime: "10:00" }, { StationName: { Zh_tw: "台中", En: "Taichung" }, ArrivalTime: "10:50" }] }, // 不停台南
  ]));
  if (url.includes("/TRA/TrainLiveBoard")) return new Response(JSON.stringify({ UpdateTime: "2026-10-29T08:41:00+08:00", TrainLiveBoards: [{ TrainNo: "105", StationID: "4120", DelayTime: 3 }, { TrainNo: "2131", StationID: "4220", DelayTime: 0 }] }));
  throw new Error("unexpected fetch " + url);
};
const kvData = new Map(), kv = { get: async (k) => kvData.get(k) ?? null, put: async (k, v) => { kvData.set(k, v); } };
const worker = (await import("../worker.js")).default;
const { traTrains } = await import("../worker.js");
const env = { TDX_CLIENT_ID: "id", TDX_CLIENT_SECRET: "secret", HEXCITY_QUOTA: kv, TDX_PER_MIN: "100" };
const get = async (e = env) => (await worker.fetch(new Request("https://hexcity.ericlin.io/api/rail"), e, { waitUntil() {} })).json();
let n = 0;
const ok = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error("✗", name); throw e; } };

await ok("台鐵時刻表分批抓：一次最多補 2 段，第 3 次請求才補齊 6 段", async () => {
  const a = await get();
  assert.equal(a.tra.code, "loading"); assert.equal(a.tra.have, 2);
  const b = await get();
  assert.equal(b.tra.have, 4);
  const c = await get();
  assert.equal(c.tra.ok, true);
  assert.equal(calls.filter((u) => u.includes("/OD/Inclusive/")).length, 6); // 抓過的段走快取，不重抓
});
await ok("台鐵：兩段合併成同一車次、只留台南的站、依停靠順序", async () => {
  const d = await get();
  const t105 = d.tra.trains.find((t) => t.no === "105"), t2131 = d.tra.trains.find((t) => t.no === "2131");
  assert.deepEqual(t105.stops, [["4120", 494, 495], ["4220", 520, 523]]); // 嘉義、高雄不在台南
  assert.deepEqual(t2131.stops.map((s) => s[0]), ["4110", "4120", "4220", "4250", "4270"]); // 大湖 4290 在高雄
  assert.equal(t105.type, "自強"); assert.equal(t105.dest, "潮州");
});
await ok("台鐵：跨午夜的車次時間接續（加 1440）", async () => {
  const t = traTrains([{ TrainTimetables: OD["4272/to/4220"] }])[0];
  assert.deepEqual(t.stops, [["4272", 1430, 1430], ["4271", 1435, 1436], ["4270", 1439, 1440], ["4220", 1449, 1449]]);
});
await ok("高鐵：只留停台南站的車次", async () => {
  const d = await get();
  assert.deepEqual(d.thsr.trains, [{ no: "0803", dir: 0, dest: "左營", arr: 553, dep: 555 }]);
});
await ok("誤點：車次 → 分鐘", async () => {
  const d = await get();
  assert.deepEqual(d.delays.delays, { 105: 3, 2131: 0 });
});
await ok("額度：台鐵時刻表 6 次、高鐵 1 次、誤點 1 次（之後都走快取）", async () => {
  const day = [...kvData.keys()].find((k) => /^tdx:\d{4}-/.test(k)).split(":")[1];
  assert.equal(kvData.get(`tdx:${day}:traDaily`), "6");
  assert.equal(kvData.get(`tdx:${day}:thsrDaily`), "1");
  assert.equal(kvData.get(`tdx:${day}:traLive`), "1");
});
await ok("另一個機房（邊緣快取是空的）：時刻表從 KV 拿，不再向 TDX 抓", async () => {
  store.clear();
  const before = calls.filter((u) => u.includes("/OD/Inclusive/") || u.includes("/THSR/")).length;
  const d = await get();
  assert.equal(d.tra.ok, true); assert.equal(d.thsr.ok, true);
  assert.equal(calls.filter((u) => u.includes("/OD/Inclusive/") || u.includes("/THSR/")).length, before);
});
await ok("沒金鑰：tra、thsr 都 ok:false（前端照模擬跑）", async () => {
  store.clear(); kvData.clear();
  const d = await get({});
  assert.equal(d.ok, false);
  assert.equal(d.tra.code, "no-key");
});
console.log(`test_worker_rail: ${n} 項全部通過`);
