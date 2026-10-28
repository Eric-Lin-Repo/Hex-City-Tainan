// 零件庫：所有靜態幾何依種類收集，最後每種只用一個 InstancedMesh 畫出來。
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export function createKit(THREE) {
  const geo = {
    box: new THREE.BoxGeometry(1, 1, 1),
    rbox: new RoundedBoxGeometry(1, 1, 1, 2, 0.1),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
    cone: new THREE.ConeGeometry(0.5, 1, 12),
    sphere: new THREE.SphereGeometry(0.5, 14, 10),
    dome: new THREE.SphereGeometry(0.5, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2),
    torus: new THREE.TorusGeometry(0.5, 0.06, 8, 24),
    // 四角屋頂：底面剛好是 1×1 正方形，任意 w×d 縮放都還是乾淨的矩形
    hip: new THREE.ConeGeometry(0.5, 1, 4).rotateY(Math.PI / 4).scale(Math.SQRT2, 1, Math.SQRT2),
    hex: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
    glow: new THREE.BoxGeometry(1, 1, 1),
    glowsphere: new THREE.SphereGeometry(0.5, 12, 8),
    glass: new THREE.BoxGeometry(1, 1, 1),
  };
  const standard = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const glassMat = new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.55 });
  const matFor = (k) => (k === "glow" || k === "glowsphere" ? glowMat : k === "glass" ? glassMat : standard);

  const items = {}, groups = new Map(), meshes = {};
  let currentGroup = null;
  function part(kind, pos, size, color, rot = null) {
    if (!geo[kind]) throw Error("unknown part: " + kind);
    (items[kind] ||= []).push({ pos, size, color, rot });
    if (currentGroup) groups.get(currentGroup).push({ kind, idx: items[kind].length - 1, color });
  }
  // anchor：群組的基準點（建築的位置），setGroupScale 以它為中心縮放
  function beginGroup(id, anchor = null) { currentGroup = id; const list = []; list.anchor = anchor; groups.set(id, list); }
  function endGroup() { currentGroup = null; }
  // 把群組裡的發光零件調暗或恢復
  const _c = new THREE.Color();
  function setGroupDim(id, dim) {
    for (const e of groups.get(id) || []) {
      if (e.kind !== "glow" && e.kind !== "glowsphere") continue;
      const m = meshes[e.kind];
      if (!m) continue;
      m.setColorAt(e.idx, _c.set(dim ? 0x4a4238 : e.color));
      m.instanceColor.needsUpdate = true;
    }
  }

  function build(scene) {
    const dummy = new THREE.Object3D(), col = new THREE.Color();
    let count = 0;
    for (const [kind, list] of Object.entries(items)) {
      const mesh = new THREE.InstancedMesh(geo[kind], matFor(kind), list.length);
      list.forEach((p, i) => {
        dummy.position.set(...p.pos);
        dummy.scale.set(...p.size);
        if (p.rot) dummy.rotation.set(...p.rot);
        else dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, col.set(p.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = kind !== "glass" && kind !== "hex";
      mesh.receiveShadow = true;
      scene.add(mesh);
      meshes[kind] = mesh;
      count += list.length;
    }
    return { kinds: Object.keys(items).length, parts: count };
  }

  // 夜晚窗燈變亮：instance 顏色會乘上材質顏色，白天把材質壓暗即可
  function setNight(f) {
    glowMat.color.setScalar(0.45 + 0.55 * f);
  }

  // 把「整體繞 y 轉 ry」與零件自己的 Euler 旋轉正確合成（Ry · Rpart），回傳 Euler 陣列
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
  function composeRot(ry, rot) {
    _q1.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    _q2.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
    _q1.multiply(_q2);
    _e.setFromQuaternion(_q1);
    return [_e.x, _e.y, _e.z];
  }
  // 把群組裡指定種類的零件換成某個顏色；color 為 null 則恢復原色
  function setGroupColor(id, color, kinds) {
    for (const e of groups.get(id) || []) {
      if (kinds && !kinds.includes(e.kind)) continue;
      const m = meshes[e.kind];
      if (!m) continue;
      m.setColorAt(e.idx, _c.set(color == null ? e.color : color));
      m.instanceColor.needsUpdate = true;
    }
  }
  // 把整個群組以 anchor 為中心縮放（0 = 隱藏、1 = 原尺寸）：中西區次要建築拉近才「長」出來
  const _d = new THREE.Object3D(), touched = new Set();
  function setGroupScale(id, k) {
    const list = groups.get(id), a = list?.anchor;
    if (!list || !a) return;
    touched.clear();
    for (const e of list) {
      const m = meshes[e.kind], p = items[e.kind][e.idx];
      if (!m) continue;
      _d.position.set(a.x + (p.pos[0] - a.x) * k, a.y + (p.pos[1] - a.y) * k, a.z + (p.pos[2] - a.z) * k);
      _d.scale.set(p.size[0] * k || 1e-6, p.size[1] * k || 1e-6, p.size[2] * k || 1e-6);
      if (p.rot) _d.rotation.set(...p.rot); else _d.rotation.set(0, 0, 0);
      _d.updateMatrix();
      m.setMatrixAt(e.idx, _d.matrix);
      touched.add(m);
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
  }
  return { part, build, setNight, composeRot, beginGroup, endGroup, setGroupDim, setGroupColor, setGroupScale };
}
