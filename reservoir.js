// 水庫即時水位：向 /api/reservoir 取蓄水率，把 6 座水庫的水面依蓄水率縮放，水面上方掛「💧 曾文 91%」小牌（依高低變色），點水面或小牌看卡片。
// 水面蓋在 infrastructure.js 畫的湖面上（顏色略深、略高），沒有 Worker 的本機開發改抓 data/reservoir_fallback.json。
// 每座水庫綁一棟建築或一個景點（ANCHORS）：點湖面、小牌、側欄都打開那棟建築的卡片，卡片裡附蓄水資訊。
// 同名的（壩體建築、烏山頭景點）小牌直接掛在建築上方，建築自己的名牌不再另外顯示。
// 曾文水庫的湖面大多在嘉義縣（區界外），build_city.py 改在楠西區畫一片示意湖（schematic）。
import { TOP } from "./world.js";

const NAMES = ["曾文水庫", "烏山頭水庫", "南化水庫", "白河水庫", "鏡面水庫", "尖山埤"];
export const ANCHORS = {
  曾文水庫: { type: "building", name: "曾文水庫" },
  烏山頭水庫: { type: "poi", id: "wushantou" },
  南化水庫: { type: "building", name: "南化水庫" },
  白河水庫: { type: "building", name: "白河水庫" },
  鏡面水庫: { type: "building", name: "鏡面水庫" },
  尖山埤: { type: "building", name: "尖山埤江南渡假村" },
};
const COLOR = 0x4a86ad; // 比原湖面 0x5f9bbf 深一點，縮小後露出的原湖面看起來像淺灘
const LIFT = 0.006; // 原湖面在 lakeY、岸線帶在 lakeY + 0.004，再高一點避免 z-fighting
export const levelClass = (p) => (p == null ? "lv-none" : p >= 80 ? "lv-high" : p >= 50 ? "lv-mid" : "lv-low"); // 80% 以上藍、50–80 黃、50 以下紅
const scaleOf = (p) => 0.55 + 0.45 * Math.sqrt(Math.max(0, Math.min(1, p / 100))); // 開根號讓面積約與蓄水率成正比

// 多邊形面積中心（shoelace），縮放以此為基準
function centroid(poly) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % n], c = x0 * z1 - x1 * z0;
    a += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c;
  }
  if (Math.abs(a) < 1e-9) return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  return [cx / (3 * a), cz / (3 * a)];
}

// onLand(x, z)：大半不在陸地上的湖不畫（跟 infrastructure.js 同一個標準）
// labelAt(name)：同名錨點的位置 {x, y, z}，小牌掛在它上方；回 null 就掛在湖面中心
export function createReservoirs(THREE, scene, lakes, heightAt = () => 0, { CSS2DObject = null, onChange = null, onLand = null, labelAt = () => null, shortName = (n) => n.replace(/水庫$/, "") } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: COLOR, roughness: 0.3, metalness: 0.05, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
  const items = new Map(); // name → { mesh, target }
  const pickables = [];
  const data = {}; // name → { percent, asOf, source, url }

  for (const lk of lakes || []) {
    if (!NAMES.includes(lk.name) || !lk.polygon || lk.polygon.length < 3) continue;
    if (onLand && lk.polygon.filter(([x, z]) => onLand(x, z)).length / lk.polygon.length < 0.5) continue; // 懸在海上的湖不畫
    const [cx, cz] = centroid(lk.polygon);
    const y = TOP + 0.02 + lk.polygon.reduce((s, [x, z]) => s + heightAt(x, z), 0) / lk.polygon.length + LIFT; // 跟 infrastructure 的湖面同高再抬一點
    const shape = new THREE.Shape(lk.polygon.map(([x, z]) => new THREE.Vector2(x - cx, -(z - cz)))); // 以中心為原點，轉 −90° 後 y 變成世界 z
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(cx, y, cz);
    m.receiveShadow = true;
    m.userData = { type: "reservoir", name: lk.name };
    scene.add(m);
    pickables.push(m);
    let label = null;
    if (CSS2DObject) { // 水面上方的蓄水率小牌；資料到之前先只顯示名稱
      const el = document.createElement("button");
      el.className = "reservoir-label lv-none";
      el.dataset.reservoir = lk.name;
      el.textContent = `💧 ${shortName(lk.name)}`;
      label = new CSS2DObject(el);
      const at = labelAt(lk.name);
      if (at) label.position.set(at.x, at.y + 1.0, at.z); else label.position.set(cx, y + 0.7, cz);
      scene.add(label);
    }
    items.set(lk.name, { mesh: m, target: 1, label, x: cx, z: cz, schematic: !!lk.schematic });
  }

  // map：{ 名稱: { percent, asOf, source?, url? } | null }；percent 為 null 的維持滿水面
  function setLevels(map, source = "wra") {
    for (const [name, v] of Object.entries(map || {})) {
      const it = items.get(name);
      if (!it) continue;
      const p = v && Number.isFinite(+v.percent) ? +v.percent : null;
      const url = typeof v?.source === "string" && /^https?:/.test(v.source) ? v.source : null; // 備援資料的 source 是出處網址
      data[name] = { percent: p, asOf: v?.asOf ?? null, source, url, storage: v?.storage ?? null, capacity: v?.capacity ?? null, level: v?.level ?? null, full: v?.full ?? null, dead: v?.dead ?? null };
      it.target = p === null ? 1 : scaleOf(p);
      if (it.label) {
        it.label.element.className = `reservoir-label ${levelClass(p)}`;
        it.label.element.textContent = `💧 ${shortName(name)}${p === null ? "" : ` ${Math.round(p)}%`}`;
      }
    }
    if (onChange) queueMicrotask(() => onChange(levels())); // 延後一拍：?reservoir= 測試值在建立當下就會呼叫，呼叫端的變數還沒宣告完
  }
  const levels = () => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { ...v }]));

  // 水面縮放用補間，載入資料時慢慢縮到位
  function update(dt) {
    for (const it of items.values()) {
      const s = it.mesh.scale.x + (it.target - it.mesh.scale.x) * Math.min(1, dt * 2.5);
      it.mesh.scale.set(s, 1, s);
    }
  }

  const withAsOf = (rs, asOf) => Object.fromEntries(Object.entries(rs || {}).map(([k, v]) => [k, v && { ...v, asOf: v.asOf || asOf }])); // 沒有各自時間就用整份的
  // 載入：?reservoir=30 全部設 30%（測試用）；否則先 /api/reservoir，失敗（本機 serve.py 會 404）改抓備援 JSON
  const dev = new URLSearchParams(location.search).get("reservoir");
  if (dev !== null && Number.isFinite(+dev)) {
    setLevels(Object.fromEntries(NAMES.map((n) => [n, { percent: +dev, asOf: "dev" }])), "dev");
  } else {
    (async () => {
      try {
        const r = await fetch("/api/reservoir");
        if (r.ok && (r.headers.get("content-type") || "").includes("json")) {
          const d = await r.json();
          if (d.ok) return setLevels(withAsOf(d.reservoirs, d.asOf), d.source || "wra");
        }
      } catch {}
      try {
        const d = await (await fetch("./data/reservoir_fallback.json")).json();
        setLevels(withAsOf(d.reservoirs, d.asOf), "fallback");
      } catch (e) {
        console.warn("[reservoir] 無法取得蓄水率", e);
      }
    })();
  }
  // 側欄與飛行用：每座水庫的中心點
  const places = () => [...items].map(([name, it]) => ({ name, x: it.x, z: it.z, schematic: it.schematic }));
  const labels = () => [...items.values()].map((it) => it.label).filter(Boolean);
  return { update, setLevels, levels, places, labels, pickables };
}
