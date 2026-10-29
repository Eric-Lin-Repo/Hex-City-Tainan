// worker.js 的 TDX 每日額度測試：用假的 KV、fetch、caches，不會連網、不需要金鑰。
// 用法（專案根目錄）：node tools/test_worker_quota.mjs
import assert from "node:assert/strict";

const store = new Map();
globalThis.caches = { default: {
  match: async (req) => { const v = store.get(typeof req === "string" ? req : req.url); return v ? new Response(v) : undefined; },
  put: async (req, res) => { store.set(typeof req === "string" ? req : req.url, await res.text()); },
} };
let tdxCalls = 0, tokenCalls = 0, apiStatus = 200;
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.includes("openid-connect/token")) { tokenCalls++; return new Response(JSON.stringify({ access_token: "tok", expires_in: 86400 })); }
  tdxCalls++;
  return apiStatus === 200 ? new Response(JSON.stringify([])) : new Response("limit", { status: apiStatus });
};
const kvData = new Map();
const kv = { get: async (k) => kvData.get(k) ?? null, put: async (k, v) => { kvData.set(k, v); } };
const { tdxAllow, tdxFetch, tdxMinute, TDX_DAILY } = await import("../worker.js");
const env = { TDX_CLIENT_ID: "id", TDX_CLIENT_SECRET: "secret", HEXCITY_QUOTA: kv };
let n = 0;
const ok = (name, fn) => fn().then(() => { n++; }, (e) => { console.error("✗", name); throw e; });

const NOW = Date.parse("2026-10-29T23:30:00+08:00"); // 台灣 10/29 晚上；UTC 已經是 15:30
await ok("每日上限：第 N+1 次被擋", async () => {
  for (let i = 0; i < TDX_DAILY.traLive; i++) assert.equal(await tdxAllow(env, "traLive", NOW), true);
  assert.equal(await tdxAllow(env, "traLive", NOW), false);
  assert.equal(kvData.get("tdx:2026-10-29:traLive"), String(TDX_DAILY.traLive));
});
await ok("不同用途各自計數", async () => {
  assert.equal(await tdxAllow(env, "bus", NOW), true);
  assert.equal(kvData.get("tdx:2026-10-29:bus"), "1");
});
await ok("日期用台灣時間：過了台灣午夜重新計數", async () => {
  const next = Date.parse("2026-10-30T00:10:00+08:00");
  assert.equal(await tdxAllow(env, "traLive", next), true);
  assert.equal(kvData.get("tdx:2026-10-30:traLive"), "1");
});
await ok("額度用完時 tdxFetch 丟 quota，而且不打 TDX", async () => {
  const before = tdxCalls;
  await assert.rejects(() => tdxFetch(env, caches.default, "https://tdx.transportdata.tw/api/basic/v3/Rail/TRA/TrainLiveBoard", "traLive", NOW), (e) => e.code === "quota");
  assert.equal(tdxCalls, before);
});
await ok("沒綁 KV（本機）不設限", async () => {
  const free = { TDX_CLIENT_ID: "id", TDX_CLIENT_SECRET: "secret" };
  for (let i = 0; i < 100; i++) assert.equal(await tdxAllow(free, "traLive", NOW), true);
});
await ok("沒金鑰丟 no-key，不扣額度", async () => {
  const before = kvData.get("tdx:2026-10-29:ybAvail");
  await assert.rejects(() => tdxFetch({ HEXCITY_QUOTA: kv }, caches.default, "https://x/api/basic/v2/Bike", "ybAvail", NOW), (e) => e.code === "no-key");
  assert.equal(kvData.get("tdx:2026-10-29:ybAvail"), before);
});
await ok("每日上限合計約 137 次（每月約 4,100 次，免費方案約 4,500 次）", async () => {
  const total = Object.values(TDX_DAILY).reduce((a, b) => a + b, 0);
  assert.ok(total * 30 <= 4200, `合計 ${total}/天`);
});
await ok("每分鐘上限：同一分鐘第 5 次丟 busy、不扣當天額度；下一分鐘恢復", async () => {
  const m = Date.parse("2026-10-29T12:00:10+08:00"), e = { ...env, HEXCITY_QUOTA: kv };
  for (let i = 0; i < 4; i++) await tdxMinute(e, m);
  await assert.rejects(() => tdxMinute(e, m), (x) => x.code === "busy");
  const before = kvData.get("tdx:2026-10-29:bus");
  await assert.rejects(() => tdxFetch(e, caches.default, "https://tdx.transportdata.tw/api/basic/v2/Bus/x", "bus", m + 20000), (x) => x.code === "busy");
  assert.equal(kvData.get("tdx:2026-10-29:bus"), before);
  await tdxMinute(e, m + 60000);
});
await ok("TDX 回 429：丟 busy，而且退回當天額度", async () => {
  const m = Date.parse("2026-10-29T13:00:00+08:00");
  apiStatus = 429;
  const before = kvData.get("tdx:2026-10-29:fwLive") ?? null;
  await assert.rejects(() => tdxFetch(env, caches.default, "https://tdx.transportdata.tw/api/basic/v2/Road/x", "fwLive", m), (x) => x.code === "busy");
  assert.equal(kvData.get("tdx:2026-10-29:fwLive") ?? null, before === null ? "0" : before);
  apiStatus = 200;
});
await ok("token 存 KV 全域共用：別的機房（快取是空的）不再重取", async () => {
  const m = Date.parse("2026-10-29T14:00:00+08:00");
  assert.ok(kvData.get("tdx:token"));
  const before = tokenCalls;
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } }; // 新機房：邊緣快取沒有 token
  await tdxFetch(env, caches.default, "https://tdx.transportdata.tw/api/basic/v2/Bike/x", "ybAvail", m);
  assert.equal(tokenCalls, before);
});
console.log(`test_worker_quota: ${n} 項全部通過`);
