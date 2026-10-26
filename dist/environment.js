// 天空、光照、水面。用分鐘數在關鍵影格之間插值，就能得到一天的變化。
// [分鐘, 天空, 地平線/霧, 太陽色, 太陽強度, 半球光強度, 夜晚係數, 水色]
// KEYS 的時間軸是「標準日」：日出固定在 360（06:00）、正午 720、日落 1080（18:00）。
// setDate() 之後，setTime() 會把真實的分鐘數重新對應到這條標準時間軸上，
// 讓黎明／黃昏的轉場剛好落在該日期的實際日出／日落。
const KEYS = [
  [0, 0x1b2750, 0x3a4a7c, 0xb4c2ff, 0.35, 0.95, 1.0, 0x355a86],
  [300, 0x22305e, 0x475489, 0xb8c4ff, 0.35, 0.95, 1.0, 0x385d88],
  [390, 0x8aa0d0, 0xf6c3a6, 0xffb48a, 1.1, 1.0, 0.45, 0x6f9bc0],
  [480, 0xbcd7f2, 0xfdebd8, 0xfff2dc, 1.7, 1.1, 0.0, 0x7fb0d2],
  [720, 0x9ccbf5, 0xeaf3fb, 0xffffff, 2.0, 1.2, 0.0, 0x79b3dc],
  [1000, 0xa9bde0, 0xfbd7b5, 0xffd1a0, 1.5, 1.0, 0.05, 0x7aa7cc],
  [1100, 0x4a4f8c, 0xf08a6a, 0xff8f66, 0.9, 0.8, 0.55, 0x5a7fae],
  [1200, 0x1f2c5a, 0x45558c, 0xb8c4ff, 0.4, 0.95, 1.0, 0x3b5f88],
  [1440, 0x1b2750, 0x3a4a7c, 0xb4c2ff, 0.35, 0.95, 1.0, 0x355a86],
];

// 標準日的關鍵時刻（KEYS 時間軸）
const KEY_SUNRISE = 360, KEY_NOON = 720, KEY_SUNSET = 1080, DAY = 1440;

// 台南：北緯 23.0°，太陽正午約 12:10（本地時間）
const LATITUDE_DEG = 23.0;
const SOLAR_NOON_MIN = 11 * 60 + 58;
const DEG = Math.PI / 180;

// 以年內日序估算日出／日落（分鐘）。標準近似：
//   赤緯 δ = 23.44° · sin(2π·(doy − 81)/365)
//   時角 ω = acos(−tan φ · tan δ)，白晝長度 = 2ω/15 小時
export function computeDaylight(date, latitudeDeg = LATITUDE_DEG, solarNoon = SOLAR_NOON_MIN) {
  const year = date.getUTCFullYear();
  const doy = Math.floor((date.getTime() - Date.UTC(year, 0, 1)) / 86400000) + 1;
  const decl = 23.44 * DEG * Math.sin((2 * Math.PI * (doy - 81)) / 365);
  const cosHA = Math.min(1, Math.max(-1, -Math.tan(latitudeDeg * DEG) * Math.tan(decl)));
  const halfDayMin = ((Math.acos(cosHA) / DEG) / 15) * 60; // ω/15 小時 → 分鐘
  return { sunrise: solarNoon - halfDayMin, sunset: solarNoon + halfDayMin };
}

export function createEnvironment(THREE, scene) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x6b5a5a, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.castShadow = true;
  // 陰影貼圖依裝置調整：行動裝置或低核心數的機器用 2048
  const lowEnd = /Mobi|Android/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4 || Math.min(screen.width, screen.height) < 800;
  sun.shadow.mapSize.set(lowEnd ? 2048 : 4096, lowEnd ? 2048 : 4096);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -18;
  sc.right = sc.top = 18;
  sc.near = 1;
  sc.far = 80;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  scene.add(new THREE.AmbientLight(0xffffff, 0.15));

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({ color: 0x79b3dc, roughness: 0.35, metalness: 0.05 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.25;
  water.receiveShadow = true;
  scene.add(water);

  scene.fog = new THREE.Fog(0xffffff, 24, 75);
  scene.background = new THREE.Color();

  const ca = new THREE.Color(), cb = new THREE.Color();
  const lerpC = (a, b, t, target) => target.copy(ca.set(a)).lerp(cb.set(b), t);
  const lerpN = (a, b, t) => a + (b - a) * t;

  // 目前日期的實際日出／日落；未呼叫 setDate 前等於標準日，setTime 行為與原本完全相同
  let sunrise = KEY_SUNRISE, sunset = KEY_SUNSET;

  // 天氣：雲量 0～1 與是否下雨。setTime 照 KEYS 算完日夜後再乘上雲量係數，不動原本的日夜變化
  let cloud = 0, rain = false, lastMin = 480;
  function applyWeather() {
    if (!cloud) return;
    sun.intensity *= 1 - 0.55 * cloud; // 陰天陽光變弱
    sun.color.lerp(cb.set(0xdfe3e8), cloud * 0.6); // 光色往灰白靠
    hemi.intensity *= 1 - 0.25 * cloud; // 半球光略降
    scene.fog.color.lerp(cb.set(0xb9c0c8), cloud * (rain ? 0.6 : 0.45)); // 霧與天空偏灰，下雨更明顯
    scene.background.lerp(cb.set(0xaab3bd), cloud * (rain ? 0.5 : 0.35));
    water.material.color.lerp(cb.set(0x6f8aa0), cloud * 0.4);
  }

  function setWeather({ cloud: c = 0, rain: r = false } = {}) {
    cloud = Math.min(Math.max(+c || 0, 0), 1);
    rain = !!r;
    setTime(lastMin); // 立刻用目前時刻重算光照
  }

  function setDate(date) {
    ({ sunrise, sunset } = computeDaylight(date));
  }

  function getDaylight() {
    return { sunrise, sunset };
  }

  // 把真實分鐘數分段線性對應到 KEYS 的標準時間軸：
  //   [0, 日出] → [0, 360]、[日出, 正午] → [360, 720]、[正午, 日落] → [720, 1080]、[日落, 1440] → [1080, 1440]
  function toKeyTime(min) {
    const noon = (sunrise + sunset) / 2;
    const seg = (x, a0, a1, b0, b1) => b0 + ((x - a0) / (a1 - a0)) * (b1 - b0);
    if (min <= sunrise) return seg(min, 0, sunrise, 0, KEY_SUNRISE);
    if (min <= noon) return seg(min, sunrise, noon, KEY_SUNRISE, KEY_NOON);
    if (min <= sunset) return seg(min, noon, sunset, KEY_NOON, KEY_SUNSET);
    return seg(min, sunset, DAY, KEY_SUNSET, DAY);
  }

  function setTime(min) {
    lastMin = min;
    const k = Math.min(Math.max(toKeyTime(min), 0), DAY);
    let i = 0;
    while (KEYS[i + 1][0] < k) i++;
    const A = KEYS[i], B = KEYS[i + 1], t = (k - A[0]) / (B[0] - A[0]);
    lerpC(A[1], B[1], t, scene.background);
    lerpC(A[2], B[2], t, scene.fog.color);
    lerpC(A[2], B[2], t, hemi.color);
    lerpC(A[3], B[3], t, sun.color);
    lerpC(A[7], B[7], t, water.material.color);
    sun.intensity = lerpN(A[4], B[4], t);
    hemi.intensity = lerpN(A[5], B[5], t);
    const night = lerpN(A[6], B[6], t);
    const ang = ((min - sunrise) / (sunset - sunrise)) * Math.PI; // 日出 → 0，日落 → π
    sun.position.set(Math.cos(ang) * 18, Math.max(Math.sin(ang), 0.25) * 22, 10);
    applyWeather();
    return night;
  }

  // 依城市大小調整陰影範圍；霧的距離依全景鏡頭的距離算，直向手機鏡頭拉得比桌機遠，才不會整座島都被霧蓋住
  function setExtent(size, viewDist = size * 1.45) {
    sc.left = sc.bottom = -size * 0.75;
    sc.right = sc.top = size * 0.75;
    sc.updateProjectionMatrix();
    scene.fog.near = viewDist * 0.9;
    scene.fog.far = viewDist * 2.35;
  }
  return { setTime, setExtent, setDate, getDaylight, setWeather };
}
