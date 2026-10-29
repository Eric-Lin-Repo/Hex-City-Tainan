// train.js 照真實班表跑的測試：用 vendor 的 three.js 與真實路線（data/rail.json），餵假的班表看列車在不在對的位置。不連網。
// 用法（專案根目錄）：node tools/test_train_schedule.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "../vendor/three/build/three.module.js";
import { createTrains } from "../train.js";

const rail = JSON.parse(readFileSync(new URL("../data/rail.json", import.meta.url)));
const sv = rail.services[0];
const service = { ...sv, points: sv.points.map(([x, z]) => new THREE.Vector3(x, 0, z)) };
const scene = new THREE.Scene();
const trains = createTrains(THREE, scene, [service], () => 0, null, { speed: 4.4, pool: 3 });
const S = trains.stopDistances(0); // 每站沿線距離，跟 sv.stations 同順序
let n = 0;
const ok = (name, fn) => { try { fn(); n++; } catch (e) { console.error("✗", name); throw e; } };
const at = (code) => S[sv.stations.indexOf(code)];

ok("停靠站距離遞增、跟車站數一樣多", () => { assert.equal(S.length, sv.stations.length); for (let i = 1; i < S.length; i++) assert.ok(S[i] > S[i - 1]); });
const sched = [
  { no: "105", label: "自強105", stops: [{ s: at("xinying"), arr: 600, dep: 601 }, { s: at("tainan"), arr: 630, dep: 633 }] },
  { no: "2131", label: "區間2131", stops: [{ s: at("tainan"), arr: 600, dep: 602 }, { s: at("zhongzhou"), arr: 615, dep: 616 }] },
  { no: "900", label: "晚班", stops: [{ s: at("tainan"), arr: 1430, dep: 1431 }, { s: at("shalun"), arr: 1450, dep: 1450 }] },
];
trains.setSchedule(sched);
ok("切到班表：模擬列車藏起來", () => { assert.equal(trains.scheduled, true); });
ok("在站內停著（arr～dep）", () => {
  trains.update(0.016, 1, 1, 600.5);
  const st = trains.state();
  assert.equal(st.length, 2);
  const a = st.find((x) => x.no === "105"), b = st.find((x) => x.no === "2131");
  assert.ok(Math.abs(a.s - at("xinying")) < 0.01); assert.equal(a.wait, 1);
  assert.ok(Math.abs(b.s - at("tainan")) < 0.01);
});
ok("兩站之間依時間內插", () => {
  trains.update(0.016, 1, 1, 615.5); // 105：601 離新營、630 到台南，走了一半
  const a = trains.state().find((x) => x.no === "105");
  const mid = at("xinying") + (at("tainan") - at("xinying")) * (14.5 / 29);
  assert.ok(Math.abs(a.s - mid) < 0.01, `${a.s} vs ${mid}`);
  assert.equal(a.dir, 1);
});
ok("最後一站到站後消失、還沒發車的不畫", () => {
  trains.update(0.016, 1, 1, 640);
  assert.equal(trains.state().length, 0);
});
ok("跨午夜：凌晨 0:05 用前一天 24:05 的時刻找", () => {
  trains.update(0.016, 1, 1, 5);
  const c = trains.state().find((x) => x.no === "900");
  assert.ok(c && c.s > at("tainan") && c.s < at("shalun"));
});
ok("同時在線上的超過 pool 就只畫 pool 列", () => {
  trains.setSchedule([1, 2, 3, 4, 5].map((k) => ({ no: `x${k}`, stops: [{ s: at("houbi"), arr: 0, dep: 1 }, { s: at("shalun"), arr: 100, dep: 100 }] })));
  trains.update(0.016, 1, 1, 50);
  assert.equal(trains.state().length, 3);
});
ok("setSchedule(null) 回到模擬", () => { trains.setSchedule(null); assert.equal(trains.scheduled, false); assert.equal(trains.count, 2); });
console.log(`test_train_schedule: ${n} 項全部通過`);
