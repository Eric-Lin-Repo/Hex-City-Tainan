// 地形：把 data/terrain.json 的高度場做成一片起伏的網格蓋在島上，並提供 heightAt(x, z) 讓建築、行人、火車貼著山坡。
// 高度場由 tools/build_terrain.py 產生：{x0, z0, dx, dz, nx, nz, heights(列優先：先 z 再 x), maxH}，高度是 TOP 之上的世界單位。
const FLAT_DROP = 0.05; // 高度 0 的頂點放在 TOP 之下一點，讓平地的島面仍露出來、不閃爍
const LOW = 0xd8ccb8, MID = 0x6f8f5e, HIGH = 0x8a7f6e; // 平地色 → 綠 → 灰褐

export function createTerrain(THREE, scene, data, TOP) {
  const { x0, z0, dx, dz, nx, nz, heights } = data;
  const maxH = Math.max(data.maxH || 0, 1e-6);
  const H = (ix, iz) => heights[iz * nx + ix];

  // 雙線性取樣，格子外回 0
  function heightAt(x, z) {
    const fx = (x - x0) / dx, fz = (z - z0) / dz;
    if (!(fx >= 0 && fz >= 0 && fx <= nx - 1 && fz <= nz - 1)) return 0;
    const ix = Math.min(Math.floor(fx), nx - 2), iz = Math.min(Math.floor(fz), nz - 2);
    const tx = fx - ix, tz = fz - iz;
    const a = H(ix, iz) * (1 - tx) + H(ix + 1, iz) * tx;
    const b = H(ix, iz + 1) * (1 - tx) + H(ix + 1, iz + 1) * tx;
    return a * (1 - tz) + b * tz;
  }

  // 一片 PlaneGeometry，rotateX(-π/2) 後第 0 列對到最小 z，頂點順序 iz * nx + ix 正好和 heights 一致
  const g = new THREE.PlaneGeometry((nx - 1) * dx, (nz - 1) * dz, nx - 1, nz - 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const color = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color(LOW), cMid = new THREE.Color(MID), cHigh = new THREE.Color(HIGH), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ix = i % nx, iz = Math.floor(i / nx), h = heights[i];
    pos.setXYZ(i, x0 + ix * dx, h > 0 ? TOP + h : TOP - FLAT_DROP, z0 + iz * dz);
    const t = h / maxH;
    if (t < 0.35) c.copy(cLow).lerp(cMid, t / 0.35);
    else c.copy(cMid).lerp(cHigh, (t - 0.35) / 0.65);
    color[i * 3] = c.r; color[i * 3 + 1] = c.g; color[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(color, 3));
  // 三個角都是 0 的三角形不畫：水道上方不會出現一層蓋住水面的平板（水面在 y = −0.25，TOP − 0.05 會蓋住它）
  const src = g.index.array, idx = [];
  for (let k = 0; k < src.length; k += 3) {
    const a = src[k], b = src[k + 1], d = src[k + 2];
    if (heights[a] > 0 || heights[b] > 0 || heights[d] > 0) idx.push(a, b, d);
  }
  g.setIndex(idx);
  g.computeVertexNormals();

  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { type: "terrain" };
  scene.add(mesh);
  return { heightAt, mesh, triangles: idx.length / 3 };
}
