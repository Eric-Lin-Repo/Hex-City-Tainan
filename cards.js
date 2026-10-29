// 卡片：各種被選取物件（區、建築、車站、活動、公車、國道、景觀、水庫、田、行人……）右側資訊卡的 HTML。
// 只產生字串，不碰 DOM 與選取狀態；select()、圖釘模型與行人卡片的即時刷新留在 app.js。
// createCards({ t, esc, sep, i18n, zh, city, world, infra, people, fx, fields, buses, scenery, monkeys, reservoirs, weather, talk, islands, buildings, pois, stations, flows, roles, mapLinks, agesData, sceneryData, rsvOf, POI_TYPE, flowsOf, roleLabel, specOf, specTags, lineOf, fmtRangeT, weekdayName, tripBtn, sceneryAnchor, buildingIdOf, now })
//   now() → { calDate, minute }：app.js 的日期與時間比這裡晚宣告，產生卡片時才讀
//   → { islandBtn, islandCard, buildingCard, pinCard, myPinCard, walkerStatus, stationCard, eventCard, routeName, busModeLine, busCard, highwayCard, carCard, busRouteCard, sceneryStatus, sceneryCard, monkeyCard, sceneryChips, busStopCard, busStatus, trailCard, sugarCard, reservoirCard, reservoirSection, fieldCard, poiCard, walkerCard }
import * as THREE from "three";
import { nextOccurrence, isActive, activeOccurrence, occurrencesIn, fmtDate } from "./calendar.js";
import { levelClass } from "./reservoir.js";

export function createCards({ t, esc, sep, i18n, zh, city, world, infra, people, fx, fields, buses, scenery, monkeys, reservoirs, weather, talk, islands, buildings, pois, stations, flows, roles, mapLinks, agesData, sceneryData, rsvOf, POI_TYPE, flowsOf, roleLabel, specOf, specTags, lineOf, fmtRangeT, weekdayName, tripBtn, sceneryAnchor, buildingIdOf, now }) {
  const islandBtn = (id) => `<button class="chip" data-island="${id}" style="--c:${islands.get(id).color}">${esc(islands.get(id).name)}</button>`;
  const flowList = (list) =>
    list.length
      ? `<ul class="flows">${list
          .map((f) => `<li><i style="--c:${f.carry}"></i><b>${esc(roleLabel(f.walker))}</b>${islandBtn(f.from)} → ${islandBtn(f.to)}<p>${esc(f.text)}</p></li>`)
          .join("")}</ul>`
      : `<p class='muted'>${esc(t("card.no_flows", "這個區目前沒有跨區動線。"))}</p>`;

  // Google Maps 連結：用「名稱＋區名＋台南市」搜尋，Google 會直接開到該地標頁（實測等同 /maps/place/龍崎文衡殿），不用經緯度
  // 每個地點實測過：預設「名稱 區名 台南市」，少數地點 Google 要用別的查詢字才會直達，寫在 data/maplinks.json
  const mapLink = (name, districtId) => { const q = mapLinks.query[name] || `${name} ${zh(islands.get(districtId)) || ""} ${t("maplink.city", "台南市")}`.trim(); return `<a class="maplink" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}" target="_blank" rel="noopener noreferrer">${esc(t("maplink.open", "在 Google Maps 開啟 ↗"))}</a>`; };
  // 沒有名稱的任意點（圖釘）才用經緯度
  const mapLinkAt = (pos) => { const ll = world.toLonLat(pos.x, pos.z); return ll ? `<a class="maplink" href="https://www.google.com/maps/search/?api=1&query=${ll[1].toFixed(5)},${ll[0].toFixed(5)}" target="_blank" rel="noopener noreferrer">${esc(t("maplink.open", "在 Google Maps 開啟 ↗"))}</a>` : ""; };
  const districtPop = new Map((city.districts || []).map((d) => [d.id, d.population]));
  function islandStats(id) {
    const km2 = world.areaKm2(id), pop = districtPop.get(id);
    const cells = [
      [t("card.population", "人口"), pop != null ? t("card.population.value", "約 {n} 千人", { n: pop >= 100 ? Math.round(pop) : pop }) : "—"],
      [t("card.area", "面積"), km2 != null ? t("card.area.value", "{n} km²", { n: Math.round(km2) }) : "—"],
      [t("card.walkers", "此刻行人"), t("card.walkers.value", "{n} 人", { n: people.countIn(id) })],
      [t("card.buildings", "建築"), t("card.buildings.value", "{n} 棟", { n: islands.get(id)?.buildings.length ?? 0 })],
      [t("card.pois", "景點"), t("card.pois.value", "{n} 處", { n: world.poisIn(id).length })],
      [t("card.stations", "車站"), t("card.stations.value", "{n} 座", { n: infra.stationsIn(id).length })],
      [t("card.events", "活動"), t("card.events.value", "{n} 個", { n: fx.events.filter((e) => e.district === id).length })],
    ];
    const ag = agesData.byDistrict?.[id];
    if (ag) cells.push([t("age.elder", "65 歲以上"), `${ag.old}%`], [t("age.child", "14 歲以下"), `${ag.young}%`]); // 內政部戶政司 2026-09 單一年齡人口統計
    return `<div class="stats">${cells.map(([k, v]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join("")}</div>`;
  }
  function islandCard(isl) {
    const crop = fields.stageOf(isl.id); // 郊區才有田
    const farm = crop.length ? `<p class="muted">${t("field.in_district", "田裡：{list}", { list: crop.map((c) => cropStage(c)).join(sep) })}</p>` : "";
    return `<div class="eyebrow">DISTRICT ${String(isl.number).padStart(2, "0")}</div><h2>${esc(isl.name)}</h2><p>${esc(isl.summary)}</p>
      ${islandStats(isl.id)}${farm}
      ${specOf(isl.id).length ? `<p class="specs card-specs"><span class="muted">${esc(t("card.specialties", "農特產"))}</span>${specTags(isl.id)}</p>` : ""}
      ${[[null, t("section.buildings", "建築")], ["street", t("section.street", "老街・廟・市場（拉近才出現）")]].map(([layer, title]) => { // 依分層分組
        const bs = isl.buildings.filter((b) => (b.layer ?? null) === layer);
        return bs.length ? `<h3>${esc(title)}</h3><ul class="list">${bs.map((b) => `<li><button data-building="${b.id}">${esc(b.name)}</button><span>${esc(b.plain)}</span></li>`).join("")}</ul>` : "";
      }).join("")}
      <h3>${esc(t("section.flows", "跨區動線"))}</h3>${flowList(flowsOf(isl.id))}`;
  }
  function buildingCard(b) {
    const isl = islands.get(b.island);
    return `<div class="eyebrow">${islandBtn(isl.id)}</div><h2>${esc(b.name)}</h2><p>${esc(b.plain)}</p>
      <ul class="facts">${b.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      <p>${tripBtn("building", b.id)} ${mapLink(zh(b), isl.id)}${b.geocoded ? "" : ` <span class='muted'>${esc(t("card.not_geocoded", "（位置為區內示意，非真實座標）"))}</span>`}</p>
      ${reservoirSection(rsvOf.get(`building:${b.id}`))}
      <h3>${esc(t("section.district_flows", "所在區的動線"))}</h3>${flowList(flowsOf(isl.id))}`;
  }
  // 圖釘：點地面任意處，顯示所在區與最近的地標
  function pinCard(u) {
    const isl = islands.get(u.id), here = new THREE.Vector3(u.x, 0, u.z);
    const near = [];
    for (const b of isl.buildings) near.push({ name: b.name, kind: t("pin.kind.building", "建築"), attr: `data-building="${b.id}"`, d: world.buildingPos.get(b.id).clone().setY(0).distanceTo(here) });
    for (const p of world.poisIn(u.id)) near.push({ name: p.name, kind: POI_TYPE[p.type][0], attr: `data-poi="${p.id}"`, d: p.pos.clone().setY(0).distanceTo(here) });
    for (const s of infra.stationsIn(u.id)) near.push({ name: s.name, kind: t("pin.kind.station", "車站"), attr: `data-station="${s.id}"`, d: s.pos.clone().setY(0).distanceTo(here) });
    near.sort((a, b) => a.d - b.d);
    const km = (d) => (world.toLonLat ? `${(d / (city.projection?.k || 1)).toFixed(1)} km` : "");
    return `<div class="eyebrow">${esc(t("pin.eyebrow", "圖釘"))}</div><h2>${islandBtn(u.id)}</h2><p>${esc(isl.summary)}</p>
      <h3>${esc(t("section.nearby", "附近"))}</h3><ul class="list">${near.slice(0, 4).map((n) => `<li><button ${n.attr}>${esc(n.name)}</button><span>${t("pin.distance", "{kind} · 約 {d}", { kind: esc(n.kind), d: km(n.d) })}</span></li>`).join("") || `<li><span class='muted'>${esc(t("pin.none", "附近沒有地標"))}</span></li>`}</ul>
      <p>${mapLinkAt(here)}</p>
      <form class="pin-save" data-pin-save="${u.x.toFixed(3)},${u.z.toFixed(3)}"><input type="text" maxlength="80" placeholder="${esc(t("mypin.placeholder", "寫一行筆記（可留空）"))}" aria-label="${esc(t("mypin.note", "筆記"))}"><button type="submit" class="chip act">📍 ${esc(t("mypin.save", "存成我的圖釘"))}</button></form>
      <p class="muted">${esc(t("pin.hint", "再點地面其他地方可移動圖釘，Esc 移除。"))}</p>`;
  }
  function myPinCard(p) {
    const here = new THREE.Vector3(p.x, 0, p.z), isl = p.district ? islands.get(p.district) : null;
    return `<div class="eyebrow">${esc(t("mypin.eyebrow", "我的圖釘"))}</div><h2>${esc(p.note || t("mypin.untitled", "（沒有筆記）"))}${isl ? `<small>${esc(isl.name)}</small>` : ""}</h2>
      <form class="pin-save" data-pin-edit="${p.id}"><input type="text" maxlength="80" value="${esc(p.note || "")}" aria-label="${esc(t("mypin.note", "筆記"))}"><button type="submit" class="chip act">${esc(t("mypin.update", "更新筆記"))}</button></form>
      <p>${mapLinkAt(here)}</p>
      <p><button class="chip" data-pin-remove="${p.id}">${esc(t("mypin.remove", "刪除這支圖釘"))}</button> <button class="chip" data-pins-share>${esc(t("mypin.share", "複製分享連結"))}</button></p>
      <p class="muted">${esc(t("mypin.hint", "圖釘存在這台裝置的瀏覽器裡；分享連結會把所有圖釘與筆記編進網址。"))}</p>`;
  }
  const walkerStatus = (w) =>
    w.status === "rest" ? t("walker.status.rest", "在 {place} 休息中", { place: islandBtn(w.at) })
    : w.status === "stroll" ? t("walker.status.stroll", "在 {place} 散步", { place: islandBtn(w.at) })
    : w.status === "flow" ? t("walker.status.flow", "正前往 {dest}", { dest: islandBtn(w.dest) })
    : t("walker.status.moving", "從 {from} 前往 {dest}", { from: islandBtn(w.at), dest: islandBtn(w.dest) });
  const stationBtn = (id) => `<button class="chip" data-station="${id}">${esc(stations.get(id)?.name || id)}</button>`;
  function stationCard(s) {
    return `<div class="eyebrow">${esc(lineOf(s.id))}</div><h2>${esc(s.name)}<small>${esc(s.kind === "hsr" ? t("station.kind.hsr", "台鐵沙崙站與高鐵台南站") : s.kind === "major" ? t("station.kind.major", "特等站") : t("station.kind.rail", "台鐵車站"))}</small></h2>
      <dl class="meta"><dt>${esc(t("station.district", "所在區"))}</dt><dd>${islandBtn(s.district)}</dd><dt>${esc(t("station.neighbors", "相鄰站"))}</dt><dd>${s.neighbors.map((n) => stationBtn(n.id)).join(" ")}</dd></dl>
      <p>${tripBtn("station", s.id)} ${mapLink(zh(s) + (s.kind === "hsr" ? t("maplink.hsr_suffix", "站") : t("maplink.station_suffix", "車站")), s.district)}</p>
      <p class="muted">${esc(t("station.note", "火車行駛後壁到沙崙的直通路線，每站停靠、到終點折返，深夜停駛。站點座標為近似值。"))}</p>`;
  }
  function eventCard(e) {
    const { calDate } = now();
    const occ = activeOccurrence(e.schedule, calDate), on = !!occ, nx = nextOccurrence(e.schedule, calDate);
    const y = calDate.getUTCFullYear(); // 跨年的活動（例如 12/24–2/16）去年開始的那段也算今年
    const thisYear = [...occurrencesIn(e.schedule, y - 1).filter((o) => o.end.getUTCFullYear() >= y), ...occurrencesIn(e.schedule, y)];
    const status = on ? `<b class='open'>${occ.label ? t("event.status.on_label", "進行中・{label}", { label: esc(occ.label) }) : esc(t("event.status.on", "進行中"))}</b>` : `<b class='open'>${esc(t("event.status.preview", "預覽中"))}</b><span class='muted'>${esc(nx ? t("event.status.next", "（當天沒有，下次 {date}）", { date: fmtDate(nx) }) : t("event.status.none", "（當天沒有）"))}</span>`;
    const dates = thisYear.length ? `<dt>${esc(t("event.this_year", "今年日期"))}</dt><dd>${thisYear.map((o) => esc(fmtRangeT(o))).join("<br>")}</dd>` : `<dt>${esc(t("event.this_year", "今年日期"))}</dt><dd><span class='muted'>${esc(t("event.not_this_year", "今年不舉辦"))}</span></dd>`;
    return `<div class="eyebrow">${esc(t("event.eyebrow", "民俗活動"))}</div><h2>${esc(e.name)}</h2><p>${esc(e.desc)}</p>
      <dl class="meta"><dt>${esc(t("event.when", "時間"))}</dt><dd>${esc(e.when)}</dd>${dates}<dt>${esc(t("event.where", "地點"))}</dt><dd>${islandBtn(e.district)}</dd></dl>
      <p class="muted">${esc(t("event.note", "畫面上的效果為示意，可用「活動」開關關閉。"))}</p>`;
  }
  // 公車：路線名（英文版用 TDX 的 B1、G17、Blue Trunk）、站名（英文版用 OSM 的 name:en）
  const routeName = (r) => (i18n.lang === "zh" ? r.name : r.en || r.name);
  const stopLabel = (s) => (i18n.lang === "zh" ? s.name : s.en || s.name);
  const routeChip = (id) => { const r = buses.routeInfo(id); return r ? `<button class="chip bus-chip" data-busroute="${esc(r.id)}" style="--c:${esc(r.hex)}">${esc(routeName(r))}</button>` : esc(id); };
  const busModeLine = () => {
    const st = buses.status();
    if (st.mode === "live") return `<span class="bus-live">● ${esc(t("bus.mode.live", "即時"))}</span> ${esc(t("bus.mode.live_note", "TDX 公車動態，{n} 台，{time} 更新", { n: st.count, time: st.asOf ? new Date(st.asOf).toLocaleTimeString(i18n.locale, { hour: "2-digit", minute: "2-digit", hour12: false }) : "—" }))}`;
    const why = { clock: t("bus.reason.clock", "時鐘不是現在"), "no-key": t("bus.reason.no_key", "尚未設定 TDX 金鑰"), quota: t("bus.reason.quota", "TDX 額度用完"), "no-api": t("bus.reason.no_api", "本機沒有 Worker"), offline: t("bus.reason.offline", "連不上即時資料"), error: t("bus.reason.error", "即時資料暫時無法取得") }[st.reason] ?? st.reason;
    return `<span class="bus-sim">○ ${esc(t("bus.mode.sim", "模擬"))}</span> ${esc(why)}`;
  };
  function busCard(b) {
    if (!b) return `<p class='muted'>${esc(t("bus.not_found", "這台公車已經離開地圖或收班了"))}</p>`;
    const kind = b.kind === "main" || b.kind === "loop" ? "" : `（${b.label}）`;
    return `<div class="eyebrow" style="color:${esc(b.color)}">${esc(b.trunk ? t("bus.eyebrow", "幹線公車") : t("bus.eyebrow_branch", "支線公車"))}</div><h2>${esc(routeName({ name: b.name, en: b.en }))}<small>${esc(b.from)} → ${esc(b.to)}${esc(kind)}</small></h2>
      <dl class="meta" id="bus-status">${busStatus(b)}</dl>
      <p>${routeChip(b.line)} ${b.visible ? `<button class="chip act" data-follow-bus="${b.index}">${esc(t("bus.follow", "跟著公車跑"))}</button> <button class="chip act" data-ride="bus" data-ride-index="${b.index}">🚌 ${esc(t("ride.board", "上車"))}</button>` : ""}</p>
      <p class="muted">${busModeLine()}</p>
      <p class="muted">${esc(t("bus.note2", "路線與站牌 © OpenStreetMap contributors（ODbL）；即時位置來自交通部 TDX。模擬時依路線長度配車，營運 06:00–22:30。"))}</p>`;
  }
  // 高速公路卡片：路名、台南境內里程、經過哪些區、依序的交流道（點了飛過去）
  function highwayCard(r) {
    if (!r) return `<p class='muted'>${esc(t("hw.not_found", "找不到這條公路"))}</p>`;
    const dists = [...new Set(r.samples.map((p) => world.districtAt(p.x, p.z)).filter(Boolean))].sort((a, b) => (islands.get(a)?.number ?? 99) - (islands.get(b)?.number ?? 99)).map((id) => islands.get(id)?.name).filter(Boolean); // 依區號（由北到南）
    const js = r.junctions.map((j) => `<li><button type="button" data-hwj="${j.i}">${esc(j.name)}${j.km ? `<span class="sub">${esc(t("hw.km_mark", "{km} K", { km: j.km }))}</span>` : ""}</button></li>`).join("");
    return `<div class="eyebrow" style="color:${esc(r.color)}">${esc(r.kind === "motorway" ? t("hw.eyebrow_freeway", "國道") : t("hw.eyebrow_expressway", "快速道路"))}</div><h2>${esc(r.label)}</h2>
      <dl class="meta"><dt>${esc(t("hw.length", "台南境內"))}</dt><dd>${esc(t("hw.km", "約 {n} 公里", { n: Math.round(r.km) }))}</dd>
        <dt>${esc(t("hw.cars", "地圖上"))}</dt><dd>${esc(t("hw.car_count", "{n} 台車（模擬）", { n: r.cars }))}</dd>
        <dt>${esc(t("hw.districts", "經過"))}</dt><dd>${esc(dists.join(sep))}</dd></dl>
      ${js ? `<h3>${esc(r.ns ? t("hw.junctions_ns", "交流道（由北到南）") : t("hw.junctions_we", "交流道（由西到東）"))}</h3><ol class="bus-stops">${js}</ol>` : ""}
      <p class="muted">${esc(t("hw.note", "路線與交流道 © OpenStreetMap contributors（ODbL）。車流是依時段模擬的，不是即時路況；橋段依 OSM 標示架高。"))}</p>`;
  }
  function carCard(c) {
    if (!c) return `<p class='muted'>${esc(t("hw.car_gone", "這台車已經開出地圖了"))}</p>`;
    const KIND = { car: t("hw.kind.car", "小客車"), truck: t("hw.kind.truck", "貨車"), semi: t("hw.kind.semi", "聯結車"), coach: t("hw.kind.coach", "客運") };
    const HEAD = { north: t("hw.head.north", "往北"), south: t("hw.head.south", "往南"), east: t("hw.head.east", "往東"), west: t("hw.head.west", "往西") };
    return `<div class="eyebrow">${esc(t("hw.car_eyebrow", "公路上的車"))}</div><h2>${esc(KIND[c.kind] ?? c.kind)}<small>${esc(c.routeLabel)}${c.link ? ` · ${esc(t("hw.on_ramp", "匝道"))}` : ""}</small></h2>
      <dl class="meta"><dt>${esc(t("hw.heading", "方向"))}</dt><dd>${esc(HEAD[c.heading] ?? "")}</dd></dl>
      <p><button class="chip act" data-follow-car="${c.i}">${esc(t("hw.follow", "跟著這台車"))}</button> <button class="chip" data-highway="${esc(c.route)}">${esc(t("hw.show_route", "看這條路"))}</button></p>
      <p class="muted">${esc(t("hw.car_note", "車流依時段模擬（尖峰多、半夜少），開出地圖或下了匝道就從其他入口重新進來。"))}</p>`;
  }
  function busRouteCard(id) {
    const r = buses.routeInfo(id);
    if (!r) return `<p class='muted'>${esc(t("bus.route_not_found", "找不到這條路線"))}</p>`;
    const KIND = { main: t("bus.kind.main", "正線"), loop: t("bus.kind.loop", "環狀"), detour: t("bus.kind.detour", "繞駛"), extension: t("bus.kind.extension", "延駛"), reserve: t("bus.kind.reserve", "預約"), special: t("bus.kind.special", "特殊班") };
    const pats = r.patterns.map((p) => `<details${p.kind === "main" && p.dir === 0 ? " open" : ""}><summary><b>${esc(p.from)} → ${esc(p.to)}</b> <span class="muted">${esc(KIND[p.kind] ?? p.kind)}${p.kind === "main" ? "" : ` · ${esc(p.label)}`} · ${esc(t("bus.stop_count", "{n} 站", { n: p.stops.length }))}</span></summary>
        <ol class="bus-stops">${p.stops.map((s) => `<li><button type="button" data-busstop="${s.id}">${esc(stopLabel(s))}</button></li>`).join("")}</ol></details>`).join("");
    const st = buses.status();
    return `<div class="eyebrow" style="color:${esc(r.hex)}">${esc(r.trunk ? t("bus.eyebrow", "幹線公車") : t("bus.eyebrow_branch", "支線公車"))}</div><h2>${esc(routeName(r))}<small>${esc(r.from)} ⇄ ${esc(r.to)}</small></h2>
      <dl class="meta"><dt>${esc(t("bus.on_map", "地圖上"))}</dt><dd>${esc(st.mode === "live" ? t("bus.live_count", "{n} 台行駛中（即時）", { n: r.liveCount }) : t("bus.sim_count", "{n} 台（模擬）", { n: r.buses }))}</dd></dl>
      <p class="muted">${busModeLine()}</p>
      <h3>${esc(t("bus.patterns", "行駛路線與站牌"))}</h3>${pats}
      <p class="muted">${esc(t("bus.route_note", "地上的實線虛線是正線（往返程各靠右）；細點線是繞駛、延駛。拉近畫面可以看到站牌。"))}</p>`;
  }
  // 山海景觀卡片：說明、即時狀態（今天有沒有雲海、是不是產季……）、重點、附近地標、出處
  const monthName = (m) => new Date(Date.UTC(2000, m - 1, 15)).toLocaleString(i18n.locale, { month: "short", timeZone: "UTC" });
  const monthsText = (list) => (list?.length ? list.map(monthName).join(sep) : "");
  function sceneryStatus(it) {
    const st = it.state || {};
    switch (it.kind) {
      case "clouds": return (st.today ? t("scenery.clouds.yes", "今天清晨有雲海") : t("scenery.clouds.no", "今天清晨沒有雲海")) + (st.live ? t("scenery.clouds.live", "（依現在的濕度與昨天雨量）") : t("scenery.clouds.guess", "（依月份推估）"));
      case "orchard": return st.flower ? t("scenery.orchard.flower", "花期中") : st.fruit ? t("scenery.orchard.fruit", "產季中，樹上結果了") : t("scenery.orchard.off", "現在不是產季");
      case "noodles": return st.drying ? t("scenery.noodles.on", "正在曬麵") : t("scenery.noodles.off", "現在沒有曬麵（下雨或不是白天）");
      case "caltrop": return (st.harvest ? t("scenery.caltrop.harvest", "採收中") : st.growing ? t("scenery.caltrop.grow", "菱角生長中") : t("scenery.caltrop.off", "休耕期")) + (st.jacanas ? t("scenery.caltrop.jacana", "，水雉在田裡") : "");
      case "harvest": return st.harvest ? t("scenery.harvest.on", "收割中") : t("scenery.harvest.off", "現在不是收割期");
      case "sugar": return st.milling ? t("scenery.sugar.on", "製糖期，煙囪冒煙中") : t("scenery.sugar.off", "現在不是製糖期");
      case "kilns": return st.baking ? t("scenery.kilns.on", "焙灶中") : t("scenery.kilns.off", "現在不是焙灶期");
      case "lotus": return fields.stageNow("lotus") || "";
      case "boat": return st.sailing ? t("scenery.boat.on", "遊艇出航中") : t("scenery.boat.off", "停在碼頭（假日 10:00、15:00，每天 13:30 出航）");
      case "trail": return st.hiking ? t("scenery.trail.on", "有人在健行") : t("scenery.trail.off", "天黑或下雨，步道上沒人");
      case "beehives": return st.flowering ? t("scenery.beehives.on", "龍眼花期，蜜蜂採蜜中") : t("scenery.beehives.off", "現在不是龍眼花期");
      case "wetland": return st.birds ? t("scenery.wetland.on", "黑面琵鷺在這裡度冬") : t("scenery.wetland.off", "黑面琵鷺已北返（10 月再來）");
      case "peak": return t("scenery.peak.elevation", "海拔 {m} 公尺", { m: it.elevation.toLocaleString(i18n.locale) });
      case "stars": return st.visible ? t("scenery.stars.on", "現在看得到星星") : t("scenery.stars.off", "入夜、天氣晴朗時才看得到");
      default: return "";
    }
  }
  function sceneryCard(id) {
    const it = scenery.info(id);
    if (!it) return `<p class='muted'>${esc(t("scenery.not_found", "找不到這個景觀"))}</p>`;
    const a = sceneryAnchor(it.anchor), status = sceneryStatus(it);
    const anchorBtn = !a ? "" : a.type === "poi" ? `<button class="chip" data-poi="${esc(a.id)}">${esc(pois.get(a.id)?.name || "")}</button>` : `<button class="chip" data-building="${esc(a.id)}">${esc(buildings.get(a.id)?.name || "")}</button>`;
    const monthsKey = { sugar: ["scenery.sugar_months", "製糖期 {m}"], wetland: ["scenery.winter_months", "度冬 {m}"] }[it.kind] ?? ["scenery.best_months", "最佳 {m}"];
    const season = it.fruitMonths || it.months || it.harvestMonths ? `<dt>${esc(t("scenery.season", "季節"))}</dt><dd>${esc([it.flowerMonths ? t("scenery.flower_months", "花期 {m}", { m: monthsText(it.flowerMonths) }) : "", it.fruitMonths ? t("scenery.fruit_months", "果期 {m}", { m: monthsText(it.fruitMonths) }) : "", it.months ? t(monthsKey[0], monthsKey[1], { m: monthsText(it.months) }) : "", it.harvestMonths ? t("scenery.harvest_months", "採收 {m}", { m: monthsText(it.harvestMonths) }) : ""].filter(Boolean).join(sep))}</dd>` : "";
    const src = (it.source || []).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t("scenery.source_n", "出處 {n}", { n: i + 1 }))}</a>`).join(" ");
    return `<div class="eyebrow">${esc(t("scenery.eyebrow", "山海景觀"))}</div><h2>${esc(it.icon)} ${esc(it.name)}${status ? `<small>${esc(status)}</small>` : ""}</h2><p>${esc(it.desc)}</p>
      <ul class="facts">${(it.facts || []).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      <dl class="meta">${season}${anchorBtn ? `<dt>${esc(t("scenery.near", "附近地標"))}</dt><dd>${anchorBtn}</dd>` : ""}</dl>
      ${it.note ? `<p class="muted">${esc(it.note)}</p>` : ""}<p class="muted">${src}</p>`;
  }
  function monkeyCard(id) {
    const m = monkeys.info(id), d = sceneryData.monkeys;
    if (!m) return `<p class='muted'>${esc(t("scenery.not_found", "找不到這個景觀"))}</p>`;
    return `<div class="eyebrow">${esc(t("monkey.eyebrow", "找獼猴"))}</div><h2>🐒 ${esc(d.name)}<small>${esc(m.found ? t("monkey.got", "已找到") : t("monkey.not_yet", "還沒找到"))}</small></h2><p>${esc(d.desc)}</p>
      <dl class="meta"><dt>${esc(t("poi.district", "所在區"))}</dt><dd>${m.district ? islandBtn(m.district) : "—"}</dd></dl>
      <p class="muted">${esc(m.verified ? t("monkey.verified", "這群在南化烏山獼猴區，是查證過的棲地。") : t("monkey.sketch", "位置是依山區分布示意，不是實際觀察紀錄。"))} ${(d.source || []).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t("scenery.source_n", "出處 {n}", { n: i + 1 }))}</a>`).join(" ")}</p>
      <p>${esc(t("monkey.progress", "已找到 {n}/{total} 群，從「🎮 玩」→「找獼猴」看各區還剩幾群。", { n: monkeys.count, total: monkeys.total }))}</p>`;
  }
  const sceneryChips = (u) => {
    const list = scenery.anchoredTo(u.type, u.id, (pair) => buildingIdOf(pair));
    return list.length ? `<h3>${esc(t("scenery.nearby", "附近景觀"))}</h3><p>${list.map((it) => `<button class="chip" data-scenery="${esc(it.id)}">${esc(it.icon)} ${esc(it.name)}</button>`).join(" ")}</p>` : "";
  };
  function busStopCard(i) {
    const s = buses.stopInfo(i);
    if (!s) return `<p class='muted'>${esc(t("bus.stop_not_found", "找不到這個站牌"))}</p>`;
    const id = world.districtAt(s.x, s.z);
    return `<div class="eyebrow">${esc(t("bus.stop_eyebrow", "公車站牌"))}</div><h2>${esc(stopLabel(s))}${i18n.lang !== "zh" && s.en ? `<small>${esc(s.name)}</small>` : ""}</h2>
      <dl class="meta">${id ? `<dt>${esc(t("poi.district", "所在區"))}</dt><dd>${islandBtn(id)}</dd>` : ""}<dt>${esc(t("bus.stop_routes", "經過路線"))}</dt><dd>${s.routes.map(routeChip).join(" ")}</dd></dl>
      <p class="muted">${esc(t("bus.stop_note", "只列出地圖上已載入的路線；打開側欄的顏色開關可以載入支線。"))}</p>`;
  }
  // bus.js 給的 heading 是「往＋終點」，這裡只把「往」換成翻譯
  const busHeading = (b) => (typeof b.heading === "string" && b.heading.startsWith("往") ? t("bus.heading", "往{dest}", { dest: b.heading.slice(1) }) : b.heading);
  const busStatus = (b) => b.visible
    ? `<dt>${esc(t("bus.direction", "方向"))}</dt><dd>${esc(busHeading(b))}</dd><dt>${esc(t("bus.next_stop", "下一站"))}</dt><dd>${esc(b.nextStop || "—")}</dd>`
      + (b.live ? `<dt>${esc(t("bus.plate", "車牌"))}</dt><dd>${esc(b.live.plate)}</dd><dt>${esc(t("bus.gps", "GPS 時間"))}</dt><dd>${esc(new Date(b.live.gps).toLocaleTimeString(i18n.locale, { hour12: false }))}${b.live.speed != null ? ` · ${esc(t("bus.speed", "{v} km/h", { v: Math.round(b.live.speed) }))}` : ""}${b.live.offRoute ? ` · ${esc(t("bus.off_route", "不在路線上"))}` : ""}</dd>` : "")
    : `<dt>${esc(t("bus.status", "狀態"))}</dt><dd>${esc(t("bus.closed", "已收班（營運 06:00–22:30）"))}</dd>`;
  function trailCard(trail) {
    const kind = trail.kind === "greenway" ? t("trail.kind.greenway", "國家綠道") : t("trail.kind.bikeway", "自行車道");
    return `<div class="eyebrow">${esc(kind)}</div><h2>${esc(trail.name)}<small>${esc(t("trail.length_sub", "約 {km} 公里（地圖範圍內）", { km: trail.lengthKm }))}</small></h2>
      <p>${esc(trail.desc)}</p>
      <dl class="meta"><dt>${esc(t("trail.kind", "種類"))}</dt><dd>${esc(kind)}</dd><dt>${esc(t("trail.length", "長度"))}</dt><dd>${trail.lengthKm} km</dd><dt>${esc(t("trail.segments", "路段"))}</dt><dd>${esc(t("trail.segments.value", "{n} 段", { n: trail.segments.length }))}</dd></dl>
      <p>${mapLink(zh(trail))}</p>
      <p class="muted">${esc(t("trail.note", "騎士 06:00–19:00 沿線來回。路線幾何來自 OpenStreetMap（ODbL），長度是地圖範圍內的近似值。"))}</p>`;
  }
  function sugarCard(ln, st) {
    const stops = ln.stops.map((s) => esc(s.name)).join(" ⇄ ");
    return `<div class="eyebrow">${esc(t("sugar.eyebrow", "糖鐵觀光五分車"))}</div><h2>${esc(ln.name)}<small>${esc(t("sugar.sub", "烏樹林糖廠・762mm 窄軌"))}</small></h2>
      <dl class="meta"><dt>${esc(t("poi.district", "所在區"))}</dt><dd>${islandBtn(ln.district)}</dd><dt>${esc(t("sugar.route", "路線"))}</dt><dd>${stops}</dd><dt>${esc(t("sugar.hours", "營運時間"))}</dt><dd>${esc(t("sugar.hours.value", "09:00–16:30（{status}）", { status: st?.visible ? t("sugar.running", "行駛中") : t("sugar.parked", "收班，停在烏樹林車站") }))}</dd></dl>
      <p>${esc(ln.desc)}</p>
      ${st?.visible ? `<p><button class="chip act" data-ride="sugar" data-ride-index="0">🚂 ${esc(t("ride.board", "上車"))}</button></p>` : ""}
      <p>${mapLink("烏樹林糖廠", ln.district)}</p>
      <p class="muted">${esc(t("sugar.note", "軌道取自 OpenStreetMap（ODbL），終點新頂埤為近似位置；到端點停一會兒再折返。"))}</p>`;
  }
  // 水位計：左邊直條是有效蓄水量占有效容量的比例（顏色同地圖小牌），右邊列水位、滿水位、呆水位與蓄水量
  function reservoirGauge(lv) {
    if (lv.percent == null) return "";
    const m = (v) => (v == null ? "—" : `${(+v).toLocaleString(i18n.locale, { maximumFractionDigits: 2 })} ${t("reservoir.unit_m", "公尺")}`);
    const w = (v) => (v == null ? "—" : (+v).toLocaleString(i18n.locale, { maximumFractionDigits: 0 }));
    const rows = [[t("reservoir.level", "目前水位"), m(lv.level)], [t("reservoir.full", "滿水位"), m(lv.full)], [t("reservoir.dead", "呆水位"), m(lv.dead)]];
    if (lv.storage != null) rows.push([t("reservoir.storage", "有效蓄水量"), t("reservoir.storage_of", "{s} / {c} 萬立方公尺", { s: w(lv.storage), c: w(lv.capacity) })]);
    const below = lv.level != null && lv.full != null ? lv.full - lv.level : null;
    return `<div class="rsv-gauge ${levelClass(lv.percent)}"><div class="rsv-tank" role="img" aria-label="${esc(t("reservoir.percent_sub", "蓄水率 {pct}", { pct: `${lv.percent.toFixed(1)}%` }))}">
        <div class="rsv-water" style="height:${Math.max(2, Math.min(100, lv.percent))}%"></div><span class="rsv-mark" style="bottom:50%">50%</span><b>${Math.round(lv.percent)}%</b></div>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      ${below != null ? `<p class="muted">${esc(below <= 0.05 ? t("reservoir.at_full", "已達滿水位") : t("reservoir.below_full", "距滿水位 {m}", { m: m(below) }))}</p>` : ""}</div>`;
  }
  // 蓄水資訊：沒有錨點建築的水庫單獨成卡，有錨點的放進建築／景點卡片（data-rsv-section，資料更新時整段換掉）
  function reservoirCard(name) {
    const lv = reservoirs.levels()[name] || {};
    const pct = lv.percent == null ? "—" : `${lv.percent.toFixed(1)}%`;
    return `<div class="eyebrow">${esc(t("reservoir.eyebrow", "水庫"))}</div><h2>${esc(name)}<small>${esc(t("reservoir.percent_sub", "蓄水率 {pct}", { pct }))}</small></h2>
      ${reservoirBody(name)}<p>${mapLink(name)}</p>`;
  }
  function reservoirSection(name) {
    if (!name) return "";
    const lv = reservoirs.levels()[name] || {};
    const pct = lv.percent == null ? "—" : `${lv.percent.toFixed(1)}%`;
    return `<div class="rsv-section" data-rsv-section="${esc(name)}"><h3>${esc(t("reservoir.section", "💧 {name}即時蓄水", { name: t(`reservoir.name.${name}`, name) }))}<small> ${esc(t("reservoir.percent_sub", "蓄水率 {pct}", { pct }))}</small></h3>${reservoirBody(name)}</div>`;
  }
  function reservoirBody(name) {
    const lv = reservoirs.levels()[name] || {};
    const pct = lv.percent == null ? "—" : `${lv.percent.toFixed(1)}%`;
    const when = lv.source === "dev" ? t("reservoir.source.dev", "測試值") : lv.asOf ? new Date(lv.asOf).toLocaleString(i18n.locale, { hour12: false }) : "—";
    const src = lv.source === "wra" ? `<a href="https://data.gov.tw/dataset/45501" target="_blank" rel="noopener noreferrer">${esc(t("reservoir.source.wra", "水利署開放資料（每小時）"))}</a>` : lv.source === "dev" ? esc(t("reservoir.source.dev", "測試值")) : `${esc(t("reservoir.source.fallback", "備援資料"))}${lv.url ? t("reservoir.source.link", "（{link}）", { link: `<a href="${esc(lv.url)}" target="_blank" rel="noopener noreferrer">${esc(t("reservoir.source.link_text", "出處"))}</a>` }) : ""}`;
    const schematic = reservoirs.places().find((r) => r.name === name)?.schematic;
    return `${reservoirGauge(lv)}
      <dl class="meta">${lv.percent == null ? `<dt>${esc(t("reservoir.percent", "蓄水率"))}</dt><dd>${pct}</dd>` : ""}<dt>${esc(t("reservoir.asof", "資料時間"))}</dt><dd>${esc(when)}</dd><dt>${esc(t("reservoir.source", "來源"))}</dt><dd>${src}</dd></dl>
      ${lv.percent == null ? `<p class='muted'>${esc(t("reservoir.no_data", "這座水庫沒有公開的即時蓄水率。"))}</p>` : `<p class='muted'>${esc(t("reservoir.scale_note", "水面大小依蓄水率縮放：滿水位時最大，枯水期縮小。"))}</p>`}
      ${schematic ? `<p class='muted'>${esc(t("reservoir.schematic_note", "地圖上的湖面是縮小的示意：曾文水庫的蓄水區大多在嘉義縣大埔鄉，入口與管理中心在楠西。"))}</p>` : ""}`;
  }
  const cropStage = (c) => t("field.crop_stage", "{crop}（{stage}）", { crop: esc(c.crop), stage: esc(c.stage) });
  function fieldCard(f) {
    const all = fields.stageOf(f.district);
    return `<div class="eyebrow">${esc(t("field.eyebrow", "農田"))}</div><h2>${esc(f.crop)}<small>${esc(f.stage)}</small></h2>
      <dl class="meta"><dt>${esc(t("poi.district", "所在區"))}</dt><dd>${islandBtn(f.district)}</dd><dt>${esc(t("field.crops", "本區作物"))}</dt><dd>${all.map((c) => cropStage(c)).join(sep)}</dd></dl>
      <p class="muted">${esc(t("field.note", "田色隨產季與日期變化；田地位置為區內示意，不是真實座標。"))}</p>`;
  }
  function poiCard(p) {
    const [label] = POI_TYPE[p.type];
    const days = p.type === "nightmarket" ? `<dt>${esc(t("poi.days", "營業日"))}</dt><dd>${(p.days || []).map((d) => esc(t("weekday.prefix", "週{d}", { d: weekdayName(d) }))).join(sep)}${p.open ? `<b class='open'>${esc(t("poi.open_today", "當天營業"))}</b>` : `<span class='muted'>${esc(t("poi.closed_today", "當天休市"))}</span>`}</dd>` : "";
    return `<div class="eyebrow">${esc(label)}</div><h2>${esc(p.name)}</h2><p>${esc(p.desc)}</p>
      <dl class="meta"><dt>${esc(t("poi.district", "所在區"))}</dt><dd>${islandBtn(p.district)}</dd>${days}</dl>
      <p>${tripBtn("poi", p.id)} ${mapLink(zh(p), p.district)}</p><p class="muted">${esc(t("poi.coords_note", "座標為近似值。"))}</p>
      ${reservoirSection(rsvOf.get(`poi:${p.id}`))}`;
  }
  function walkerCard(u) {
    const { calDate, minute } = now();
    const w = people.info(u.id);
    if (!w) return "";
    // 市民對話：依時間、天氣、所在區今天的活動拼三句泡泡
    const ctx = { minute, raining: !!weather.current().rain, eventName: fx.events.find((e) => e.district === w.at && isActive(e.schedule, calDate))?.name ?? null };
    const talkHtml = talk.bubbleHtml(talk.linesFor(w, ctx));
    const f = w.flow ? flows.get(w.flow) : null;
    const role = roles.roles[w.role] || { label: w.role, description: "" };
    const age = { elder: t("age.elder", "65 歲以上"), child: t("age.child", "14 歲以下"), adult: t("age.adult", "15～64 歲") }[w.age] || "—";
    return `${talkHtml}<div class="eyebrow">${f ? t("walker.eyebrow.flow", "動線行人 · {id}", { id: esc(f.id) }) : esc(t("walker.eyebrow.citizen", "市民"))}</div><h2>${esc(w.name)}<small>${esc(role.label)}</small></h2>
      <p>${esc(role.description)}</p>
      <dl class="meta"><dt>${esc(t("walker.home", "住在"))}</dt><dd>${islandBtn(w.home)}</dd><dt>${esc(t("age.label", "年齡層"))}</dt><dd>${esc(age)}</dd><dt>${esc(t("walker.now", "現在"))}</dt><dd id="walker-status">${walkerStatus(w)}</dd>${w.carry ? `<dt>${esc(t("walker.carry", "提著"))}</dt><dd><button type="button" class="spec" data-spec="${esc(w.carry.key)}">${esc(w.carry.icon)} ${esc(t("walker.carry_item", "{district}的{name}", { district: islands.get(w.carry.district)?.name || "", name: w.carry.name }))}</button></dd>` : ""}</dl>
      <p><button class="chip act" data-follow-walker="${u.id}">${esc(t("walker.follow", "跟著他走"))}</button></p>
      ${f ? `<h3>${esc(t("section.walker_flow", "所屬動線"))}</h3><p>${esc(f.text)}</p><p>${islandBtn(f.from)} ⇄ ${islandBtn(f.to)}</p>` : ""}
      <p class="muted">${esc(t("walker.path_note", "地面上的黑線是這個人目前的路線。"))}</p>`;
  }

  return { islandBtn, islandCard, buildingCard, pinCard, myPinCard, walkerStatus, stationCard, eventCard, routeName, busModeLine, busCard, highwayCard, carCard, busRouteCard, sceneryStatus, sceneryCard, monkeyCard, sceneryChips, busStopCard, busStatus, trailCard, sugarCard, reservoirCard, reservoirSection, fieldCard, poiCard, walkerCard };
}
