// 更新水庫備援資料 data/reservoir_fallback.json（Worker 抓不到水利署開放資料、或本機 serve.py 沒有 /api/reservoir 時使用）。
// 直接用 worker.js 的 fromOpenData，算法與線上相同。用法：node tools/fetch_reservoir.mjs
import fs from "node:fs";
import { fromOpenData } from "../worker.js";

const d = await fromOpenData();
for (const [name, v] of Object.entries(d.reservoirs)) {
  if (v) v.source = "https://data.gov.tw/dataset/45501";
  console.log(v ? `${name}: ${v.percent}%（${v.storage}/${v.capacity} 萬立方公尺，水位 ${v.level} m）${v.asOf}` : `${name}: 無資料`);
}
const out = { asOf: d.asOf, note: "水利署開放資料（水庫水情資料＋水庫每日營運狀況）的快照，由 tools/fetch_reservoir.mjs 產生；尖山埤（台糖經營）不在水利署資料裡，故為 null。", reservoirs: d.reservoirs };
fs.writeFileSync(new URL("../data/reservoir_fallback.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log("寫出 data/reservoir_fallback.json，asOf", d.asOf);
