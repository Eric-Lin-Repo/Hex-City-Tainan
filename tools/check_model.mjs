// 用法：node tools/check_model.mjs <kind> [...]　用假的 kit 執行 buildModel，印出零件數與高度範圍，不需要瀏覽器
import { buildModel } from "../models.js";
const kinds = process.argv.slice(2);
for (const kind of kinds) {
  const parts = [];
  const kit = { part: (k, pos, size, color, rot) => { if (!["box","rbox","cylinder","cone","sphere","dome","torus","hip","hex","glow","glowsphere","glass"].includes(k)) throw Error("unknown kit kind " + k); parts.push({ k, pos, size }); }, composeRot: (ry, rot) => rot };
  buildModel(kit, kind, { x: 0, y: 0, z: 0 }, 1, 0x3e7c8c, 0);
  const top = Math.max(...parts.map((p) => p.pos[1] + p.size[1] / 2)), span = Math.max(...parts.map((p) => Math.max(Math.abs(p.pos[0]) + p.size[0] / 2, Math.abs(p.pos[2]) + p.size[2] / 2)));
  console.log(`${kind}: ${parts.length} parts, top y=${top.toFixed(2)}, half-span=${span.toFixed(2)}${parts.length <= 1 ? "  <-- 未實作（退回預設方塊）" : ""}`);
}
