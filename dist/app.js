// 主控：渲染器、相機、互動、側欄、卡片、時間控制。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { createKit } from "./kit.js";
import { buildWorld, TOP } from "./world.js";
import { buildModel, tree } from "./models.js";
import { createEnvironment } from "./environment.js";
import { createPeople } from "./people.js";
import { createTrains } from "./train.js";
import { createEvents } from "./events.js";
import { buildInfrastructure } from "./infrastructure.js";
import { createTerrain } from "./terrain.js";
import { createAudio } from "./audio.js";
import { mulberry } from "./world.js";
import { lunarLabel, lunarOf, nextOccurrence, isActive, activeOccurrence, occurrencesIn, fmtDate, fmtRange } from "./calendar.js";
import { createCalendarPanel } from "./calendar-panel.js";
import { createWeather } from "./weather.js";
import { createBuses } from "./bus.js";
import { createHighways } from "./highways.js";
import { createTrails } from "./trails.js";
import { createSugarRail } from "./sugar.js";
import { createReservoirs, levelClass, ANCHORS } from "./reservoir.js";
import { createScenery, badlandPatches } from "./scenery.js";
import { createMonkeys } from "./monkeys.js";
import { createHeatmap } from "./heatmap.js";
import { createFields } from "./fields.js";
import { createI18n, detectLang } from "./i18n.js";
import { createStamps } from "./stamps.js";
import { createMyPins } from "./mypins.js";
import { createSpeech } from "./speech.js";
import { createTalk } from "./talk.js";
import { createTrip } from "./trip.js";
import { createSpecs } from "./specs.js";
import { createQuiz } from "./quiz.js";
import { createPhoto } from "./photo.js";
import { createFindMing } from "./findming.js";
import { createGuide } from "./guide.js";
import { createFood } from "./food.js";
import { createCards } from "./cards.js";
import { createTour } from "./tour.js";
import { createLayers } from "./layers.js";

const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const params = new URLSearchParams(location.search);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

try {
  const loadJson = (url) =>
    fetch(url, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw Error(`${url} ${r.status}`);
      return r.json();
    });
  const [islandData, flowData, settings, roles, city, rail, poi, eventData, water, terrainData, mapLinks, toursData, busData, trailData, sugarData, agesData, cropsData, specData, stampsData, talkData, hsrData, seasonsData, foodData, sceneryData, hwData] = await Promise.all(
    ["./data/islands.json", "./data/flows.json", "./data/settings.json", "./data/roles.json", "./data/city.json", "./data/rail.json", "./data/poi.json", "./data/events.json", "./data/water_mrt.json", "./data/terrain.json", "./data/maplinks.json", "./data/tours.json", "./data/bus.json", "./data/trails.json", "./data/sugar.json", "./data/ages.json", "./data/crops.json", "./data/specialties.json", "./data/stamps.json", "./data/talk.json", "./data/hsr.json", "./data/spec_seasons.json", "./data/food.json", "./data/scenery.json", "./data/highways.json"].map(loadJson),
  );
  // 多語言：翻譯直接覆蓋進資料，之後所有卡片與清單都不用改；原文留在 *_zh（Google 地圖查詢用）
  const i18n = await createI18n(detectLang(params), loadJson);
  i18n.applyData({ islands: islandData, poi, events: eventData, rail, roles, settings, tours: toursData, crops: cropsData, flows: flowData, specialties: specData, foods: foodData, scenery: sceneryData });
  const specOf = (id) => specData.byDistrict[id] || []; // 各區農特產
  // 特產標籤可以點：點了亮出全部產地（specs.js）；當季的加一個小點。specMonth 由 setDate 更新
  let specMonth = new Date().getMonth() + 1;
  const specKey = (x) => x.name_zh ?? x.name;
  const specTags = (id) => specOf(id).map((x) => { const now = seasonsData.byName?.[specKey(x)]?.months?.includes(specMonth); return `<button type="button" class="spec${now ? " now" : ""}" data-spec="${esc(specKey(x))}" title="${esc(now ? t("spec.now_title", "當季，點看全部產地") : t("spec.tag_title", "點看全部產地"))}">${esc(x.icon)} ${esc(x.name)}</button>`; }).join("");
  const t = i18n.t;
  const speech = createSpeech({ lang: i18n.lang, t }); // 朗讀卡片與導覽字幕（瀏覽器內建語音）
  i18n.applyDom();
  i18n.mountSwitch($(".toolbar"));
  const zh = (o) => o?.name_zh || o?.name; // 地圖查詢用原文名稱
  // ── 畫質分級：high／med／low。手機、4 核以下或小螢幕從 med 起跳；?quality= 可強制；執行中 FPS 太低會再自動降一級 ──
  const lowEndDevice = /Mobi|Android/i.test(navigator.userAgent) || (navigator.hardwareConcurrency || 8) <= 4 || Math.min(screen.width, screen.height) < 800;
  const QUALITY = { high: { ratio: 1.5, shadows: true, people: 750 }, med: { ratio: 1.15, shadows: true, people: 570 }, low: { ratio: 0.85, shadows: false, people: 390 } }; // 地圖放大 3 倍後行人加到 1.5 倍
  let quality = ["high", "med", "low"].includes(params.get("quality")) ? params.get("quality") : lowEndDevice ? "med" : "high";
  const D = { islands: islandData, flows: flowData, dayCycle: settings.dayCycle, settings: { ...settings, population: Math.min(settings.population ?? 500, QUALITY[quality].people) }, roles, city, rail, poi, events: eventData, water, ages: agesData, specialties: specData, specSeasons: seasonsData };
  const roleLabel = (r) => roles.roles[r]?.label || r;
  const islands = new Map(D.islands.map((i) => [i.id, i]));
  const buildings = new Map(D.islands.flatMap((i) => i.buildings.map((b) => [b.id, { ...b, island: i.id }])));
  const flows = new Map(D.flows.map((f) => [f.id, f]));
  const flowsOf = (islandId) => D.flows.filter((f) => f.from === islandId || f.to === islandId);

  // ── 渲染器與相機 ──
  const stage = $("#stage");
  const renderer = new THREE.WebGLRenderer({ antialias: quality === "high" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[quality].ratio));
  renderer.shadowMap.enabled = QUALITY[quality].shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  stage.appendChild(renderer.domElement);
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.id = "labels";
  stage.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const S = city.scale ?? 1; // 地圖放大倍數（build_city.py 的 MAP_SCALE）：地圖上的距離乘 S，模型大小不變
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500 * S); // near 每幀依鏡頭距離調整（見 animate），拉遠時深度才夠精確
  const B = city.bounds, CX = (B.minX + B.maxX) / 2, CZ = (B.minZ + B.maxZ) / 2, EXT = Math.max(B.maxX - B.minX, B.maxZ - B.minZ);
  const HOME = { pos: new THREE.Vector3(CX, EXT * 1.0, CZ + EXT * 1.05), target: new THREE.Vector3(CX, 0.3, CZ + EXT * 0.05) };
  // 直式螢幕的水平視角比較窄，全景要依長寬比拉遠（以 1.2（1440×900 桌面）為基準，最多 2.4 倍）
  const homeView = () => { const aspect = stage.clientWidth / Math.max(1, stage.clientHeight); const f = Math.min(2.4, Math.max(1, Math.pow(1.2 / aspect, 0.85))); return { pos: new THREE.Vector3(CX, EXT * f, CZ + EXT * 1.05 * f), target: HOME.target.clone() }; };
  camera.position.copy(HOME.pos);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 3;
  controls.maxDistance = EXT * 3;

  // ── 場景 ──
  const env = createEnvironment(THREE, scene);
  env.setExtent(EXT);
  const kit = createKit(THREE);
  const terrain = createTerrain(THREE, scene, terrainData, TOP, { patches: badlandPatches(sceneryData, city.projection, S) }); // 地形先建，世界裡的東西才能放在坡面上；左鎮、龍崎的惡地改成青灰色
  D.heightAt = terrain.heightAt;
  const world = buildWorld(THREE, scene, D, kit, buildModel, tree);
  const layers = createLayers({ islands: D.islands, minorBuildings: settings.minorBuildings, world, S }); // 拉近才長出來的分層建築
  const infra = buildInfrastructure(THREE, scene, world, kit, D, buildModel); // 一定在 kit.build 之前
  world.stationsIn = infra.stationsIn; // people.js 透過 world 查車站
  const stats = kit.build(scene);
  const fx = createEvents(THREE, scene, world, eventData.events, mulberry(2026), S); // 先登記障礙物，行人才會避開
  const eventsById = new Map(fx.events.map((e) => [e.id, e]));
  const people = createPeople(THREE, scene, D, world, CSS2DObject);
  const audio = createAudio();
  const trains = createTrains(THREE, scene, infra.services, terrain.heightAt, audio.trainHorn, { speed: 4.4 * S }); // 地圖放大 S 倍，行駛時間不變
  // 高鐵：兩列 8 節對開，只停高鐵台南站，跑在高架橋面上；開出地圖就隱藏、折返時再出現
  const hsrService = { id: "hsr", name: "台灣高鐵", color: "#e58a3c", cars: 8, trains: 2, points: hsrData.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), stops: hsrData.stops };
  const hsr = createTrains(THREE, scene, [hsrService], terrain.heightAt, null, { style: "hsr", speed: 11 * S, deckY: TOP + 0.45, bounds: city.bounds, carGap: 0.86, startStop: 1 });
  // 六色公車：幹線一開始就載入，支線在側欄打開該顏色時才載入；時鐘在「現在」時改用 TDX 即時位置（見 bus.js）
  const buses = createBuses(THREE, scene, busData, { heightAt: terrain.heightAt, projection: city.projection, loadBranches: () => loadJson("./data/bus_branches.json"), scale: S, onChange: () => busChanged() });
  const trails = createTrails(THREE, scene, trailData, terrain.heightAt, S); // 山海圳綠道與自行車道的虛線＋騎士
  const trailsById = new Map(trailData.trails.map((tr) => [tr.id, tr]));
  const sugar = createSugarRail(THREE, scene, sugarData, terrain.heightAt, S);
  // 高速公路與快速道路：路面依地形、橋段架高，車沿路段鏈開、偶爾上下匝道（highways.js）
  const highways = createHighways(THREE, scene, hwData, { heightAt: terrain.heightAt, CSS2DObject, scale: S, unitsPerKm: city.unitsPerKm, quality, lang: i18n.lang, rnd: mulberry(2028) });
  world.setRoads(highways.segments()); // 行人散步不停在公路上 // 烏樹林糖廠五分車：窄軌與一列觀光小火車
  const heat = createHeatmap(THREE, scene, B, world.groundY, S, 1.5); // 行人是 1 倍地圖的 1.5 倍 // 人流熱度圖（「熱度」開關）
  const fields = createFields(THREE, scene, city, cropsData, world.groundY); // 郊區田地，顏色隨作物產季與日期變化
  let treeReady = false; // renderTree 第一次畫完之後，水庫資料到了才重畫側欄（避免用到還沒宣告的變數）
  // 水庫 ↔ 建築／景點（reservoir.js 的 ANCHORS）：rsvAnchor 水庫名 → { type, id, merged }；rsvOf "building:<id>" → 水庫名
  // merged：建築跟水庫同名（壩、烏山頭景點），蓄水率小牌掛在建築上方，取代建築自己的名牌
  const rsvAnchor = new Map(), rsvOf = new Map();
  for (const [name, a] of Object.entries(ANCHORS)) {
    const id = a.type === "poi" ? (world.poiById.has(a.id) ? a.id : null) : [...buildings.values()].find((b) => (b.name_zh ?? b.name) === a.name)?.id;
    if (!id) continue;
    const zhName = a.type === "poi" ? (world.poiById.get(id).name_zh ?? world.poiById.get(id).name) : a.name;
    rsvAnchor.set(name, { type: a.type, id, merged: zhName === name });
    rsvOf.set(`${a.type}:${id}`, name);
  }
  const anchorPos = (a) => (a.type === "poi" ? world.poiById.get(a.id)?.pos : world.buildingPos.get(a.id));
  const reservoirs = createReservoirs(THREE, scene, D.water.lakes, world.heightAt, { CSS2DObject, onLand: world.onLand, shortName: (n) => t(`reservoir.short.${n}`, n.replace(/水庫$/, "")),
    labelAt: (name) => { const a = rsvAnchor.get(name); return a?.merged ? anchorPos(a) ?? null : null; },
    onChange: () => {
      if (!treeReady) return;
      renderTree($("#search").value);
      if (card.hidden) return;
      if (selected?.type === "reservoir") cardContent.innerHTML = reservoirCard(selected.id);
      for (const el of $$("#card [data-rsv-section]")) el.outerHTML = reservoirSection(el.dataset.rsvSection); // 建築卡片裡的蓄水段落
    } });
  // 山海景觀（scenery.js）：雲海、惡地、溫泉煙、山頂、星空、果園、魚塭、潟湖、綠色隧道、曬麵、菱角田、乳牛。anchor 是附近的地標（用原文比對）
  const buildingIdOf = ([dn, bn]) => { const isl = D.islands.find((x) => (x.name_zh ?? x.name) === dn); return isl?.buildings.find((x) => (x.name_zh ?? x.name) === bn)?.id ?? null; };
  const sceneryAnchor = (a) => (!a ? null : a.poi ? (world.poiById.has(a.poi) ? { type: "poi", id: a.poi } : null) : (buildingIdOf(a.building) ? { type: "building", id: buildingIdOf(a.building) } : null));
  const scenery = createScenery(THREE, scene, world, sceneryData, { projection: city.projection, quality, scale: S,
    anchorPos: (a) => { const k = sceneryAnchor(a); return !k ? null : k.type === "poi" ? world.poiById.get(k.id).pos : world.buildingPos.get(k.id); },
    fields: city.districts.flatMap((d) => d.fields || []), fieldsApi: fields, tracks: [...rail.lines.map((l) => l.points), hsrData.points, ...highways.segments()], lakes: D.water.lakes, rivers: D.water.rivers || [], districts: city.districts.map((d) => ({ id: d.id, name: d.name, hub: d.hub, polygon: d.polygon })), loadBusBranches: () => loadJson("./data/bus_branches.json") });
  // 集章：37 區各一個代表地標，集滿放 10 秒煙火
  const stamps = createStamps({ t, data: stampsData, islands, esc, toast: (m) => toast(m), onPickDistrict: (id) => select({ type: "island", id }), onComplete: () => celebrate() });
  // 「🎮 玩」選單：工具列只留一顆鈕，集章、猜產地、找阿明、美食圖鑑、拍照都收進下拉選單（手機工具列放不下）
  const gameBtn = Object.assign(document.createElement("button"), { id: "play-btn", type: "button", textContent: t("play.btn", "🎮 玩") });
  gameBtn.setAttribute("aria-haspopup", "menu"); gameBtn.setAttribute("aria-expanded", "false"); gameBtn.setAttribute("aria-controls", "play-menu");
  const gameMenu = Object.assign(document.createElement("div"), { id: "play-menu", className: "play-menu", hidden: true });
  gameMenu.setAttribute("role", "menu");
  $(".toolbar").insertBefore(gameBtn, $("#sidebar-toggle"));
  $(".toolbar").insertBefore(gameMenu, $("#sidebar-toggle"));
  const setGameMenu = (open) => { gameMenu.hidden = !open; gameBtn.setAttribute("aria-expanded", String(open)); };
  gameBtn.addEventListener("click", (e) => { e.stopPropagation(); setGameMenu(gameMenu.hidden); });
  gameMenu.addEventListener("click", (e) => { if (e.target.closest("button")) { setGameMenu(false); for (const p of $$(".stamps")) p.hidden = true; } }, true); // 捕獲階段：先收起選單與所有面板，按鈕自己的處理再打開它的面板
  document.addEventListener("click", (e) => { if (!gameMenu.hidden && !e.target.closest("#play-menu,#play-btn")) setGameMenu(false); });
  stamps.mount(gameMenu, $("#app"));
  // 農特產：點特產亮產地、「當季」開關、猜產地小遊戲
  const specs = createSpecs({ THREE, scene, CSS2DObject, specData, seasons: seasonsData, centers: world.centers, groundY: world.groundY, scale: S, t, esc });
  // 把一組區框進畫面：取中心點與最遠距離，從東南上方看過去
  function flyToDistricts(ids) {
    const cs = ids.map((id) => world.centers.get(id)).filter(Boolean);
    if (!cs.length) return;
    const c = cs.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / cs.length);
    const r = Math.max(4 * S, ...cs.map((p) => Math.hypot(p.x - c.x, p.z - c.z)));
    c.y = world.groundY(c.x, c.z);
    flyTo(c.clone().add(new THREE.Vector3(0, 5 * S + r * 1.5, 6 * S + r * 1.7)), c);
  }
  const quiz = createQuiz({ t, esc, specs, islands, toast: (m) => toast(m), onReveal: (key) => { specs.highlight(key); flyToDistricts(specs.districtsOf(key)); },
    onStart: () => { stamps.setOpen(false); select(null); flyTo(HOME.pos, HOME.target); }, onPerfect: () => celebrate(t("quiz.perfect", "全對！台南農產達人 🎆")) });
  quiz.mount(gameMenu, $("#app"));
  // 吃遍台南：小吃綁在建築（區名＋建築名，用原文比對）或景點上
  const food = createFood({ t, esc, data: foodData, islands, toast: (m) => toast(m),
    keyOf: (it) => {
      if (it.at.poi) return world.poiById?.get(it.at.poi) ? `poi:${it.at.poi}` : null;
      const [dn, bn] = it.at.building, isl = D.islands.find((x) => (x.name_zh ?? x.name) === dn), b = isl?.buildings.find((x) => (x.name_zh ?? x.name) === bn);
      return b ? `building:${b.id}` : null;
    },
    onComplete: () => celebrate(t("food.complete", "吃遍台南！全部小吃都吃到了 🎆")),
    onPick: (it) => { if (!it) return; const [type, id] = [it.key.slice(0, it.key.indexOf(":")), it.key.slice(it.key.indexOf(":") + 1)]; select({ type, id }); } });
  food.button(gameMenu);
  // 找找阿明：每天一區；放棄時鏡頭飛過去
  const ming = createFindMing({ THREE, scene, world, islands, specData, t, esc, toast: (m) => toast(m),
    onGiveUp: (p) => flyTo(p.clone().add(new THREE.Vector3(0.8, 1.6, 2.2)), p.clone().setY(p.y + 0.3)),
    onFound: () => guide.say(t("guide.ming_found", "找到阿明了！他明天會換一區躲，記得回來。"), { force: true }) });
  ming.button(gameMenu);
  // 找獼猴：山區 10 群台灣獼猴，點到就收集
  const monkeys = createMonkeys({ THREE, scene, world, data: sceneryData.monkeys, projection: city.projection, scale: S, t, esc, islands, toast: (m) => toast(m),
    onComplete: () => celebrate(t("monkey.complete", "10 群台灣獼猴全部找到了！🎆")) });
  monkeys.button(gameMenu);
  // 拍照模式：收起介面，濾鏡＋相框＋浮水印，下載 PNG
  const photo = createPhoto({ t, esc, canvas: renderer.domElement, renderNow: () => renderer.render(scene, camera), toast: (m) => toast(m),
    placeName: () => { const tg = controls.target, id = world.districtAt(tg.x, tg.z); return selectedName() || (id ? islands.get(id)?.name : ""); },
    dateText: () => `${fmtDate(calDate)} ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute % 60)).padStart(2, "0")}`,
    onEnter: () => { setGameMenu(false); if (typeof tour !== "undefined" && tour.on) tour.end(); requestAnimationFrame(resize); }, onExit: () => requestAnimationFrame(resize) }); // 側欄收起後畫布變寬，重算尺寸
  photo.button(gameMenu);
  // 一日行程：卡片「加入行程」→ 右下角面板排序、播放、分享連結
  const districtNameOf = (id) => islands.get(id)?.name || "";
  const resolveTrip = (u) => {
    if (!u) return null;
    if (u.type === "building") { const b = buildings.get(u.id), p = world.buildingPos.get(u.id); return b && p ? { name: b.name, pos: p, districtName: districtNameOf(b.island) } : null; }
    if (u.type === "poi") { const p = pois.get(u.id); return p ? { name: p.name, pos: p.pos, districtName: districtNameOf(p.district) } : null; }
    if (u.type === "station") { const s = stations.get(u.id); return s ? { name: s.name, pos: s.pos, districtName: districtNameOf(s.district) } : null; }
    if (u.type === "event") { const e = eventsById.get(u.id); return e ? { name: e.name, pos: e.focus || e.pos, districtName: districtNameOf(e.district) } : null; }
    if (u.type === "island") { const isl = islands.get(u.id), c = world.centers.get(u.id); return isl && c ? { name: isl.name, pos: c, districtName: isl.name } : null; }
    return null;
  };
  // 劍獅小嚮導（左下角）：開了「朗讀」就一起唸
  const guide = createGuide({ t, esc, speak: (s) => { if (typeof toggles !== "undefined" && toggles.speech) speech.speakText(s); } });
  guide.mount($("#app"));
  const trip = createTrip({ t, resolve: resolveTrip, flyTo: (a, b) => flyTo(a, b), select: (u) => select(u), toast: (m) => toast(m), k: city.projection.k,
    onChange: (list) => { const q = new URLSearchParams(location.search); if (list.length) q.set("trip", list.map((u) => `${u.type}:${u.id}`).join(",")); else q.delete("trip"); history.replaceState(null, "", `${location.pathname}?${q}`); } });
  trip.mount($("#app"));
  const tripBtn = (type, id) => `<button class="chip act" data-trip-add="${esc(type)}:${esc(id)}">${esc(t("trip.add", "加入行程"))}</button>`;
  const talk = createTalk({ t, islands, specialties: specData, pois: world.pois, roles, adjacency: world.adjacency, rnd: mulberry(7), data: talkData }); // 市民對話：三句泡泡
  // 我的圖釘：圖釘卡片可存成自己的圖釘並寫一行筆記，存在瀏覽器，可用 ?pins= 分享
  const myPins = createMyPins(THREE, scene, { groundY: world.groundY, toLonLat: world.toLonLat, districtAt: world.districtAt, scale: S, onChange: () => renderTree($("#search").value) });
  function selectedName() {
    if (!selected) return "";
    const u = selected;
    if (u.type === "island") return islands.get(u.id)?.name || "";
    if (u.type === "building") return buildings.get(u.id)?.name || "";
    if (u.type === "poi") return pois.get(u.id)?.name || "";
    if (u.type === "event") return eventsById.get(u.id)?.name || "";
    if (u.type === "station") return stations.get(u.id)?.name || "";
    return "";
  }
  function celebrate(msg = t("stamps.complete", "37 區全部集滿！放煙火慶祝 🎆")) {
    const ids = ["anping-ny", "luermen", "beehive"].filter((id) => eventsById.has(id));
    for (const id of ids) fx.setActive(id, true, 0);
    toast(msg);
    setTimeout(() => { for (const id of ids) applyEvent(eventsById.get(id), calDate); }, 10000);
  } // 六座水庫的水面依蓄水率縮放（/api/reservoir，失敗用備援檔）
  const WEATHER_KEY = { 雷雨: "weather.thunder", 小雨: "weather.light_rain", 雨: "weather.rain", 雪: "weather.snow", 霧: "weather.fog", 陰: "weather.overcast", 多雲: "weather.cloudy", 晴: "weather.clear", 天氣資料暫時無法取得: "weather.unavailable" };
  const weather = createWeather(THREE, scene, env, { bounds: B, scale: S, onChange: (w) => people.setRain?.(w.rain), translate: (zh) => t(WEATHER_KEY[zh] || zh, zh) }); // 即時天氣：雲量壓暗陽光、下雨飄雨絲、行人撐傘
  let activeKinds = []; // 目前可見的活動效果種類，給聲音層
  const stations = new Map(infra.stations.map((s) => [s.id, s]));
  window.hexcity = { look: (x, z, d = 3) => { const p = new THREE.Vector3(x, world.groundY(x, z), z); flyTo(p.clone().add(new THREE.Vector3(d * 0.4, d * 0.8, d)), p); }, minor: () => Object.fromEntries(Object.entries(layers.snapshot()).map(([id, k]) => [buildings.get(id)?.name, +k.toFixed(2)])), select: (u) => select(u), walker: (i) => people.info(i), ming: () => ming, quality: () => quality, fps: () => fpsNow, trains, hsr, buses, highways, trails, sugar, terrain, stations: infra.stations.map((s) => ({ id: s.id, x: +s.pos.x.toFixed(2), z: +s.pos.z.toFixed(2) })) }; // 除錯用
  const lineOf = (id) => infra.lines.filter((l) => l.stations.includes(id)).map((l) => l.name).join(t("list.separator", "、"));
  const pois = new Map(world.pois.map((p) => [p.id, p]));
  const POI_TYPE = { attraction: [t("poi.type.attraction", "景點"), "🏯"], nightmarket: [t("poi.type.nightmarket", "夜市"), "🏮"], sciencepark: [t("poi.type.sciencepark", "科學園區"), "🏭"] };
  const DAY = ["日", "一", "二", "三", "四", "五", "六"], weekdayName = (d) => t(`weekday.${d}`, DAY[d]);
  const sep = t("list.separator", "、");
  const lunarText = (d) => { const l = lunarOf(d); return t("lunar.label", "農曆{month}月{day}日", { month: (l.leap ? t("lunar.leap", "閏") : "") + l.month, day: l.day }); };
  const fmtRangeT = (o) => (o.start.getTime() === o.end.getTime() ? fmtDate(o.start) : t("fmt.range", "{from} 到 {to}", { from: fmtDate(o.start), to: fmtDate(o.end) })) + (o.label ? t("fmt.range_label", "（{label}）", { label: o.label }) : "");
  console.log(`[hex-city] ${stats.parts} parts in ${stats.kinds} instanced meshes, ${people.count} walkers (${people.instances} instances), ${infra.stations.length} stations, ${trains.count} trains, ${hsr.count} hsr, ${buses.count} buses, ${trails.count} riders, terrain ${terrain.triangles} tris, ${world.pois.length} pois, ${fx.events.length} events (today=${D.today})`);

  const flowLines = new Map();
  for (const f of D.flows) {
    const pts = world.route(f.from, f.to).map((p) => p.clone().setY(p.y + 0.07));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: f.carry, transparent: true, opacity: 0.9 }),
    );
    line.visible = false;
    scene.add(line);
    flowLines.set(f.id, line);
  }

  // 被點選的行人目前的路線
  const walkerLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x211d1d, transparent: true, opacity: 0.8 }));
  walkerLine.visible = false;
  scene.add(walkerLine);
  function showWalkerPath(pts) {
    walkerLine.geometry.dispose();
    walkerLine.geometry = new THREE.BufferGeometry().setFromPoints(pts.map((p) => p.clone().setY(p.y + 0.05)));
    walkerLine.visible = true;
  }

  // 名牌防重疊用：區名、車站、活動是「一定顯示」的障礙物；景點與建築名牌重疊時依重要度藏起來（見 declutter）
  const fixedLabels = [...reservoirs.labels()], poiLabels = []; // 水庫蓄水率小牌也當障礙物
  for (const e of fx.events) {
    const el = document.createElement("button");
    el.className = "event-label";
    el.dataset.event = e.id;
    el.textContent = `🎆 ${e.name}`;
    const o = new CSS2DObject(el);
    o.position.set(e.pos.x, e.pos.y + 1.45, e.pos.z);
    scene.add(o);
    fixedLabels.push(o);
  }

  const mergedLabel = (type, id) => rsvAnchor.get(rsvOf.get(`${type}:${id}`))?.merged; // 名牌由水庫小牌代替
  for (const p of world.pois) {
    if (mergedLabel("poi", p.id)) continue;
    const el = document.createElement("button");
    el.className = `poi-label ${p.type}` + (p.open ? "" : " closed");
    el.dataset.poi = p.id;
    el.textContent = `${POI_TYPE[p.type][1]} ${p.name}`;
    const o = new CSS2DObject(el);
    o.position.set(p.pos.x, p.pos.y + 1.1, p.pos.z);
    scene.add(o);
    poiLabels.push(o);
  }

  // 建築名稱標籤：每棟一個，「建築名」開關控制；拉遠（lod-far）時由 CSS 隱藏避免重疊
  const buildingLabels = []; // 只顯示鏡頭焦點附近的建築名牌（見 cullBuildingLabels），221 個全開會拖慢手機
  for (const [id, b] of buildings) {
    const p = world.buildingPos.get(id);
    if (!p || mergedLabel("building", id)) continue;
    const el = document.createElement("button");
    el.className = "building-label";
    el.dataset.building = id;
    el.textContent = b.name;
    const o = new CSS2DObject(el);
    o.position.set(p.x, p.y + 1.0, p.z);
    o.visible = false;
    scene.add(o);
    buildingLabels.push(o);
  }

  for (const s of infra.stations) {
    const el = document.createElement("button");
    el.className = "station-label" + (s.kind === "hsr" ? " hsr" : "");
    el.dataset.station = s.id;
    el.textContent = s.name;
    const o = new CSS2DObject(el);
    o.position.set(s.pos.x, TOP + 0.95, s.pos.z);
    scene.add(o);
    fixedLabels.push(o);
  }

  for (const isl of D.islands) {
    const el = document.createElement("button");
    el.className = "island-label";
    el.dataset.id = isl.id;
    el.style.setProperty("--c", isl.color);
    el.innerHTML = `<i></i>${isl.number} ${esc(isl.name)}`;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      select({ type: "island", id: isl.id });
    });
    const o = new CSS2DObject(el);
    const c = world.centers.get(isl.id);
    o.position.set(c.x, world.groundY(c.x, c.z) + 1.7, c.z);
    scene.add(o);
    fixedLabels.unshift(o); // 區名最優先
  }

  // ── 跟隨：相機每幀跟著行人或火車，拖曳即解除 ──
  let follow = null; // { kind: "walker"|"train"|"bus", id, offset: Vector3 }
  const followPos = (kind, id) => (kind === "walker" ? people.info(id)?.pos : kind === "bus" ? busPos(id) : kind === "hsr" ? hsrPos(id) : kind === "car" ? highways.carPos(id) : trainPos(id));
  function startFollow(kind, id) {
    const p = followPos(kind, id);
    if (!p) return;
    const offset = new THREE.Vector3(1.4, kind === "train" ? 2.6 : kind === "hsr" ? 3.0 : kind === "bus" ? 2.2 : 1.8, kind === "train" ? 4.0 : kind === "hsr" ? 5.0 : kind === "bus" ? 3.4 : 2.6);
    follow = { kind, id, offset };
    goal = null;
    toast(kind === "walker" ? t("toast.follow_walker", "跟著這個人走，拖曳畫面可解除") : kind === "bus" ? t("toast.follow_bus", "跟著公車跑，拖曳畫面可解除") : kind === "car" ? t("toast.follow_car", "跟著這台車跑，拖曳畫面可解除") : t("toast.follow_train", "跟著火車跑，拖曳畫面可解除"));
  }
  const trainPos = (i) => { const s = trains.state()[i]; return s ? new THREE.Vector3(s.x, world.groundY(s.x, s.z) + 0.2, s.z) : null; };
  const hsrPos = (i) => { const s = hsr.state()[i]; return s && s.visible ? new THREE.Vector3(s.x, TOP + 0.6, s.z) : null; };
  const busPos = (i) => { const s = buses.state()[i]; return s && s.visible ? new THREE.Vector3(s.x, world.groundY(s.x, s.z) + 0.2, s.z) : null; };
  function updateFollow() {
    if (!follow) return;
    const p = followPos(follow.kind, follow.id);
    if (!p) { follow = null; return; }
    controls.target.lerp(p, 0.15);
    camera.position.lerp(p.clone().add(follow.offset), 0.08);
  }

  // ── 相機移動 ──
  let goal = null;
  const flyTo = (pos, target) => (goal = { pos: pos.clone(), target: target.clone() });
  // 市區模型被縮小過：鏡頭依比例飛得更近（最多近到 0.6 倍），畫面上看起來和郊區的建築差不多大
  const closeK = (key, base) => Math.max(0.6, Math.min(1, (world.scaleOf(key) ?? base) / base));
  function animateCamera() {
    if (!goal) return;
    camera.position.lerp(goal.pos, 0.08);
    controls.target.lerp(goal.target, 0.08);
    if (camera.position.distanceTo(goal.pos) < 0.02) goal = null;
  }
  // 只有真的拖曳（超過 6px）或滾輪才算手動操作：取消飛行、暫停導覽；單純點一下不算
  let dragFrom = null;
  // ── 第一人稱搭車：鏡頭掛在車頭往前看，拖曳畫面或 Esc 下車 ──
  const rideEl = $("#ride"), rideText = $("#ride-text");
  let ride = null; // { kind: "train"|"bus"|"sugar", i, last: Vector3, fwd: Vector3 }
  const vehiclePos = (kind, i) => (kind === "train" ? trainPos(i) : kind === "hsr" ? hsrPos(i) : kind === "bus" ? busPos(i) : (() => { const s = sugar.state()[0]; return s && s.visible ? new THREE.Vector3(s.x, world.groundY(s.x, s.z) + 0.2, s.z) : null; })());
  const vehicleCount = (kind) => (kind === "train" ? trains.count : kind === "hsr" ? hsr.count : kind === "bus" ? buses.count : 1);
  const vehicleName = (kind, i) => (kind === "train" ? t("tree.train_n", "列車 {n}", { n: i + 1 }) : kind === "hsr" ? t("tree.hsr_n", "高鐵 {n}", { n: i + 1 }) : kind === "bus" ? buses.info(i)?.name ?? "" : sugarData.lines[0].name);
  function nextStopName(kind, i) {
    if (kind === "bus") return buses.info(i)?.nextStop ?? "";
    if (kind === "hsr") { // 停靠點：北端、高鐵台南、南端
      const s = hsr.state()[i];
      if (!s) return "";
      const idx = Math.max(0, Math.min(2, s.stop + (s.wait > 0 ? 0 : s.dir)));
      return [t("hsr.north", "嘉義・台北方向"), stations.get(hsrData.station)?.name ?? "", t("hsr.south", "左營方向")][idx];
    }
    if (kind === "sugar") { const s = sugar.state()[0], st = sugarData.lines[0].stops; return s ? (s.dir > 0 ? st[st.length - 1].name : st[0].name) : ""; }
    const s = trains.state()[i], ids = infra.services[0]?.stations || [];
    if (!s) return "";
    const idx = Math.max(0, Math.min(ids.length - 1, s.stop + (s.wait > 0 ? 0 : s.dir)));
    return stations.get(ids[idx])?.name ?? "";
  }
  function startRide(kind, i = 0) {
    const p = vehiclePos(kind, i);
    if (!p) { toast(t("ride.closed", "這班車現在收班中，換個時間再上車")); return; }
    follow = null; goal = null;
    ride = { kind, i, last: p.clone(), fwd: new THREE.Vector3(0, 0, 1) };
    rideEl.hidden = false;
    labelRenderer.domElement.classList.add("riding"); // 搭車時只留車站標籤，地平線才不會被名牌塞滿
    setSidebar(false);
    toast(t("toast.ride_on", "已上車：← → 換車，拖曳畫面或 Esc 下車"));
  }
  function endRide(silent = false) { if (!ride) return; ride = null; rideEl.hidden = true; labelRenderer.domElement.classList.remove("riding"); if (!silent) toast(t("toast.ride_off", "已下車")); }
  function updateRide() {
    if (!ride) return;
    const p = vehiclePos(ride.kind, ride.i);
    if (!p) { endRide(); return; }
    const d = p.clone().sub(ride.last);
    if (d.length() > 0.002) ride.fwd.copy(d.setY(0).normalize());
    ride.last.copy(p);
    const eye = p.clone().add(new THREE.Vector3(0, 0.3, 0)).addScaledVector(ride.fwd, -0.1);
    const look = p.clone().add(new THREE.Vector3(0, 0.12, 0)).addScaledVector(ride.fwd, 4);
    camera.position.lerp(eye, 0.3);
    controls.target.lerp(look, 0.3);
    const txt = `${vehicleName(ride.kind, ride.i)} · ${t("ride.next", "下一站 {stop}", { stop: nextStopName(ride.kind, ride.i) })}`;
    if (rideText.textContent !== txt) rideText.textContent = txt;
  }
  $("#ride-exit").addEventListener("click", () => endRide());
  $("#ride-prev").addEventListener("click", () => { if (ride) startRide(ride.kind, (ride.i - 1 + vehicleCount(ride.kind)) % vehicleCount(ride.kind)); });
  $("#ride-next").addEventListener("click", () => { if (ride) startRide(ride.kind, (ride.i + 1) % vehicleCount(ride.kind)); });
  document.addEventListener("keydown", (e) => { if (!ride || e.target.matches?.("input,textarea")) return; if (e.key === "ArrowLeft") $("#ride-prev").click(); else if (e.key === "ArrowRight") $("#ride-next").click(); });
  const manualCamera = () => { goal = null; if (follow) { follow = null; toast(t("toast.follow_stop", "已停止跟隨")); } if (ride) endRide(); if (typeof trip !== "undefined") trip.stop(); if (typeof tour !== "undefined" && tour.on) tour.setPaused(true); };
  renderer.domElement.addEventListener("pointerdown", (e) => (dragFrom = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener("pointermove", (e) => { if (dragFrom && Math.hypot(e.clientX - dragFrom[0], e.clientY - dragFrom[1]) > 6) { dragFrom = null; manualCamera(); } });
  renderer.domElement.addEventListener("pointerup", () => (dragFrom = null));
  renderer.domElement.addEventListener("wheel", manualCamera, { passive: true });

  // ── 點選 ──
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    down = null;
    if (innerWidth <= 800 && $("#sidebar").classList.contains("open")) { setSidebar(false); return; } // 手機版：側欄開著時點地圖先收側欄
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([...(ming.visible ? ming.pickables : []), ...monkeys.pickables, ...scenery.pickables, ...people.pickables, ...fx.pickables, ...buses.pickables, ...highways.pickables, ...trails.pickables, ...sugar.pickables, ...reservoirs.pickables, ...fields.pickables, ...myPins.pickables(), ...world.pickables.filter((o) => !o.userData.hidden)], false)[0];
    if (!hit) select(null);
    else if (hit.object.userData.type === "ming") ming.found();
    else if (hit.object.userData.type === "walkerMesh") select(people.walkerAt(hit.object, hit.instanceId));
    else if (hit.object.userData.type === "field") select(fields.fieldAt(hit.instanceId)); // 田：用 instanceId 查回區與作物
    else if (hit.object.userData.type === "island") select({ type: "spot", id: hit.object.userData.id, x: hit.point.x, z: hit.point.z }); // 點地面：放圖釘
    else if (hit.object.userData.type === "trail") select({ ...hit.object.userData, x: hit.point.x, z: hit.point.z }); // 步道：帶點到的位置飛過去
    else if (hit.object.userData.type === "sugar") select({ ...hit.object.userData, id: hit.object.userData.line });
    else if (hit.object.userData.type === "reservoir") select({ ...hit.object.userData, id: hit.object.userData.name, x: hit.point.x, z: hit.point.z });
    else if (hit.object.userData.type === "bus" || hit.object.userData.type === "busstop") select(buses.pick(hit));
    else if (hit.object.userData.type === "highway" || hit.object.userData.type === "car") select(highways.pick(hit)); // 路面與車都是 InstancedMesh
    else if (hit.object.userData.type === "monkey") { monkeys.found(hit.object.userData.id); select({ type: "monkey", id: hit.object.userData.id }); } // 公車與站牌是 InstancedMesh，用 instanceId 查回是哪一台／哪一站
    else select(hit.object.userData);
  });
  // 雙擊：直接拉到近景（建築、景點、車站、地面任一點）
  renderer.domElement.addEventListener("dblclick", (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects([...fx.pickables, ...world.pickables.filter((o) => !o.userData.hidden)], false)[0];
    if (!hit) return;
    const p = hit.point.clone();
    flyTo(p.clone().add(new THREE.Vector3(0.6, 1.6, 2.2)), p.clone().setY(p.y + 0.3));
  });

  // ── 選取與卡片 ──
  const card = $("#card"), cardContent = $("#card-content");
  let selected = null;
  // 各種卡片的 HTML 在 cards.js；calDate、minute 在後面才宣告，用 now() 延後讀
  const { islandBtn, islandCard, buildingCard, pinCard, myPinCard, walkerStatus, stationCard, eventCard, routeName, busModeLine, busCard, highwayCard, carCard, busRouteCard, sceneryStatus, sceneryCard, monkeyCard, sceneryChips, busStopCard, busStatus, trailCard, sugarCard, reservoirCard, reservoirSection, fieldCard, poiCard, walkerCard } = createCards({
    t, esc, sep, i18n, zh, city, world, infra, people, fx, fields, buses, scenery, monkeys, reservoirs, weather, talk, islands, buildings, pois, stations, flows, roles, mapLinks, agesData, sceneryData, rsvOf, POI_TYPE, flowsOf, roleLabel, specOf, specTags, lineOf, fmtRangeT, weekdayName, tripBtn, sceneryAnchor, buildingIdOf,
    now: () => ({ calDate, minute }),
  });
  let pin = null; // 圖釘：點地面任意處，顯示所在區與最近的地標
  function placePin(x, z) {
    if (!pin) {
      pin = new THREE.Group();
      const m1 = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 10), new THREE.MeshStandardMaterial({ color: 0xdb6a41 }));
      m1.rotation.x = Math.PI; m1.position.y = 0.2;
      const m2 = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshStandardMaterial({ color: 0xdb6a41 }));
      m2.position.y = 0.5;
      pin.add(m1, m2); pin.visible = false; scene.add(pin);
    }
    pin.position.set(x, world.groundY(x, z), z);
    pin.visible = true;
  }
  // 被點選的行人：每 0.5 秒刷新狀態與路線，其他文字不重畫
  let liveKey = "", liveAt = 0;
  function refreshWalkerCard(now) {
    if (card.hidden || now - liveAt < 0.5) return;
    if (selected?.type === "scenery") { // 景觀卡片：今天有沒有雲海、是不是產季……跟著時間更新
      liveAt = now;
      const it = scenery.info(selected.id), st = it ? sceneryStatus(it) : "", el = $("#card h2 small");
      if (st && el && el.textContent !== st) el.textContent = st;
      return;
    }
    if (selected?.type === "bus") { // 公車卡片：方向與下一站即時更新
      liveAt = now;
      const b = buses.info(selected.id), key = b ? `${b.heading}|${b.nextStop}|${b.visible}|${b.live?.gps}` : "";
      if (key === liveKey) return;
      liveKey = key;
      const el = $("#bus-status");
      if (el && b) el.innerHTML = busStatus(b);
      return;
    }
    if (selected?.type !== "walker") return;
    liveAt = now;
    const w = people.info(selected.id);
    if (!w) return;
    const key = `${w.status}|${w.at}|${w.dest}|${w.path.length}`;
    if (key === liveKey) return;
    liveKey = key;
    const el = $("#walker-status");
    if (el) el.innerHTML = walkerStatus(w);
    showWalkerPath(w.path);
  }

  let lastSelectAt = 0, lastSelectKey = "";
  function select(u, { silent = false } = {}) {
    if (u?.type === "reservoir" && rsvAnchor.has(u.id)) { const a = rsvAnchor.get(u.id); return select({ type: a.type, id: a.id }, { silent }); } // 湖面、小牌、側欄都開錨點建築的卡片
    if (u && quiz.active) { // 猜產地進行中：點到的區（地面、區名、建築、景點）就是答案，不開卡片
      const did = u.type === "spot" || u.type === "island" ? u.id : u.type === "building" ? buildings.get(u.id)?.island : u.type === "poi" ? pois.get(u.id)?.district : null;
      if (did && quiz.answer(did)) return;
    }
    const key = u ? `${u.type}:${u.id}` : "";
    const nowMs = performance.now();
    if (key && key === lastSelectKey && nowMs - lastSelectAt < 150) return; // 連點同一個目標不重畫
    lastSelectAt = nowMs; lastSelectKey = key;
    selected = u;
    if (!silent) syncUrl();
    stamps.visit(u); // 集章：點到代表地標就蓋
    highlightSidebar();
    if (u?.type === "event") setPreview(u.id); else if (previewEvent) setPreview(null);
    const activeIsland = u?.type === "island" ? u.id : u?.type === "building" ? buildings.get(u.id)?.island : null;
    $$(".island-label").forEach((el) => el.classList.toggle("active", el.dataset.id === activeIsland));
    updateFlowVisibility();
    if (u?.type !== "walker") walkerLine.visible = false;
    if (!u || !["bus", "busroute", "busstop"].includes(u.type)) buses.highlight(null);
    if (u?.type !== "spot" && pin) pin.visible = false;
    if (follow && !(u?.type === "walker" && u.id === follow.id)) follow = null;
    document.body.classList.toggle("has-card", !!u);
    if (!u) {
      card.hidden = true;
      speech.stop();
      return;
    }
    if (u.type === "island") {
      const isl = islands.get(u.id), c = world.centers.get(u.id), r = world.radiusOf(u.id);
      flyTo(c.clone().add(new THREE.Vector3(0, 3 + r * 1.6 + world.heightAt(c.x, c.z), 4 + r * 1.9)), c.clone().setY(world.groundY(c.x, c.z) + 0.2));
      cardContent.innerHTML = islandCard(isl);
    } else if (u.type === "building") {
      const b = buildings.get(u.id), p = world.buildingPos.get(u.id);
      flyTo(p.clone().add(new THREE.Vector3(0.8, 2.4, 3.4).multiplyScalar(closeK("building:" + u.id, 0.75))), p.clone().setY(p.y + 0.5));
      cardContent.innerHTML = buildingCard(b);
    } else if (u.type === "mypin") {
      const p = myPins.get(+u.id);
      if (!p) { select(null); return; }
      const pos = new THREE.Vector3(p.x, world.groundY(p.x, p.z), p.z);
      flyTo(pos.clone().add(new THREE.Vector3(1.2, 2.2, 3.0)), pos.clone().setY(pos.y + 0.3));
      cardContent.innerHTML = myPinCard(p);
    } else if (u.type === "spot") {
      if (!Number.isFinite(u.x) || !Number.isFinite(u.z)) { select(islands.has(u.id) ? { type: "island", id: u.id } : null, { silent }); return; } // 沒有座標的圖釘：改開那一區
      placePin(u.x, u.z);
      cardContent.innerHTML = pinCard(u);
    } else if (u.type === "event") {
      const e = eventsById.get(u.id);
      const fp = e.focus || e.pos;
      flyTo(fp.clone().add(new THREE.Vector3(2.2, 3.2, 4.0)), fp.clone().setY(fp.y + 0.5));
      cardContent.innerHTML = eventCard(e);
    } else if (u.type === "spec") {
      if (!specs.info(u.id)) { select(null); return; }
      if (specs.current !== u.id) specs.highlight(u.id);
      flyToDistricts(specs.districtsOf(u.id));
      cardContent.innerHTML = specs.cardHtml(u.id, specMonth, islandBtn);
    } else if (u.type === "poi") {
      const p = pois.get(u.id);
      flyTo(p.pos.clone().add(new THREE.Vector3(1.6, 2.8, 3.4).multiplyScalar(closeK("poi:" + u.id, 0.8))), p.pos.clone().setY(p.pos.y + 0.4));
      cardContent.innerHTML = poiCard(p);
    } else if (u.type === "station") {
      const s = stations.get(u.id);
      flyTo(s.pos.clone().add(new THREE.Vector3(1.6, 2.8, 3.4)), s.pos.clone().setY(s.pos.y + 0.4));
      cardContent.innerHTML = stationCard(s);
    } else if (u.type === "walker") {
      const w = people.info(u.id);
      if (w) {
        flyTo(w.pos.clone().add(new THREE.Vector3(1.2, 2.2, 3.0)), w.pos.clone().setY(w.pos.y + 0.4));
        showWalkerPath(w.path);
      }
      cardContent.innerHTML = walkerCard(u);
      liveKey = "";
    } else if (u.type === "bus") {
      const b = buses.info(u.id);
      if (b) { flyTo(b.pos.clone().add(new THREE.Vector3(1.2, 2.2, 3.0)), b.pos.clone().setY(b.pos.y + 0.3)); buses.highlight(b.line); }
      cardContent.innerHTML = busCard(b);
      liveKey = "";
    } else if (u.type === "busroute") {
      cardContent.innerHTML = `<p class='muted'>${esc(t("bus.loading", "載入路線中…"))}</p>`;
      buses.highlight(u.id).then(() => { // 支線可能要先載入
        if (selected !== u) return;
        const c = buses.routeCenter(u.id);
        if (c) flyTo(c.center.clone().add(new THREE.Vector3(0, 4 + c.radius * 1.4, 4 + c.radius * 1.6)), c.center);
        cardContent.innerHTML = busRouteCard(u.id);
      });
    } else if (u.type === "highway") {
      const r = highways.routeInfo(u.id);
      if (r) flyTo(r.center.clone().add(new THREE.Vector3(0, 4 * S + r.radius * 1.2, 4 * S + r.radius * 1.4)), r.center);
      cardContent.innerHTML = highwayCard(r);
    } else if (u.type === "car") {
      const c = highways.carInfo(u.id);
      if (c) flyTo(c.pos.clone().add(new THREE.Vector3(1.0, 1.8, 2.4)), c.pos.clone().setY(c.pos.y + 0.1));
      cardContent.innerHTML = carCard(c);
    } else if (u.type === "busstop") {
      const p = buses.stopPos(u.id);
      if (p) flyTo(p.clone().add(new THREE.Vector3(0.5, 1.2, 1.6)), p.clone().setY(p.y + 0.15));
      cardContent.innerHTML = busStopCard(u.id);
    } else if (u.type === "trail") {
      const trail = trailsById.get(u.id);
      if (u.x != null) { const p = new THREE.Vector3(u.x, world.groundY(u.x, u.z) + 0.2, u.z); flyTo(p.clone().add(new THREE.Vector3(1.6, 2.6, 3.2)), p); }
      cardContent.innerHTML = trailCard(trail);
    } else if (u.type === "sugar") {
      const ln = sugarData.lines.find((l) => l.id === u.id) || sugarData.lines[0], st = sugar.state()[0];
      if (st) { const p = new THREE.Vector3(st.x, world.groundY(st.x, st.z) + 0.2, st.z); flyTo(p.clone().add(new THREE.Vector3(1.0, 1.8, 2.4)), p); }
      cardContent.innerHTML = sugarCard(ln, st);
    } else if (u.type === "reservoir") {
      if (u.x == null) { const r = reservoirs.places().find((x) => x.name === u.id); if (r) { u.x = r.x; u.z = r.z; } }
      if (u.x != null) { const p = new THREE.Vector3(u.x, world.groundY(u.x, u.z) + 0.2, u.z); flyTo(p.clone().add(new THREE.Vector3(2.5, 4.0, 5.0)), p); }
      cardContent.innerHTML = reservoirCard(u.id);
    } else if (u.type === "scenery") {
      const c = scenery.center(u.id);
      if (c) flyTo(c.clone().add(new THREE.Vector3(1.6, 2.6, 3.4)), c.clone().setY(c.y + 0.1));
      cardContent.innerHTML = sceneryCard(u.id);
    } else if (u.type === "monkey") {
      const m = monkeys.info(u.id);
      if (m) flyTo(m.pos.clone().add(new THREE.Vector3(0.6, 1.0, 1.5)), m.pos.clone().setY(m.pos.y + 0.2));
      cardContent.innerHTML = monkeyCard(u.id);
    } else if (u.type === "field") {
      const f = fields.fieldAt(+u.id);
      if (!f) { select(null); return; }
      const p = new THREE.Vector3(f.x, world.groundY(f.x, f.z), f.z);
      flyTo(p.clone().add(new THREE.Vector3(1.2, 2.2, 3.0)), p.clone().setY(p.y + 0.2));
      cardContent.innerHTML = fieldCard(f);
    }
    if (u.type === "building" || u.type === "poi") { cardContent.insertAdjacentHTML("beforeend", food.cardHtml(u) + sceneryChips(u)); if (!silent) food.visit(u); } // 這裡可以吃到…、附近景觀
    card.hidden = false;
    card.scrollTop = 0;
    if (toggles.speech) speech.speakCard(cardContent);
    if (!silent) guide.say(guideLine(u));
  }
  // 劍獅說的話：依選取的東西從資料拼一句（區：特產＋地標＋近期活動；活動：倒數；夜市：今天有沒有開；特產：產季）
  const daysUntil = (d) => Math.round((d - calDate) / DAY_MS);
  function nextEventIn(id) {
    let best = null;
    for (const e of fx.events) {
      if (e.district !== id) continue;
      const d = isActive(e.schedule, calDate) ? calDate : nextOccurrence(e.schedule, calDate);
      if (d && (!best || d < best.d)) best = { e, d };
    }
    return best;
  }
  function guideLine(u) {
    if (!u) return "";
    const eat = food.itemsAt(u);
    if (eat.length) return t("guide.food", "這裡可以吃到{list}，{desc}", { list: eat.map((it) => it.name).join(sep), desc: eat[0].desc });
    if (u.type === "island") {
      const isl = islands.get(u.id), sp = specOf(u.id).slice(0, 2).map((x) => x.name), b = isl.buildings[0], ev = nextEventIn(u.id);
      const parts = [sp.length ? t("guide.island_spec", "{name}的{spec}很有名。", { name: isl.name, spec: sp.join(sep) }) : t("guide.island", "歡迎來到{name}！", { name: isl.name })];
      if (b) parts.push(t("guide.island_see", "可以去看看「{b}」。", { b: b.name }));
      if (ev) { const n = daysUntil(ev.d); parts.push(n <= 0 ? t("guide.event_now", "{e}正在舉辦！", { e: ev.e.name }) : n <= 60 ? t("guide.event_soon", "{e}還有 {n} 天。", { e: ev.e.name, n }) : ""); }
      return parts.filter(Boolean).join("");
    }
    if (u.type === "event") {
      const e = eventsById.get(u.id); if (!e) return "";
      if (isActive(e.schedule, calDate)) return t("guide.event_on", "{e}現在就在舉辦，趕快去看！", { e: e.name });
      const d = nextOccurrence(e.schedule, calDate);
      return d ? t("guide.event_wait", "{e}還有 {n} 天，到時候再來。", { e: e.name, n: daysUntil(d) }) : "";
    }
    const rsv = rsvOf.get(`${u.type}:${u.id}`);
    if (rsv) { const lv = reservoirs.levels()[rsv]; if (lv?.percent != null) return t("guide.reservoir", "{r}現在蓄水 {p}%。", { r: t(`reservoir.name.${rsv}`, rsv), p: Math.round(lv.percent) }); }
    if (u.type === "poi") {
      const p = pois.get(u.id); if (!p) return "";
      if (p.type === "nightmarket") return p.open ? t("guide.market_open", "{p}今天有開，晚上六點以後最熱鬧。", { p: p.name }) : t("guide.market_closed", "{p}今天公休，換一天再來吧。", { p: p.name });
      return t("guide.poi", "「{p}」是台南的代表景點，拍照模式拍一張吧！", { p: p.name });
    }
    if (u.type === "building") { const b = buildings.get(u.id); return b ? t("guide.building", "「{b}」在{d}。拉近一點可以看到它的模型細節。", { b: b.name, d: islands.get(b.island)?.name || "" }) : ""; }
    if (u.type === "spec") { const s = specs.info(u.id); return s ? t("guide.spec", "{s}的產季是{m}，發光的區就是產地。", { s: s.name, m: specs.monthsText(u.id) }) : ""; }
    if (u.type === "scenery") { const it = scenery.info(u.id); return it ? [sceneryStatus(it), it.desc.split(/(?<=[。.!?])\s*/)[0]].filter(Boolean).join(" ") : ""; }
    if (u.type === "monkey") return monkeys.info(u.id)?.found ? t("guide.monkey", "台灣獼猴是台灣特有種，群居在低海拔山區。") : "";
    if (u.type === "reservoir") { const lv = reservoirs.levels()[u.id]; return lv?.percent != null ? t("guide.reservoir", "{r}現在蓄水 {p}%。", { r: u.id, p: Math.round(lv.percent) }) : ""; }
    return "";
  }
  // 入夜、下雨、閒置提示
  const IDLE_TIPS = [["guide.tip.ming", "右上角「🎮 玩」裡可以玩「找找阿明」，他每天躲在不同的區。"], ["guide.tip.season", "打開圖層的「當季」，看看這個月台南盛產什麼。"], ["guide.tip.ride", "側欄「跟車」可以搭上火車或高鐵，用第一人稱看台南。"], ["guide.tip.photo", "「🎮 玩」裡有拍照模式，可以下載一張有相框的明信片。"], ["guide.tip.quiz", "考考自己：「🎮 玩」→「猜產地」，看你認識幾種台南農產。"], ["guide.tip.food", "「🎮 玩」→「美食圖鑑」，看看你吃遍台南幾區了。"]];
  let idle = 0, tipI = 0, wasNight = null, wasRain = null;
  for (const ev of ["pointerdown", "keydown", "wheel"]) addEventListener(ev, () => (idle = 0), { passive: true });
  function guideTick(dt) {
    idle += dt;
    if (idle > 45) { idle = 0; const [k, zh] = IDLE_TIPS[tipI++ % IDLE_TIPS.length]; guide.say(t(k, zh)); }
    const night = minute >= 1080 || minute < 300;
    if (wasNight !== null && night && !wasNight) { const m = world.pois.find((p) => p.type === "nightmarket" && p.open); if (m) guide.say(t("guide.night", "天黑了，{m}開始熱鬧了。", { m: m.name })); }
    wasNight = night;
    const rain = !!weather.current().rain;
    if (wasRain !== null && rain && !wasRain) guide.say(t("guide.rain", "下雨了！市民都撐起傘了。"));
    wasRain = rain;
  }
  document.addEventListener("click", (e) => {
    const rv = e.target.closest("[data-reservoir]");
    if (rv) { const r = reservoirs.places().find((x) => x.name === rv.dataset.reservoir); if (r) select({ type: "reservoir", id: r.name, x: r.x, z: r.z }); if (innerWidth <= 800) setSidebar(false); return; }
    const sp = e.target.closest("[data-spec],[data-spec-trip],[data-spec-glow]");
    if (sp) {
      if (sp.dataset.spec != null) select({ type: "spec", id: sp.dataset.spec });
      else if (sp.dataset.specGlow != null) specs.highlight(sp.dataset.specGlow);
      else { // 一日遊：產區由北到南（區號由北往南編）依序加進行程
        const ids = specs.districtsOf(sp.dataset.specTrip).slice().sort((a, b) => islands.get(a).number - islands.get(b).number);
        const n = ids.filter((id) => trip.add({ type: "island", id })).length;
        toast(n ? t("spec.trip_added", "已把 {n} 個產區排進行程，右下角可以播放", { n }) : t("trip.dup", "已經在行程裡"));
      }
      if (innerWidth <= 800) setSidebar(false);
      return;
    }
    const ta = e.target.closest("[data-trip-add]");
    if (ta) { const [type, ...rest] = ta.dataset.tripAdd.split(":"); trip.add({ type, id: rest.join(":") }); return; }
    const rm = e.target.closest("[data-pin-remove]");
    if (rm) { myPins.remove(+rm.dataset.pinRemove); select(null); toast(t("mypin.removed", "已刪除圖釘")); return; }
    const sh = e.target.closest("[data-pins-share]");
    if (sh) { const q = new URLSearchParams(location.search); q.set("pins", myPins.encode()); const url = `${location.origin}${location.pathname}?${q}`; navigator.clipboard?.writeText(url).then(() => toast(t("mypin.copied", "分享連結已複製"))).catch(() => prompt(t("mypin.share", "複製分享連結"), url)); return; }
    const rd = e.target.closest("[data-ride]");
    if (rd) { startRide(rd.dataset.ride, +(rd.dataset.rideIndex || 0)); return; }
    const fc = e.target.closest("[data-follow-car]");
    if (fc) { startFollow("car", +fc.dataset.followCar); return; }
    const hwb = e.target.closest("[data-highway],[data-hwj]");
    if (hwb) {
      if (hwb.dataset.hwj != null) { const p = highways.junctionPos(+hwb.dataset.hwj); if (p) flyTo(p.clone().add(new THREE.Vector3(1.6, 2.8, 3.4)), p.clone().setY(p.y + 0.2)); }
      else { select({ type: "highway", id: hwb.dataset.highway }); if (innerWidth <= 800 && hwb.closest("#sidebar")) setSidebar(false); }
      return;
    }
    const fw = e.target.closest("[data-follow-walker],[data-follow-train],[data-follow-bus],[data-follow-hsr]");
    if (fw) { if (fw.dataset.followWalker != null) startFollow("walker", +fw.dataset.followWalker); else if (fw.dataset.followHsr != null) { if (hsrPos(+fw.dataset.followHsr)) startFollow("hsr", +fw.dataset.followHsr); else toast(t("hsr.away_toast", "這班高鐵目前開出台南了，稍等折返再試")); } else if (fw.dataset.followBus != null) startFollow("bus", +fw.dataset.followBus); else startFollow("train", +fw.dataset.followTrain); return; }
    const scn = e.target.closest("[data-scenery]");
    if (scn) { select({ type: "scenery", id: scn.dataset.scenery }); if (innerWidth <= 800 && scn.closest("#sidebar")) setSidebar(false); return; }
    const bc = e.target.closest("[data-bus-color]");
    if (bc) { const c = bc.dataset.busColor; bc.disabled = true; buses.setColor(c, !buses.colorOn()[c]).finally(() => (bc.disabled = false)); return; }
    if (e.target.closest("[data-bus-now]")) { goLiveClock(); return; }
    const br = e.target.closest("[data-busroute],[data-busstop]");
    if (br) { select(br.dataset.busroute != null ? { type: "busroute", id: br.dataset.busroute } : { type: "busstop", id: br.dataset.busstop }); if (innerWidth <= 800 && br.closest("#sidebar")) setSidebar(false); return; }
    const b = e.target.closest("[data-island],[data-building],[data-station],[data-poi],[data-event],[data-bus],[data-mypin]");
    if (!b) return;
    if (b.dataset.mypin != null) { select({ type: "mypin", id: b.dataset.mypin }); return; }
    if (b.dataset.bus != null) { select({ type: "bus", id: b.dataset.bus }); return; }
    if (b.dataset.island) select({ type: "island", id: b.dataset.island });
    else if (b.dataset.event) select({ type: "event", id: b.dataset.event });
    else if (b.dataset.station) select({ type: "station", id: b.dataset.station });
    else if (b.dataset.poi) select({ type: "poi", id: b.dataset.poi });
    else select({ type: "building", id: b.dataset.building });
    if (innerWidth <= 800) setSidebar(false);
  });
  $("#card-close").addEventListener("click", () => select(null));
  document.addEventListener("submit", (e) => {
    const f = e.target.closest?.(".pin-save");
    if (!f) return;
    e.preventDefault();
    const note = f.querySelector("input").value.trim();
    if (f.dataset.pinSave) { const [x, z] = f.dataset.pinSave.split(",").map(Number); const i = myPins.add(x, z, note); if (pin) pin.visible = false; select({ type: "mypin", id: i }); toast(t("mypin.saved", "已存成我的圖釘")); }
    else if (f.dataset.pinEdit) { myPins.update(+f.dataset.pinEdit, note); select({ type: "mypin", id: +f.dataset.pinEdit }); toast(t("mypin.updated", "筆記已更新")); }
  });
  if (params.get("trip")) trip.load(params.get("trip"));
  if (params.get("pins")) { const n = myPins.importFrom(params.get("pins")); if (n) toast(t("mypin.imported", "已匯入 {n} 支分享的圖釘", { n })); }
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (e.target === $("#search")) { e.target.value = ""; renderTree(); return; } // 搜尋框：只清空，不取消選取
    if (tour.on) { tour.end(); return; }
    if (ride) { endRide(); return; }
    if (e.target.closest?.("#sidebar")) { e.target.blur(); return; } // 焦點在側欄：只移走焦點，不關卡片
    select(null);
  });

  // ── 側欄同步：選取的項目高亮並捲到看得到的位置 ──
  function highlightSidebar() {
    $$("#tree .active-item").forEach((el) => el.classList.remove("active-item"));
    if (!selected || selected.type === "walker") return;
    const rsv = rsvOf.get(`${selected.type}:${selected.id}`);
    if (rsv) $(`#tree [data-reservoir="${CSS.escape(rsv)}"]`)?.classList.add("active-item"); // 錨點建築選取時，側欄的水庫列也一起亮
    const el = $(`#tree [data-${selected.type}="${CSS.escape(selected.id)}"]`);
    if (el) {
      el.classList.add("active-item");
      // 只捲 #tree 自己；scrollIntoView 會連整頁一起捲，手機上會把藏在右側的側欄橫向拉進畫面
      const tree = $("#tree"), r = el.getBoundingClientRect(), tr = tree.getBoundingClientRect();
      if (r.top < tr.top || r.bottom > tr.bottom) tree.scrollTop += r.top - tr.top - tr.height / 2 + r.height / 2;
    }
  }
  // ── 短暫提示 ──
  const toastEl = $("#toast");
  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1600);
  }

  // ── 網址記住狀態：選取、時間、開關 ──
  function syncUrl() {
    const q = new URLSearchParams(location.search);
    for (const k of ["sel", "t", "d", "day", "flows", "names", "labels", "events"]) q.delete(k);
    if (selected && selected.type !== "walker" && selected.type !== "bus") // 行人與公車每次載入都不一樣，不寫進網址
      q.set("sel", selected.type === "spot" && Number.isFinite(selected.x) ? `spot:${selected.id}@${(selected.x / S).toFixed(2)},${(selected.z / S).toFixed(2)}` : `${selected.type}:${selected.id}`); // 圖釘要連座標一起記
    q.set("d", fmtDate(calDate));
    q.set("t", String(Math.round(minute)));
    for (const k of ["flows", "names", "events", "labels"]) if (toggles[k] !== (k === "events" || k === "labels")) q.set(k, toggles[k] ? "1" : "0");
    history.replaceState(null, "", `${location.pathname}?${q}`);
  }
  // ── 鍵盤：左右鍵在同類項目間切換，Enter 回全景 ──
  const orderOf = { island: D.islands.map((i) => i.id), building: [...buildings.keys()], station: infra.stations.map((s) => s.id), poi: world.pois.map((p) => p.id), event: fx.events.map((e) => e.id) };
  addEventListener("keydown", (e) => {
    if (e.target?.matches?.("input,textarea")) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const type = selected?.type && orderOf[selected.type] ? selected.type : "island";
      const list = orderOf[type], i = list.indexOf(selected?.id);
      select({ type, id: list[(i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length] });
      e.preventDefault();
    } else if (e.key === "Home") $("#home").click();
  });

  // ── 側欄 ──
  function renderTree(q = "") {
    const ql = q.trim().toLowerCase();
    $("#tree").innerHTML = D.islands
      .map((isl) => {
        const hitIsland = isl.name.toLowerCase().includes(ql) || specOf(isl.id).some((x) => x.name.toLowerCase().includes(ql)); // 搜「芒果」也會找到玉井、楠西
        const bs = isl.buildings.filter((b) => !ql || hitIsland || b.name.toLowerCase().includes(ql) || b.plain.toLowerCase().includes(ql));
        // 景點、夜市、科學園區也列在所屬的區底下（帶圖示），不再另外分區塊
        const ps = world.poisIn(isl.id).filter((p) => !ql || hitIsland || p.name.toLowerCase().includes(ql) || POI_TYPE[p.type][0].includes(ql));
        if (ql && !bs.length && !ps.length) return "";
        const spec = specOf(isl.id).length ? `<div class="specs">${specTags(isl.id)}</div>` : "";
        return `<section class="isl"><button class="isl-head" data-island="${isl.id}"><i style="--c:${isl.color}"></i><b>${isl.number}</b>${esc(isl.name)}</button>${spec}
          <ul>${bs.map((b) => `<li><button data-building="${b.id}">${esc(b.name)}</button></li>`).join("")}${ps.map((p) => `<li><button data-poi="${p.id}" class="poi-item">${POI_TYPE[p.type][1]} ${esc(p.name)}${p.type === "nightmarket" && !p.open ? ` <small class='muted'>${esc(t("tree.nightmarket_closed", "休"))}</small>` : ""}</button></li>`).join("")}</ul></section>`;
      })
      .join("");
    const evs = fx.events.filter((e) => !ql || e.name.toLowerCase().includes(ql) || t("tree.search.events", "活動 民俗").includes(ql));
    if (evs.length)
      $("#tree").innerHTML += `<section class="isl"><div class="isl-head"><i style="--c:#d98c3a"></i><b>🎆</b>${esc(t("tree.events", "活動"))}</div>
        <ul>${evs.map((e) => `<li><button data-event="${e.id}">${esc(e.name)}<span class="sub">${esc(islands.get(e.district)?.name || "")}</span></button></li>`).join("")}</ul></section>`;
    if (!ql || t("tree.search.trains", "火車 跟車 列車").includes(ql) || "高鐵 hsr 新幹線 高速鐵路".includes(ql))
      $("#tree").innerHTML += `<section class="isl"><div class="isl-head"><i style="--c:#2f6f9f"></i><b>🚆</b>${esc(t("tree.trains", "跟車"))}</div>
        <ul>${hsr.state().map((tr, i) => `<li class="pair"><button data-follow-hsr="${i}">${esc(t("tree.hsr_n", "高鐵 {n}", { n: i + 1 }))}<span class="sub">${esc(!tr.visible ? t("hsr.away", "台南以外") : tr.dir > 0 ? t("hsr.to_south", "往左營") : t("hsr.to_north", "往台北"))}</span></button><button class="mini" data-ride="hsr" data-ride-index="${i}" title="${esc(t("ride.board", "上車"))}">🚄 ${esc(t("ride.board", "上車"))}</button></li>`).join("")}${trains.state().map((tr, i) => `<li class="pair"><button data-follow-train="${i}">${esc(t("tree.train_n", "列車 {n}", { n: i + 1 }))}<span class="sub">${esc(tr.dir > 0 ? t("tree.train_to_shalun", "往沙崙") : t("tree.train_to_houbi", "往後壁"))}</span></button><button class="mini" data-ride="train" data-ride-index="${i}" title="${esc(t("ride.board", "上車"))}">🚆 ${esc(t("ride.board", "上車"))}</button></li>`).join("")}</ul></section>`;
    $("#tree").innerHTML += busSection(ql);
    const hws = highways.routeList().filter((r) => !ql || r.label.toLowerCase().includes(ql) || r.name.includes(ql) || t("tree.search.highways", "公路 國道 高速公路 快速道路 交流道").includes(ql));
    if (hws.length)
      $("#tree").innerHTML += `<section class="isl"><div class="isl-head"><i style="--c:#2f7d4f"></i><b>🛣️</b>${esc(t("tree.highways", "公路"))}</div>
        <ul>${hws.map((r) => `<li><button data-highway="${esc(r.id)}"><i class="dot" style="--c:${esc(r.color)}"></i>${esc(r.label)}</button></li>`).join("")}</ul></section>`;
    const scs = [...scenery.items.values()].filter((it) => !it.background).filter((it) => !ql || it.name.toLowerCase().includes(ql) || t("tree.search.scenery", "景觀 山 海 雲海 果園 魚塭").includes(ql));
    if (scs.length)
      $("#tree").innerHTML += `<section class="isl"><div class="isl-head"><i style="--c:#5f8f5e"></i><b>🏞️</b>${esc(t("tree.scenery", "山海景觀"))}</div>
        <ul>${scs.map((it) => { const c = scenery.center(it.id), d = c ? world.districtAt(c.x, c.z) : null; return `<li><button data-scenery="${esc(it.id)}">${esc(it.icon)} ${esc(it.name)}<span class="sub">${esc(d ? islands.get(d)?.name || "" : "")}</span></button></li>`; }).join("")}</ul></section>`;
    const mp = myPins.list().filter((p) => !ql || (p.note || "").toLowerCase().includes(ql) || t("tree.search.mypins", "圖釘 筆記").includes(ql));
    if (mp.length)
      $("#tree").innerHTML = `<section class="isl"><div class="isl-head"><i style="--c:#3e7c8c"></i><b>📍</b>${esc(t("mypin.eyebrow", "我的圖釘"))}</div>
        <ul>${mp.map((p) => `<li><button data-mypin="${p.id}">${esc(p.note || t("mypin.untitled", "（沒有筆記）"))}<span class="sub">${esc(islands.get(p.district)?.name || "")}</span></button></li>`).join("")}</ul></section>` + $("#tree").innerHTML;
    const rlv = reservoirs.levels(), rsv = reservoirs.places().filter((r) => !ql || r.name.toLowerCase().includes(ql) || t("tree.search.reservoirs", "水庫 蓄水 水情").includes(ql));
    if (rsv.length)
      $("#tree").innerHTML += `<section class="isl"><div class="isl-head"><i style="--c:#4a86ad"></i><b>💧</b>${esc(t("tree.reservoirs", "水庫蓄水"))}</div>
        <ul>${rsv.map((r) => { const p = rlv[r.name]?.percent; return `<li><button data-reservoir="${esc(r.name)}">${esc(r.name)}<span class="sub rsv-pct ${levelClass(p)}">${p == null ? esc(t("reservoir.no_data_short", "無資料")) : `${p.toFixed(1)}%`}</span></button></li>`; }).join("")}</ul></section>`;
    const sts = infra.stations.filter((s) => !ql || s.name.toLowerCase().includes(ql) || t("tree.search.stations", "火車站 車站 鐵路").includes(ql));
    if (sts.length)
      $("#tree").innerHTML += `<section class="isl"><div class="isl-head"><i style="--c:#2f6f9f"></i><b>🚆</b>${esc(t("tree.stations", "火車站"))}</div>
        <ul>${sts.map((s) => `<li><button data-station="${s.id}">${esc(s.name)}<span class="sub">${esc(islands.get(s.district)?.name || "")}</span></button></li>`).join("")}</ul></section>`;
    if (!$("#tree").innerHTML) $("#tree").innerHTML = `<p class='muted'>${esc(t("tree.no_results", "沒有符合的結果。"))}</p>`;
    highlightSidebar();
  }
  // 側欄「🚌 公車」：六色支線開關、即時／模擬狀態、路線清單（幹線＋已打開顏色的支線）。資料變動時只重畫這一段
  let busQuery = "";
  function busSection(ql = busQuery) {
    busQuery = ql;
    const list = buses.routeList().filter((r) => r.visible && (!ql || r.name.toLowerCase().includes(ql) || (r.en || "").toLowerCase().includes(ql) || r.from.includes(ql) || r.to.includes(ql) || t("tree.search.buses", "公車 幹線 支線 巴士").includes(ql)));
    if (ql && !list.length) return "";
    const on = buses.colorOn(), cols = buses.colors(), st = buses.status();
    const chips = Object.entries(cols).map(([id, c]) => `<button type="button" class="bus-color${on[id] ? " on" : ""}" data-bus-color="${id}" aria-pressed="${!!on[id]}" style="--c:${esc(c.hex)}">${esc(i18n.lang === "zh" ? c.zh : c.en)}</button>`).join("");
    return `<section class="isl" id="bus-sec"><div class="isl-head"><i style="--c:#d8342c"></i><b>🚌</b>${esc(t("tree.buses2", "公車"))}</div>
      <div class="bus-colors" role="group" aria-label="${esc(t("bus.colors_aria", "顯示支線"))}"><span class="muted">${esc(t("bus.branches", "支線"))}</span>${chips}</div>
      <p class="bus-mode">${busModeLine()}${st.mode === "live" ? "" : ` <button type="button" class="mini" data-bus-now>📡 ${esc(t("bus.go_live", "看現在"))}</button>`}</p>
      <ul>${list.map((r) => `<li><button data-busroute="${esc(r.id)}"><i class="dot" style="--c:${esc(r.hex)}"></i>${esc(routeName(r))}<span class="sub">${esc(r.from)} ⇄ ${esc(r.to)}${st.mode === "live" ? ` · ${esc(t("bus.live_n", "{n} 台", { n: r.liveCount }))}` : ""}</span></button></li>`).join("")}</ul></section>`;
  }
  function busChanged() {
    if (!treeReady) return;
    const el = $("#bus-sec");
    if (el) { el.outerHTML = busSection() || ""; highlightSidebar(); }
    if (!card.hidden && selected?.type === "busroute") { const open = [...$$("#card details")].map((d) => d.open); cardContent.innerHTML = busRouteCard(selected.id); $$("#card details").forEach((d, i) => { if (open[i] != null) d.open = open[i]; }); }
    if (!card.hidden && selected?.type === "busstop") cardContent.innerHTML = busStopCard(selected.id);
  }
  // 「看現在」：停止播放、日期與時間設成現在；時鐘在現在的時候公車改用 TDX 即時位置
  function goLiveClock() {
    stopPlay();
    setDate(todayUTC());
    const n = new Date(); setMinute(n.getHours() * 60 + n.getMinutes());
    syncUrl();
    toast(t("bus.live_toast", "時間已調到現在，公車改用即時位置"));
  }
  renderTree();
  treeReady = true;
  $("#search").addEventListener("input", (e) => renderTree(e.target.value));
  $("#search").addEventListener("keydown", (e) => { if (e.key === "Enter") { const first = $("#tree [data-building],#tree [data-station],#tree [data-poi],#tree [data-event]") || $("#tree [data-island]"); /* 先找地標，沒有才選區 */ if (first) { first.click(); e.preventDefault(); } } });
  const setSidebar = (open) => { $("#sidebar").classList.toggle("open", open); $("#sidebar-toggle").setAttribute("aria-expanded", String(open)); };
  $("#sidebar-toggle").addEventListener("click", () => setSidebar(!$("#sidebar").classList.contains("open")));
  // 手機版側欄右上角的 ×：同時綁 pointerup 與 click（Android Chrome 偶爾不送 click），並以 document 層級委派保險
  const closeSidebarNow = (e) => { e.preventDefault(); e.stopPropagation(); setSidebar(false); };
  $("#sidebar-close").addEventListener("pointerup", closeSidebarNow);
  $("#sidebar-close").addEventListener("click", (e) => { if (!e.defaultPrevented) closeSidebarNow(e); });
  document.addEventListener("pointerup", (e) => { if (e.target?.closest?.("#sidebar-close")) closeSidebarNow(e); }, true);

  // ── HUD 開關 ──
  const toggles = { labels: true, names: false, flows: false, pause: false, events: true, sound: false, heat: false, bnames: true, speech: false, season: false, roads: true };
  const TOGGLE_MSG = {
    labels: [t("toast.labels_on", "已顯示標籤"), t("toast.labels_off", "已隱藏標籤")],
    names: [t("toast.names_on", "已顯示動線行人的名牌"), t("toast.names_off", "已隱藏名牌")],
    bnames: [t("toast.bnames_on", "已顯示建築名稱（拉近才看得到）"), t("toast.bnames_off", "已隱藏建築名稱")],
    flows: [t("toast.flows_on", "已顯示 7 條跨區動線"), t("toast.flows_off", "只顯示選取項目的動線")],
    pause: [t("toast.pause_on", "已暫停行人、火車、活動與時間"), t("toast.pause_off", "繼續")],
    events: [t("toast.events_on", "已顯示民俗活動效果"), t("toast.events_off", "已隱藏民俗活動效果")],
    sound: [t("toast.sound_on", "已開啟聲音（全部即時合成）"), t("toast.sound_off", "已關閉聲音")],
    roads: [t("toast.roads_on", "已顯示高速公路與快速道路"), t("toast.roads_off", "已隱藏高速公路與快速道路")],
  };
  function updateFlowVisibility() {
    for (const [id, line] of flowLines) {
      const f = flows.get(id);
      let related = false;
      if (selected?.type === "island") related = f.from === selected.id || f.to === selected.id;
      if (selected?.type === "building") related = f.from === buildings.get(selected.id).island || f.to === buildings.get(selected.id).island;
      if (selected?.type === "walker") related = selected.flow != null && f.id === selected.flow;
      line.visible = toggles.flows || related;
    }
  }
  $$(".tg").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.toggle;
      toggles[k] = !toggles[k];
      b.setAttribute("aria-pressed", String(toggles[k]));
      syncUrl();
      if (k === "names") people.setNames(toggles.names);
      if (k === "heat") { heat.setEnabled(toggles.heat); toast(toggles.heat ? t("toast.heat_on", "熱度圖：顏色越深人越多，配合播放一天看通勤潮") : t("toast.heat_off", "已關閉熱度圖")); }
      if (k === "labels") labelRenderer.domElement.classList.toggle("hide-labels", !toggles.labels);
      if (k === "bnames") labelRenderer.domElement.classList.toggle("hide-bnames", !toggles.bnames);
      if (k === "events") { fx.setVisible(toggles.events); activeKinds = fx.activeKinds(); }
      if (k === "roads") { highways.setVisible(toggles.roads); labelRenderer.domElement.classList.toggle("hide-roads", !toggles.roads); }
      if (k === "sound") { audio.toggle(); toggles.sound = audio.enabled; b.setAttribute("aria-pressed", String(audio.enabled)); }
      if (k === "speech") {
        if (toggles.speech) {
          speech.unlock();
          if (!speech.setEnabled(true)) { toggles.speech = false; b.setAttribute("aria-pressed", "false"); toast(speech.reason); return; }
          toast(t("toast.speech_on", "已開啟朗讀"));
          if (!card.hidden) speech.speakCard(cardContent);
        } else { speech.setEnabled(false); toast(t("toast.speech_off", "已關閉朗讀")); }
        return;
      }
      if (k === "flows") updateFlowVisibility();
      if (k === "season") { specs.setSeasonal(toggles.season); toast(toggles.season ? t("toast.season_on", "已顯示各區 {m} 月當季的特產", { m: specMonth }) : t("toast.season_off", "已隱藏當季特產")); return; }
      toast(TOGGLE_MSG[k]?.[toggles[k] ? 0 : 1] ?? "");
    }),
  );
  $("#bird").addEventListener("click", () => {
    const tg = controls.target.clone();
    flyTo(new THREE.Vector3(tg.x, Math.max(10 * S, camera.position.distanceTo(tg) * 1.1), tg.z + 0.01), tg);
    toast(t("toast.bird", "俯瞰目前位置，拖曳可轉回"));
  });
  $("#home").addEventListener("click", () => {
    const hv = homeView();
    flyTo(hv.pos, hv.target);
    select(null);
  });

  // ── 活動的啟用狀態：依日期，或被選取時強制預覽 ──
  let previewEvent = null; // 目前被選取而強制演示的活動 id
  function applyEvent(e, d) {
    const occ = activeOccurrence(e.schedule, d), scheduled = !!occ;
    const on = scheduled || previewEvent === e.id;
    fx.setActive(e.id, on, occ?.index ?? 0);
    world.setEventActive(e.id, on);
    activeKinds = fx.activeKinds();
    const el = $(`.event-label[data-event="${e.id}"]`);
    if (el) {
      el.classList.toggle("inactive", !scheduled);
      const nx = nextOccurrence(e.schedule, d);
      el.textContent = e.name; // 標籤只顯示活動名，不標日期與狀態
    }
  }
  // 今日活動提示條：列出今天在期間內的活動，點了飛過去；沒有就隱藏
  const todayEl = $("#today-events");
  function renderTodayEvents(d) {
    const live = fx.events.filter((e) => activeOccurrence(e.schedule, d));
    todayEl.hidden = !live.length;
    todayEl.innerHTML = live.length ? `<b>🎆 ${esc(t("today.title", "今日活動"))}</b>${live.map((e) => `<button type="button" data-event="${e.id}">${esc(e.name)}</button>`).join("")}` : "";
  }
  function setPreview(id) {
    const prev = previewEvent;
    previewEvent = id;
    if (prev && prev !== id) applyEvent(eventsById.get(prev), calDate);
    if (id) applyEvent(eventsById.get(id), calDate);
  }

  // ── 日期：決定夜市營業與民俗活動是否進行 ──
  const DAY_MS = 86400000;
  const todayUTC = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
  let calDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get("d") || "") ? new Date(params.get("d") + "T00:00:00Z") : todayUTC();
  const doyInput = $("#doy"), dateLabel = $("#date-label");
  let cal = null; // 月曆面板，建立於 setDate 定義之後
  function setDate(d) {
    calDate = d;
    specMonth = d.getUTCMonth() + 1; specs.setMonth(specMonth); // 當季特產跟著日期換月（要在 renderTree 之前）
    const y = d.getUTCFullYear();
    doyInput.max = Math.round((Date.UTC(y, 11, 31) - Date.UTC(y, 0, 1)) / DAY_MS);
    doyInput.value = Math.round((d - Date.UTC(y, 0, 1)) / DAY_MS);
    dateLabel.textContent = t("date.label", "{date}（{weekday}）{lunar}", { date: fmtDate(d), weekday: weekdayName(d.getUTCDay()), lunar: lunarText(d) });
    $("#date-today").disabled = fmtDate(d) === fmtDate(todayUTC());
    world.setToday(d.getUTCDay());
    $$(".poi-label.nightmarket").forEach((el) => el.classList.toggle("closed", !pois.get(el.dataset.poi)?.open));
    for (const e of fx.events) applyEvent(e, d);
    renderTodayEvents(d);
    renderTree($("#search").value);
    if (selected && (selected.type === "event" || selected.type === "poi")) select(selected, { silent: true });
    if (cal?.isOpen()) { cal.setMonth(d.getUTCFullYear(), d.getUTCMonth() + 1); cal.render(); }
    env.setDate(d); if (typeof minute === "number") setMinute(minute); // 日出日落隨日期改變，重算光照
    fields.setDate(d); // 田地顏色隨作物產季與日期變化
    if (selected?.type === "island" && !card.hidden) cardContent.innerHTML = islandCard(islands.get(selected.id)); // 換月：只重畫卡片的「當季」標記，不移動鏡頭
    if (selected?.type === "spec" && !card.hidden) cardContent.innerHTML = specs.cardHtml(selected.id, specMonth, islandBtn);
  }
  for (const e of fx.events) e.districtName = islands.get(e.district)?.name || "";
  cal = createCalendarPanel({
    container: $("#calendar"), events: fx.events, getDate: () => calDate,
    onPickDate: (d) => { setDate(d); syncUrl(); },
    onPickEvent: (id) => select({ type: "event", id }),
    lunarLabel, occurrencesIn, fmtDate,
  });
  $("#calendar-toggle").addEventListener("click", () => { cal.toggle(); $("#calendar-toggle").setAttribute("aria-expanded", String(cal.isOpen())); if (cal.isOpen()) { cal.setMonth(calDate.getUTCFullYear(), calDate.getUTCMonth() + 1); cal.render(); } });
  doyInput.addEventListener("input", () => setDate(new Date(Date.UTC(calDate.getUTCFullYear(), 0, 1) + +doyInput.value * DAY_MS)));
  doyInput.addEventListener("change", syncUrl);
  $("#date-today").addEventListener("click", () => { setDate(todayUTC()); syncUrl(); toast(t("toast.today", "已回到今天")); });
  let yearPlaying = false, yearAcc = 0;
  const yearBtn = $("#year-play");
  yearBtn.addEventListener("click", () => {
    if (!yearPlaying && doyInput.value >= +doyInput.max) setDate(new Date(Date.UTC(calDate.getUTCFullYear(), 0, 1)));
    yearPlaying = !yearPlaying;
    yearBtn.textContent = yearPlaying ? "❚❚" : "▶";
    yearBtn.title = yearPlaying ? t("year.pause.title", "暫停播放一年") : t("year.play.title", "播放一年（每秒兩天）");
  });

  // ── 一天的時間 ──
  const dayInput = $("#day"), clock = $("#clock"), note = $("#day-note"), playBtn = $("#day-play");
  let minute = 480, playing = false, period = null, nightNow = 0, liveAcc = 0, clockLive = false;
  // 播放時 1 秒 = 90 分鐘，一天 16 秒、營運 19 小時約 12.7 秒；全線單程（含停站）原本約 50 秒，乘 4 倍後約 12.4 秒剛好跑完
  const TRAIN_PLAY_SCALE = 4.5;
  function setMinute(m) {
    minute = ((m % 1440) + 1440) % 1440;
    dayInput.value = Math.round(minute);
    clock.value = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute % 60)).padStart(2, "0")}`;
    period = D.dayCycle.find((p) => minute >= p.from && minute < p.to) || null;
    note.textContent = period ? t("day.note", "{label}｜{note}", { label: period.label, note: period.note }) : "";
    const PERIOD_BTN = { 深夜: 1260, 清晨: 390, 通勤尖峰: 390, 白天: 720, 黃昏: 1080, 夜晚: 1260 }; // 以中文原文（label_zh）為 key，翻譯後仍能對上
    $$("[data-time]").forEach((b) => b.classList.toggle("active", period ? PERIOD_BTN[period.label_zh ?? period.label] === +b.dataset.time : false));
    const night = env.setTime(minute);
    nightNow = night;
    kit.setNight(night);
    people.setNight(night);
    trains.setNight(night, minute);
    hsr.setNight(night, minute);
    buses.setNight(night, minute); // 06:00–22:30 以外收班
    trails.setNight(night, minute); // 06:00–19:00 才有騎士
    sugar.setNight(night, minute); // 五分車 09:00–16:30
    highways.setNight(night); // 入夜亮車燈
  }
  const stopPlay = () => { playing = false; playBtn.textContent = "▶"; };
  dayInput.addEventListener("input", () => { stopPlay(); setMinute(+dayInput.value); });
  $$("[data-time]").forEach((b) => b.addEventListener("click", () => { stopPlay(); setMinute(+b.dataset.time); }));
  const setPlaying = (on) => { playing = on; playBtn.textContent = on ? "❚❚" : "▶"; playBtn.setAttribute("aria-label", on ? t("day.pause.aria", "暫停播放") : t("day.loop.aria", "循環播放一天")); };
  playBtn.addEventListener("click", () => setPlaying(!playing));
  setMinute(params.has("t") ? +params.get("t") : 480);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(true); // 預設就循環播放，按 ❚❚ 才停
  setDate(calDate);
  for (const k of ["flows", "names", "events", "labels", "heat", "bnames", "season", "roads"]) if (params.has(k)) { const v = params.get(k) === "1"; if (v !== toggles[k]) $(`[data-toggle="${k}"]`).click(); }
  $$(".tg").forEach((b) => b.setAttribute("aria-pressed", String(!!toggles[b.dataset.toggle]))); // HTML 預設與 toggles 若不一致，以 toggles 為準
  if (params.has("sel")) { // 還原網址裡的選取；出錯就略過，不讓整頁載入失敗
    try {
      const [type, ...rest] = params.get("sel").split(":");
      let u = { type, id: rest.join(":") };
      if (type === "spot") { // spot:<區>@x,z（1 倍地圖的座標，地圖放大前的連結也能用）；舊網址沒有座標就改開那一區
        const [id, xz] = u.id.split("@"), [x, z] = (xz || "").split(",").map(Number);
        u = Number.isFinite(x) && Number.isFinite(z) ? { type, id, x: x * S, z: z * S } : { type: "island", id };
      }
      select(u, { silent: true });
    } catch (e) { console.warn("[hex-city] 網址的 sel 無法還原，略過", params.get("sel"), e); select(null, { silent: true }); }
  }
  dayInput.addEventListener("change", syncUrl);

  // ── 導覽：依序飛到幾個地點並切換時段，字幕在下方；用 performance.now() 計時，暫停時凍結剩餘秒數 ──
  // 主題導覽的流程在 tour.js；calDate、toggles 會變，用函式延後讀
  const tour = createTour({ t, esc, tours: toursData.tours, eventsById, select, setDate, setMinute, stopPlay, setSidebar, toast, syncUrl, speech,
    speechOn: () => toggles.speech, now: () => ({ calDate }) });
  if (params.get("tour") && !matchMedia("(prefers-reduced-motion: reduce)").matches) tour.start(0, params.get("tour") === "1" ? toursData.tours[0].id : params.get("tour"));

  // ── 尺寸與主迴圈 ──
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const hv = homeView();
    env.setExtent(EXT, hv.pos.distanceTo(hv.target)); // 霧距跟著全景鏡頭距離，直向與橫向都能看清整座城
  }
  new ResizeObserver(resize).observe(stage);
  resize();
  { const hv = homeView(); if (!params.has("sel") && !params.has("tour")) { camera.position.copy(hv.pos); controls.target.copy(hv.target); } } // 依實際長寬比放全景

  // 建築名牌裁切：每 0.25 秒一次，只顯示離鏡頭焦點最近的 40 個、半徑 14 以內；拉遠或關掉「建築名」全部隱藏
  let labelAcc = 1;
  function cullBuildingLabels(dt, camDist) {
    labelAcc += dt;
    if (labelAcc < 0.25) return;
    labelAcc = 0;
    const show = toggles.bnames && camDist < EXT * 0.45 && !ride;
    const tg = controls.target, R = Math.min(14 * S, camDist * 1.2), MAX = quality === "low" ? 20 : 40;
    const cand = [];
    for (const o of buildingLabels) {
      if (!show || layers.scaleOf(o.element.dataset.building) < 0.5) { o.visible = false; continue; } // 還沒長出來的次要建築不顯示名牌
      const d = Math.hypot(o.position.x - tg.x, o.position.z - tg.z);
      if (d < R) cand.push([d, o]); else o.visible = false;
    }
    cand.sort((a, b) => a[0] - b[0]);
    cand.forEach(([, o], i) => { o.visible = i < MAX; });
    // 鏡頭焦點在市區四區時可以拉得更近（建築縮小過）；慢慢改，避免離開市區時鏡頭跳一下
    const goalMin = world.isCore(world.districtAt(tg.x, tg.z)) ? 1.6 : 3;
    controls.minDistance += (goalMin - controls.minDistance) * 0.35;
    declutter(cand.filter(([, o]) => o.visible).map(([, o]) => o));
  }
  // 名牌防重疊：把名牌投影到螢幕，依重要度一個個放，和已放的重疊就加 .clutter 藏起來。
  // 順序：目前選取的 → 區名、車站、活動（一定顯示，只當障礙物）→ 景點（景點 > 夜市 > 園區，近的優先）→ 建築名（近的優先）
  const labelSize = new WeakMap(), projV = new THREE.Vector3(), POI_RANK = { attraction: 0, nightmarket: 1, sciencepark: 2 };
  function declutter(buildingObjs) {
    const { width: W, height: H } = labelRenderer.getSize(), placed = [], tg = controls.target;
    const rectOf = (o) => {
      projV.copy(o.position).project(camera);
      if (projV.z > 1 || Math.abs(projV.x) > 1.2 || Math.abs(projV.y) > 1.2) return null; // 在鏡頭後面或畫面外：不佔位
      const el = o.element;
      let s = labelSize.get(el);
      if (!s) { s = el.offsetWidth ? [el.offsetWidth, el.offsetHeight] : [el.textContent.length * 10 + 16, 20]; if (el.offsetWidth) labelSize.set(el, s); }
      const x = ((projV.x + 1) / 2) * W, y = ((1 - projV.y) / 2) * H;
      return [x - s[0] / 2 - 2, y - s[1] / 2 - 1, x + s[0] / 2 + 2, y + s[1] / 2 + 1];
    };
    const hits = (r) => placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    const selKey = selected ? `${selected.type}:${selected.id}` : "";
    const keyOf = (o) => (o.element.dataset.poi ? "poi:" + o.element.dataset.poi : "building:" + o.element.dataset.building);
    const near = (o) => Math.hypot(o.position.x - tg.x, o.position.z - tg.z);
    const poiCands = currentLod === "lod-far" ? [] : poiLabels.slice().sort((a, b) => (POI_RANK[poiTypeOf(a)] - POI_RANK[poiTypeOf(b)]) || near(a) - near(b));
    const cands = [...poiCands, ...buildingObjs];
    const sel = cands.find((o) => keyOf(o) === selKey);
    for (const o of [sel, ...fixedLabels].filter(Boolean)) {
      if (o !== sel && !o.element.offsetWidth) continue; // 被 CSS 藏起來的不佔位
      const r = rectOf(o);
      if (r) placed.push(r);
      if (o === sel) o.element.classList.remove("clutter");
    }
    for (const o of cands) {
      if (o === sel) continue;
      const r = rectOf(o), hide = !!r && hits(r);
      o.element.classList.toggle("clutter", hide);
      if (r && !hide) placed.push(r);
    }
  }
  const poiTypeOf = (o) => pois.get(o.element.dataset.poi)?.type ?? "sciencepark";
  // 效能：平均 FPS 連續 4 秒低於 28 就降一級畫質（最多降到 low）；?fps=1 顯示即時數據
  const fpsEl = params.get("fps") === "1" ? Object.assign(document.createElement("div"), { className: "fps-meter" }) : null;
  if (fpsEl) document.body.appendChild(fpsEl);
  let perfT = 0, perfFrames = 0, lowStreak = 0, fpsNow = 60;
  function setQuality(q) {
    quality = q;
    renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[q].ratio));
    renderer.shadowMap.enabled = QUALITY[q].shadows;
    scenery.setQuality(q);
    highways.setQuality(q);
    scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
    resize();
  }
  function perfTick(dt) {
    perfT += dt; perfFrames++;
    if (perfT < 1) return;
    fpsNow = perfFrames / perfT; perfT = 0; perfFrames = 0;
    if (document.hidden) return;
    lowStreak = fpsNow < 28 ? lowStreak + 1 : 0;
    if (lowStreak >= 4 && quality !== "low" && !params.get("quality")) {
      setQuality(quality === "high" ? "med" : "low");
      lowStreak = 0;
      toast(t("toast.quality_down", "畫面較吃力，已自動降低畫質"));
    }
    if (fpsEl) fpsEl.textContent = `${fpsNow.toFixed(0)} fps · ${quality} · ${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris · ${buildingLabels.filter((o) => o.visible).length} names · ${people.count} walkers`;
  }
  const clockT = new THREE.Clock();
  let currentLod = "";
  let started = false;
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clockT.getDelta(), 0.05);
    if (playing && !toggles.pause) { // 1 秒 = 1.5 小時；暫停時時間也停住；到 24:00 自動停
      const next = minute + dt * 90;
      setMinute(next >= 1440 ? next - 1440 : next); // 到 24:00 直接接回 00:00，一直循環播放
    }
    if (!toggles.pause) {
      people.update(dt, period?.speed ?? 1, clockT.elapsedTime);
      trains.update(dt, period?.speed ?? 1, playing ? TRAIN_PLAY_SCALE : 1);
      hsr.update(dt, period?.speed ?? 1, playing ? TRAIN_PLAY_SCALE : 1);
      buses.update(dt, period?.speed ?? 1, playing ? TRAIN_PLAY_SCALE : 1);
      trails.update(dt, period?.speed ?? 1, playing ? TRAIN_PLAY_SCALE : 1);
      sugar.update(dt, period?.speed ?? 1, playing ? TRAIN_PLAY_SCALE : 1); // 播放一天時列車加速，一天內跑完全線
      highways.update(dt, period?.speed ?? 1, playing ? TRAIN_PLAY_SCALE : 1, minute);
      fx.update(dt, nightNow, period?.speed ?? 1);
      weather.update(dt);
      heat.update(people, dt);
    }
    audio.update(dt, { night: nightNow, period: period?.label_zh ?? period?.label ?? null, activeEffects: activeKinds, cameraHeight: (camera.position.y - TOP) / S, paused: toggles.pause });
    if (yearPlaying && !toggles.pause) {
      yearAcc += dt;
      if (yearAcc >= 0.5) {
        yearAcc = 0;
        const next = new Date(calDate.getTime() + DAY_MS);
        if (next.getUTCFullYear() !== calDate.getUTCFullYear()) { yearPlaying = false; yearBtn.textContent = "▶"; syncUrl(); toast("一年結束"); } else setDate(next);
      }
    }
    buses.setView(camera.position.distanceTo(controls.target)); // 拉近才顯示公車站牌
    if (layers.size) layers.update(dt, camera.position.distanceTo(controls.target), controls.target, selected?.type === "building" ? selected.id : null); // 分層的建築長出來／縮回
    if ((liveAcc += dt) > 1) { // 時鐘在「現在」（今天、沒在播放、跟真實時間差 10 分鐘內）時，公車改用 TDX 即時位置，時鐘也跟著走
      liveAcc = 0;
      const n = new Date(), nowMin = n.getHours() * 60 + n.getMinutes();
      const live = !playing && !tour.on && calDate.getTime() === todayUTC().getTime() && Math.abs(minute - nowMin) <= 10;
      buses.setLive(live); clockLive = live;
      if (live && Math.abs(minute - nowMin) >= 1) setMinute(nowMin);
    }
    animateCamera();
    updateFollow();
    updateRide();
    trip.update(dt);
    specs.update(dt);
    ming.update(dt, toggles.pause);
    scenery.update(toggles.pause ? 0 : dt, { minute, night: nightNow, month: calDate.getUTCMonth() + 1, weekday: calDate.getUTCDay(), dateKey: fmtDate(calDate), weather: weather.current(), live: clockLive, camera, target: controls.target, speedMul: period?.speed ?? 1 }); // 星空跟著相機，暫停時也要更新位置
    if (!toggles.pause) monkeys.update(dt, { minute });
    guideTick(dt);
    tour.update();
    refreshWalkerCard(clockT.elapsedTime);
    // 標籤分層：拉遠只留區名，中距離顯示車站與活動，拉近才顯示景點
    const dist = camera.position.distanceTo(controls.target);
    const lod = dist > EXT * 1.1 ? "lod-far" : dist > EXT * 0.45 ? "lod-mid" : "lod-near";
    if (lod !== currentLod) { labelRenderer.domElement.classList.remove("lod-far", "lod-mid", "lod-near"); labelRenderer.domElement.classList.add(lod); currentLod = lod; }
    controls.update();
    env.follow(controls.target, dist); // 陰影範圍跟著鏡頭焦點與距離
    const near = Math.min(2, Math.max(0.1, dist * 0.005)); // 拉遠時 near 放大，遠處的線和地面才不會互相閃爍
    if (Math.abs(near - camera.near) > camera.near * 0.1) { camera.near = near; camera.updateProjectionMatrix(); }
    cullBuildingLabels(dt, dist);
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    perfTick(dt);
    if (!started) {
      started = true;
      for (const e of fx.events) applyEvent(e, calDate); // CSS2D 標籤在第一次渲染後才進 DOM，重套一次狀態文字
      $("#loading").classList.add("done");
      document.body.classList.add("ready");
    }
  }
  animate();
} catch (err) {
  console.error(err);
  const el = $("#loading");
  el.innerHTML = `<h2>載入失敗</h2><p>${esc(err.message)}</p>`;
}
