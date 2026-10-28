// 即時天氣：抓 Open-Meteo 台南當下天氣，雲量調暗陽光、下雨時全圖飄雨，左上角徽章顯示「⛅ 27°C 多雲」。
// 網址加 ?weather=rain / cloudy / clear 可不打 API 直接用假資料測畫面。
import { TOP } from "./world.js";

const API = "https://api.open-meteo.com/v1/forecast?latitude=22.99&longitude=120.21&current=temperature_2m,relative_humidity_2m,cloud_cover,precipitation,weather_code,wind_speed_10m&daily=precipitation_sum&past_days=1&forecast_days=1&timezone=Asia%2FTaipei"; // daily[0] 是昨天（山谷雲海要看前一天有沒有下雨）
const REFRESH_MS = 10 * 60 * 1000, TIMEOUT_MS = 15000;
const DROPS_1X = 2500, DROP_LEN = 0.35, FALL_SPEED = 9, RAIN_TOP = 12; // 雨絲數量、長度、下落速度（單位/秒）、雨區高度
const FAKE = {
  rain: { temperature_2m: 24.6, relative_humidity_2m: 95, cloud_cover: 96, precipitation: 2.4, weather_code: 63, rain_yesterday: 12 },
  cloudy: { temperature_2m: 27.1, relative_humidity_2m: 82, cloud_cover: 82, precipitation: 0, weather_code: 3, rain_yesterday: 0 },
  clear: { temperature_2m: 30.2, relative_humidity_2m: 60, cloud_cover: 8, precipitation: 0, weather_code: 0, rain_yesterday: 0 },
};

// WMO 天氣代碼 → 中文標籤與圖示。0 晴、1～3 多雲、45/48 霧、51～67 雨、71～77 雪、80～82 陣雨、95～99 雷雨
function describe(code, cloudPct) {
  if (code >= 95) return ["雷雨", "⛈️"];
  if (code >= 80) return [code === 80 ? "小雨" : "雨", "🌧️"];
  if (code >= 71) return ["雪", "🌨️"];
  if (code >= 51) return [code <= 61 ? "小雨" : "雨", "🌧️"];
  if (code === 45 || code === 48) return ["霧", "🌫️"];
  if (code === 3 || cloudPct >= 85) return ["陰", "☁️"];
  if (code >= 1) return ["多雲", "⛅"];
  return ["晴", "☀️"];
}

export function createWeather(THREE, scene, env, opts = {}) {
  const container = opts.container ?? document.querySelector(".brand") ?? document.body;
  const groundY = opts.groundY ?? TOP;
  const state = { ok: false, temp: null, cloud: 0, rain: false, code: null, label: "", icon: "", updatedAt: null, humidity: null, rainYesterday: null };
  let bounds = opts.bounds ?? { minX: -35.5, maxX: 35.5, minZ: -33, maxZ: 33 };
  const DROPS = Math.round(DROPS_1X * (opts.scale ?? 1) ** 2); // 雨下在整張地圖上：地圖放大 S 倍，雨絲 ×S² 密度才一樣

  // ── 徽章 ──
  const badge = document.createElement("div");
  badge.className = "weather-badge";
  badge.setAttribute("role", "status");
  badge.setAttribute("aria-live", "polite");
  container.appendChild(badge);
  function render() {
    const has = state.temp !== null;
    badge.classList.toggle("is-stale", has && !state.ok);
    badge.classList.toggle("is-empty", !has);
    badge.title = has ? `台南 ${state.updatedAt.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })} 更新${state.ok ? "" : "（更新失敗，顯示上一次）"}` : "";
    const tr = opts.translate ?? ((zh) => zh); // 多語言：app 可傳 translate(中文) 回對應語言
    badge.textContent = has ? `${state.icon} ${Math.round(state.temp)}°C ${tr(state.label)}` : tr("天氣資料暫時無法取得");
  }
  render();

  // ── 雨絲：一個 BufferGeometry，每幀只改 position 並 needsUpdate ──
  const pos = new Float32Array(DROPS * 6);
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", attr);
  const rainMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9fb8d8, transparent: true, opacity: 0.55, depthWrite: false }));
  rainMesh.frustumCulled = false;
  rainMesh.visible = false;
  scene.add(rainMesh);
  const rand = (a, b) => a + Math.random() * (b - a);
  function placeDrop(i, y) {
    const o = i * 6, x = rand(bounds.minX, bounds.maxX), z = rand(bounds.minZ, bounds.maxZ);
    pos[o] = x + 0.05; pos[o + 1] = y + DROP_LEN; pos[o + 2] = z; // 上端略偏，雨絲帶一點斜度
    pos[o + 3] = x; pos[o + 4] = y; pos[o + 5] = z;
  }
  function scatter() {
    for (let i = 0; i < DROPS; i++) placeDrop(i, groundY + Math.random() * RAIN_TOP);
    attr.needsUpdate = true;
  }
  scatter();

  function update(dt) {
    if (!rainMesh.visible || !dt) return;
    const dy = FALL_SPEED * dt;
    for (let i = 0; i < DROPS; i++) {
      const o = i * 6;
      pos[o + 1] -= dy; pos[o + 4] -= dy;
      if (pos[o + 4] < groundY) placeDrop(i, pos[o + 4] + RAIN_TOP); // 掉到地面就回到頂端、換個位置
    }
    attr.needsUpdate = true;
  }

  function setBounds(b) {
    bounds = { ...bounds, ...b };
    scatter();
  }

  // ── 套用到場景：陰天減光、下雨顯示雨絲 ──
  function apply(cur) {
    const [label, icon] = describe(cur.weather_code, cur.cloud_cover);
    state.temp = cur.temperature_2m;
    state.humidity = typeof cur.relative_humidity_2m === "number" ? cur.relative_humidity_2m : null;
    state.rainYesterday = typeof cur.rain_yesterday === "number" ? cur.rain_yesterday : null;
    state.code = cur.weather_code;
    state.rain = cur.precipitation > 0 || cur.weather_code >= 51; // 51 以上都是降水（雨、雪、陣雨、雷雨）
    state.cloud = Math.min(1, Math.max(cur.cloud_cover / 100, state.rain ? 0.8 : 0)); // 下雨時至少當 80% 雲量
    state.label = label; state.icon = icon;
    state.updatedAt = new Date();
    env.setWeather({ cloud: state.cloud, rain: state.rain });
    rainMesh.visible = state.rain;
    render();
    opts.onChange?.(current());
  }

  let ctrl = null;
  async function refresh() {
    ctrl?.abort();
    ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(opts.apiUrl ?? API, { signal: ctrl.signal });
      if (!r.ok) throw Error(`open-meteo ${r.status}`);
      const body = await r.json(), cur = body.current;
      if (cur && Array.isArray(body.daily?.precipitation_sum)) cur.rain_yesterday = body.daily.precipitation_sum[0]; // past_days=1：第 0 筆是昨天
      if (typeof cur?.temperature_2m !== "number") throw Error("open-meteo: 回傳格式不符");
      state.ok = true;
      apply(cur);
    } catch (e) {
      state.ok = false; // 失敗保留上一次資料，徽章標成過期
      render();
      console.warn("[weather]", e.message);
    } finally {
      clearTimeout(timer);
    }
  }

  function current() {
    return { ...state };
  }

  // 載入立刻抓一次、之後每 10 分鐘一次；開發模式用假資料
  const fake = FAKE[new URLSearchParams(location.search).get("weather")];
  let timer = null;
  if (fake) { state.ok = true; apply(fake); }
  else { refresh(); timer = setInterval(refresh, opts.refreshMs ?? REFRESH_MS); }

  function destroy() {
    clearInterval(timer);
    ctrl?.abort();
    badge.remove();
    scene.remove(rainMesh);
    geo.dispose(); rainMesh.material.dispose();
    env.setWeather({ cloud: 0, rain: false });
  }

  return { update, refresh, current, setBounds, destroy };
}
