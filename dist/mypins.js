// 我的圖釘：使用者在地圖上放的圖釘與一行筆記，存在 localStorage，可編成網址分享（?pins=）。
// 存檔與分享用「1 倍地圖」的座標（世界座標 ÷ scale），地圖放大前存的圖釘與舊連結照樣對得上。
const KEY = "hexcity-pins";

export function createMyPins(THREE, scene, { groundY, toLonLat, districtAt, onChange, scale: S = 1 }) {
  let pins = [];
  try { pins = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch {}
  const group = new THREE.Group();
  scene.add(group);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3e7c8c });
  const cone = new THREE.ConeGeometry(0.11, 0.36, 10), ball = new THREE.SphereGeometry(0.14, 12, 10);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pins)); } catch {} onChange?.(pins); };

  function rebuild() {
    while (group.children.length) group.remove(group.children[0]);
    pins.forEach((p, i) => {
      const g = new THREE.Group();
      const m1 = new THREE.Mesh(cone, mat); m1.rotation.x = Math.PI; m1.position.y = 0.18;
      const m2 = new THREE.Mesh(ball, mat); m2.position.y = 0.46;
      m2.userData = { type: "mypin", id: i }; m1.userData = { type: "mypin", id: i };
      g.add(m1, m2);
      const x = p.x * S, z = p.z * S;
      g.position.set(x, groundY(x, z), z);
      group.add(g);
    });
  }
  rebuild();

  const addBase = (bx, bz, note = "") => { const d = districtAt?.(bx * S, bz * S) ?? null; pins.push({ x: +bx.toFixed(3), z: +bz.toFixed(3), note: String(note).slice(0, 80), district: d }); save(); rebuild(); return pins.length - 1; };
  const add = (x, z, note = "") => addBase(x / S, z / S, note); // 傳入世界座標
  const update = (i, note) => { if (pins[i]) { pins[i].note = String(note).slice(0, 80); save(); } };
  const remove = (i) => { pins.splice(i, 1); save(); rebuild(); };
  const clear = () => { pins = []; save(); rebuild(); };
  const world = (p, i) => ({ ...p, x: p.x * S, z: p.z * S, id: i }); // 對外一律是世界座標
  const list = () => pins.map(world);
  const get = (i) => (pins[i] ? world(pins[i], i) : null);
  // 分享：x,z,note 用 ~ 分隔，筆記 encodeURIComponent
  const encode = () => pins.map((p) => `${p.x}~${p.z}~${encodeURIComponent(p.note || "")}`).join(",");
  function importFrom(str) {
    let n = 0;
    for (const item of String(str).split(",")) {
      const [x, z, note = ""] = item.split("~");
      const fx = parseFloat(x), fz = parseFloat(z);
      if (!Number.isFinite(fx) || !Number.isFinite(fz)) continue;
      const dn = decodeURIComponent(note);
      if (pins.some((p) => Math.abs(p.x - fx) < 0.01 && Math.abs(p.z - fz) < 0.01)) continue; // 已有就略過
      addBase(fx, fz, dn); n++;
    }
    return n;
  }
  const pickables = () => group.children.flatMap((g) => g.children);
  return { add, update, remove, clear, list, get, encode, importFrom, pickables, count: () => pins.length };
}
