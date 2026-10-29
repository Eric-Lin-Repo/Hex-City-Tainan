// 分層顯示：buildings_source.json 第 5 欄標了 layer（街區層：老街、小廟、市場）的建築拉近才從地面長出來，看單一區時出現；
// settings.json 的 minorBuildings（用建築原名比對）也一樣。還沒長出來的不能點、不顯示名牌（app.js 用 scaleOf 判斷）。
// createLayers({ islands, minorBuildings, world, S })
//   → { size, scaleOf(id) → 0～1（不分層的建築回 1）, update(dt, camD, target, selectedId), snapshot() → { 建築 id: 縮放 } }
const GROW = 0.3; // 長出來花幾秒

export function createLayers({ islands, minorBuildings, world, S }) {
  const scale = new Map(); // 建築 id → 目前的縮放 0～1
  for (const isl of islands) for (const b of isl.buildings) if (b.layer) scale.set(b.id, 1);
  for (const [dn, names] of Object.entries(minorBuildings || {})) {
    if (dn.startsWith("_")) continue;
    const isl = islands.find((x) => (x.name_zh ?? x.name) === dn);
    for (const b of isl?.buildings || []) if (names.includes(b.name_zh ?? b.name)) scale.set(b.id, 1);
  }
  const lim = 12 * S; // 鏡頭離焦點小於這個距離、建築也在焦點附近才出現（點選一區時鏡頭約 20–45）

  // 拉近到焦點附近、或被選取時長出來；拉遠縮回地面
  function update(dt, camD, tg, selectedId) {
    for (const [id, k] of scale) {
      const bp = world.buildingPos.get(id);
      const near = camD < lim && !!bp && Math.hypot(bp.x - tg.x, bp.z - tg.z) < lim * 1.5;
      const want = near || selectedId === id ? 1 : 0;
      if (k === want) continue;
      const nk = want > k ? Math.min(1, k + dt / GROW) : Math.max(0, k - dt / GROW);
      scale.set(id, nk);
      const e = nk * nk * (3 - 2 * nk); // smoothstep，長出來時有加減速
      world.setBuildingScale(id, e);
    }
  }

  return { size: scale.size, scaleOf: (id) => scale.get(id) ?? 1, update, snapshot: () => Object.fromEntries(scale) };
}
