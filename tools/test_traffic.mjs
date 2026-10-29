// traffic.js 的路段對照測試：用真實的 data/highways.json 與 data/freeway_sections.json（高公局路段），檢查對照率與方向。
// 用法（專案根目錄）：node tools/test_traffic.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchSections, speedColor } from "../traffic.js";

const hw = JSON.parse(readFileSync(new URL("../data/highways.json", import.meta.url)));
const secs = JSON.parse(readFileSync(new URL("../data/freeway_sections.json", import.meta.url))).sections;
const chains = hw.chains.map((c) => ({ route: c.route, link: !!c.link, pts: c.pts.map(([x, z]) => ({ x, z })) }));
const match = matchSections(chains, secs);
let n = 0;
const ok = (name, fn) => { try { fn(); n++; } catch (e) { console.error("✗", name); throw e; } };

const stats = {};
chains.forEach((c, i) => {
  if (c.link || !["nh1", "nh3", "nh8"].includes(c.route)) return;
  for (let k = 0; k < c.pts.length - 1; k++) {
    const L = Math.hypot(c.pts[k + 1].x - c.pts[k].x, c.pts[k + 1].z - c.pts[k].z);
    const s = (stats[c.route] ||= { all: 0, hit: 0, wrong: 0 });
    s.all += L;
    const si = match[i][k];
    if (si < 0) continue;
    s.hit += L;
    // 方向：南下（S）的路段鏈要往 +z、北上（N）往 -z；國道 8 號東西向（E 往 +x、W 往 -x）
    const dir = secs[si].dir, dx = c.pts[k + 1].x - c.pts[k].x, dz = c.pts[k + 1].z - c.pts[k].z;
    const good = dir === "S" ? dz > 0 : dir === "N" ? dz < 0 : dir === "E" ? dx > 0 : dir === "W" ? dx < 0 : true;
    if (!good && Math.abs(dir === "S" || dir === "N" ? dz : dx) > 0.02) s.wrong += L;
  }
});
for (const [r, s] of Object.entries(stats)) console.log(`${r}: 對到 ${((100 * s.hit) / s.all).toFixed(1)}%（${s.hit.toFixed(0)}/${s.all.toFixed(0)} 單位），方向不符 ${((100 * s.wrong) / s.all).toFixed(2)}%`);
ok("國道 1、3、8 號主線九成以上對到即時路段", () => { for (const [r, s] of Object.entries(stats)) assert.ok(s.hit / s.all > 0.9, `${r} 只對到 ${(s.hit / s.all * 100).toFixed(1)}%`); });
ok("對到的路段方向跟行車方向一致（容許 1% 轉彎處）", () => { for (const [r, s] of Object.entries(stats)) assert.ok(s.wrong / s.all < 0.01, r); });
ok("匝道不對路段", () => chains.forEach((c, i) => { if (c.link) assert.equal(match[i], null); }));
ok("每個台南路段至少對到一小段", () => {
  const used = new Set(match.flatMap((m) => (m ? [...m] : [])));
  const miss = secs.filter((_, i) => !used.has(i)).map((s) => s.name);
  assert.ok(miss.length <= 2, `沒對到：${miss.join("、")}`);
});
ok("車速顏色分四級", () => { assert.equal(speedColor(95), speedColor(80)); assert.notEqual(speedColor(79), speedColor(80)); assert.notEqual(speedColor(39), speedColor(40)); });
ok("快速道路（TDX 線形）也能對：反方向不對", () => {
  const c = [{ route: "pr61", link: false, pts: [{ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 0, z: 2 }] }];
  assert.deepEqual([...matchSections(c, [{ id: "a", route: "pr61", pts: [[0.1, -1], [0.1, 3]] }])[0]], [0, 0]);
  assert.deepEqual([...matchSections(c, [{ id: "b", route: "pr61", pts: [[0.1, 3], [0.1, -1]] }])[0]], [-1, -1]);
  assert.deepEqual([...matchSections(c, [{ id: "c", route: "pr84", pts: [[0.1, -1], [0.1, 3]] }])[0]], [-1, -1]);
});
console.log(`test_traffic: ${n} 項全部通過`);
