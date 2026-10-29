// worker.js 的 /api/freeway 測試：假的 TDX（國道與省道路況）、ASSETS 與 caches，不會連網、不需要金鑰。
// 用法（專案根目錄）：node tools/test_worker_freeway.mjs
import assert from "node:assert/strict";

const store = new Map();
globalThis.caches = { default: {
  match: async (req) => { const v = store.get(typeof req === "string" ? req : req.url); return v ? new Response(v) : undefined; },
  put: async (req, res) => { store.set(typeof req === "string" ? req : req.url, await res.text()); },
} };
let calls = [], fwStatus = 200, sectionsN = 0, shapeFail = 0;
globalThis.fetch = async (url, opt = {}) => {
  url = String(url); calls.push(url);
  if (url.includes("openid-connect/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 86400 }));
  if (url.includes("/Section/Highway")) { sectionsN++; return new Response(JSON.stringify({ Sections: [
    { SectionID: "H61A", SectionName: "台61線(七股到將軍)", RoadName: "台61線", RoadDirection: "N", SpeedLimit: 90 },
    { SectionID: "H61B", SectionName: "台61線(新竹)", RoadName: "台61線", RoadDirection: "N" },          // 不在台南
    { SectionID: "H161", SectionName: "台161線", RoadName: "台161線", RoadDirection: "S" },             // 不是台 61
    { SectionID: "H86A", SectionName: "台86線(歸仁到仁德)", RoadName: "臺86線", RoadDirection: "W" },
  ] })); }
  if (url.includes("/SectionShape/Highway")) {
    if (shapeFail > 0) { shapeFail--; return new Response("limit", { status: 429 }); }
    const f = decodeURIComponent(url);
    assert.ok(!f.includes("H161"), "台161 不該抓線形");
    return new Response(JSON.stringify({ SectionShapes: [
      { SectionID: "H61A", Geometry: "LINESTRING(120.10 23.15,120.11 23.17)" },
      { SectionID: "H61B", Geometry: "LINESTRING(120.95 24.80,120.96 24.82)" },
      { SectionID: "H86A", Geometry: "LINESTRING(120.28 22.95,120.24 22.95)" },
    ] }));
  }
  if (url.includes("/Live/Freeway")) {
    if (fwStatus !== 200) return new Response("down", { status: fwStatus });
    const f = decodeURIComponent(url);
    assert.match(f, /SectionID eq '0117' or SectionID eq '0125' or SectionID eq '0131'/); // 只抓台南的路段
    return new Response(JSON.stringify({ UpdateTime: "2026-10-29T16:40:00+08:00", LiveTraffics: [
      { SectionID: "0117", TravelSpeed: 92, CongestionLevel: 1, DataCollectTime: "2026-10-29T16:40:00+08:00" },
      { SectionID: "0125", TravelSpeed: 35, CongestionLevel: 4, DataCollectTime: "2026-10-29T16:39:00+08:00" },
      { SectionID: "0131", TravelSpeed: -99, CongestionLevel: -99 }, // 資料異常：不收
    ] }));
  }
  if (url.includes("/Live/Highway")) {
    assert.match(decodeURIComponent(url), /SectionID eq 'H61A' or SectionID eq 'H86A'/);
    return new Response(JSON.stringify({ UpdateTime: "2026-10-29T16:30:00+08:00", LiveTraffics: [
      { SectionID: "H61A", TravelSpeed: 78, CongestionLevel: 2, DataCollectTime: "2026-10-29T16:30:00+08:00" },
      { SectionID: "H86A", TravelSpeed: -99, CongestionLevel: -99 },
    ] }));
  }
  throw new Error("unexpected fetch " + url);
};
const ASSETS = { fetch: async () => new Response(JSON.stringify({ sections: [{ id: "0117" }, { id: "0125" }, { id: "0131" }] })) };
const kvData = new Map(), kv = { get: async (k) => kvData.get(k) ?? null, put: async (k, v) => { kvData.set(k, v); } };
const worker = (await import("../worker.js")).default;
const env = { ASSETS, TDX_CLIENT_ID: "id", TDX_CLIENT_SECRET: "secret", HEXCITY_QUOTA: kv, TDX_PER_MIN: "100" }; // 每分鐘上限另外在 test_worker_quota 測
const get = async (path, e = env) => (await worker.fetch(new Request("https://hexcity.ericlin.io" + path), e, { waitUntil() {} })).json();
let n = 0;
const ok = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error("✗", name); throw e; } };

await ok("/api/freeway：國道＋快速道路", async () => {
  const d = await get("/api/freeway");
  assert.equal(d.ok, true);
  assert.deepEqual(d.freeway.speeds, { "0117": [92, 1], "0125": [35, 4] });
  assert.equal(d.freeway.source, "tdx");
  assert.equal(d.freeway.asOf, "2026-10-29T16:40:00+08:00");
  assert.equal(d.express.ok, true);
  assert.deepEqual(d.express.speeds, { H61A: [78, 2] });
});
await ok("快速道路路段：只留台南範圍內的台 61、84、86，轉成 route id", async () => {
  const d = await get("/api/expressway-sections");
  assert.deepEqual(d.sections.map((x) => [x.id, x.route]), [["H61A", "pr61"], ["H86A", "pr86"]]);
  assert.deepEqual(d.sections[0].pts, [[120.1, 23.15], [120.11, 23.17]]);
});
await ok("快取 30 分鐘：第二次不再打 TDX", async () => {
  const before = calls.length;
  await get("/api/freeway"); await get("/api/expressway-sections");
  assert.equal(calls.length, before);
  assert.equal(sectionsN, 1);
});
await ok("額度：路段清單＋線形算 hwSection、快速道路車速 hwLive、國道車速 fwLive", async () => {
  const day = [...kvData.keys()].find((k) => /^tdx:\d{4}-/.test(k)).split(":")[1];
  assert.equal(kvData.get(`tdx:${day}:hwSection`), "2"); // Section 1 次＋SectionShape 1 批
  assert.equal(kvData.get(`tdx:${day}:hwLive`), "1");
  assert.equal(kvData.get(`tdx:${day}:fwLive`), "1");
});
await ok("快速道路線形被頻率限制打斷：下次接著抓、不重抓路段清單", async () => {
  const day = [...kvData.keys()].find((k) => /^day:/.test(k)).split(":")[1];
  kvData.delete(`day:${day}:hwSections`); store.clear(); sectionsN = 0; shapeFail = 1;
  const a = await get("/api/expressway-sections");
  assert.equal(a.ok, false); assert.equal(a.code, "busy");
  assert.equal(sectionsN, 1);
  store.clear();
  const b = await get("/api/expressway-sections");
  assert.equal(b.ok, true); assert.equal(b.sections.length, 2);
  assert.equal(sectionsN, 1); // 路段清單只抓一次（存在 KV）
});
await ok("TDX 國道路況掛了：freeway ok:false，前端退回模擬", async () => {
  store.clear(); fwStatus = 503;
  const d = await get("/api/freeway");
  assert.equal(d.ok, false);
  assert.match(d.freeway.error, /503/);
  fwStatus = 200;
});
await ok("沒 TDX 金鑰：國道、快速道路都回 no-key", async () => {
  store.clear();
  const d = await get("/api/freeway", { ASSETS });
  assert.equal(d.freeway.code, "no-key");
  assert.equal(d.express.code, "no-key");
});
console.log(`test_worker_freeway: ${n} 項全部通過`);
