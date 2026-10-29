// rail.js 測試：班表 → 沿路線距離＋時刻（含誤點、高鐵進出台南的推算）、車站的下幾班。不連網。
// 用法（專案根目錄）：node tools/test_rail.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSchedules, createRail, TRA_CODE } from "../rail.js";

const rail = JSON.parse(readFileSync(new URL("../data/rail.json", import.meta.url)));
let n = 0;
const ok = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error("✗", name); throw e; } };
const traS = new Map([["4120", 10], ["4220", 50], ["4270", 70]]);
const D = {
  tra: { ok: true, trains: [{ no: "105", type: "自強", dest: "潮州", stops: [["4120", 494, 495], ["4220", 520, 523], ["4400", 550, 550]] }, { no: "9", type: "莒光", dest: "x", stops: [["4220", 600, 601]] }] },
  thsr: { ok: true, trains: [{ no: "0803", dir: 0, dest: "左營", arr: 553, dep: 555 }, { no: "0662", dir: 1, dest: "南港", arr: 600, dep: 602 }] },
  delays: { ok: true, delays: { 105: 3 } },
};

await ok("每個台鐵站都有官方站碼", () => { for (const s of rail.stations) assert.ok(TRA_CODE[s.id], s.id); });
await ok("台鐵：只留地圖上的站、整班加誤點；只剩一站的車次不畫", () => {
  const { tra } = buildSchedules(D, { traS, hsrS: 100, unitsPerKm: 4 });
  assert.equal(tra.length, 1);
  assert.deepEqual(tra[0].stops, [{ code: "4120", s: 10, arr: 497, dep: 498 }, { code: "4220", s: 50, arr: 523, dep: 526 }]);
  assert.equal(tra[0].label, "自強105");
});
await ok("高鐵：南下沿路線往前推、北上往回推，每分鐘 4 公里", () => {
  const { hsr } = buildSchedules(D, { traS, hsrS: 100, unitsPerKm: 4 });
  assert.deepEqual(hsr[0].stops.map((s) => s.s), [100 - 240, 100, 100 + 240]); // 60 公里 × 4 單位
  assert.deepEqual(hsr[0].stops.map((s) => s.arr), [553 - 15, 553, 555 + 15]);
  assert.deepEqual(hsr[1].stops.map((s) => s.s), [340, 100, -140]);
});
await ok("TDX 失敗（ok:false）：兩組班表都是空的，照模擬跑", () => {
  const r = buildSchedules({ tra: { ok: false }, thsr: { ok: false }, delays: { ok: false } }, { traS, hsrS: 100, unitsPerKm: 4 });
  assert.deepEqual(r, { tra: [], hsr: [] });
});
await ok("createRail：setLive 拿到班表才切到真實班表，關掉就回模擬；車站列下幾班", async () => {
  globalThis.document = { visibilityState: "visible" };
  const calls = [];
  const fake = (stops) => ({ stopDistances: () => stops, setSchedule: (l) => calls.push(l ? l.length : null) });
  const ids = ["xinying", "tainan", "zhongzhou"];
  const r = createRail({ trains: fake([10, 50, 70]), hsr: fake([0, 100, 200]), stationIds: ids, unitsPerKm: 4, fetchJson: async () => D });
  r.setLive(true);
  await new Promise((res) => setTimeout(res, 10));
  assert.deepEqual(calls, [1, 2]);
  assert.equal(r.status().mode, "live");
  assert.deepEqual(r.upcoming("tainan", 520).map((x) => [x.label, x.time, x.late]), [["自強105", 526, 3]]);
  r.setLive(false);
  assert.deepEqual(calls.slice(-2), [null, null]);
  assert.equal(r.status().mode, "sim");
});
console.log(`test_rail: ${n} 項全部通過`);
process.exit(0);
