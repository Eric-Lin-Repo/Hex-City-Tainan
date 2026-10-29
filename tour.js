// 導覽：依序飛到幾個地點並切換時段，字幕在下方；用 performance.now() 計時，暫停時凍結剩餘秒數。
// 主題導覽的路線都在 data/tours.json，TOUR 指向目前這條的 cues；離開導覽時把為了活動切過的日期還原。
// createTour({ t, esc, tours, eventsById, select, setDate, setMinute, stopPlay, setSidebar, toast, syncUrl, speech, speechOn, now })
//   now() → { calDate }、speechOn() → 是否朗讀字幕：app.js 的狀態會變，用到時才讀
//   → { on, start(i, id), end(), update(), setPaused(p) }
import { eventDateIn, isActive } from "./calendar.js";

const $ = (s) => document.querySelector(s);

export function createTour({ t, esc, tours, eventsById, select, setDate, setMinute, stopPlay, setSidebar, toast, syncUrl, speech, speechOn, now }) {
  const TOURS = tours, tourById = new Map(TOURS.map((tr) => [tr.id, tr]));
  let TOUR = TOURS[0].cues, tourId = TOURS[0].id;
  const tourEl = $("#tour"), tourCaption = $("#tour-caption"), tourCount = $("#tour-count"), tourPauseBtn = $("#tour-pause"), tourBar = $("#tour-progress"), tourStartBtn = $("#tour-start");
  const tour = { on: false, i: 0, paused: false, deadline: 0, remaining: 0, savedDate: null };
  const setUrlParam = (k, v) => { const q = new URLSearchParams(location.search); if (v == null) q.delete(k); else q.set(k, v); history.replaceState(null, "", `${location.pathname}?${q}`); };
  function tourSetPaused(p) {
    if (tour.paused === p) return;
    tour.paused = p;
    if (p) tour.remaining = Math.max(0, tour.deadline - performance.now());
    else tour.deadline = performance.now() + tour.remaining;
    tourPauseBtn.textContent = p ? t("tour.resume", "繼續") : t("tour.pause", "暫停");
    tourPauseBtn.setAttribute("aria-pressed", String(p));
  }
  function tourShow(i) {
    const { calDate } = now();
    const cue = TOUR[i];
    tour.i = i;
    if (cue.sel) select(cue.sel);
    else $("#home").click();
    if (cue.eventDate && cue.sel?.type === "event") { // 把日曆切到活動當天，效果才會出現；離開導覽時還原
      const e = eventsById.get(cue.sel.id), d = e && eventDateIn(e.schedule, calDate.getUTCFullYear());
      if (d && !isActive(e.schedule, calDate)) { tour.savedDate ??= calDate; setDate(d); }
    }
    setMinute(cue.minute);
    tourCaption.textContent = cue.caption;
    if (speechOn()) speech.speakText(cue.caption);
    tourCount.textContent = `${i + 1} / ${TOUR.length}`;
    tourBar.style.width = "0%";
    tour.remaining = cue.seconds * 1000;
    tour.deadline = performance.now() + tour.remaining;
    tourSetPaused(false);
  }
  function startTour(i = 0, id = tourId) {
    if (tour.on) return;
    const tr = tourById.get(id) || TOURS[0];
    TOUR = tr.cues; tourId = tr.id;
    tour.on = true;
    tour.savedDate = null;
    stopPlay();
    tourMenu.hidden = true;
    document.body.classList.add("touring");
    tourEl.hidden = false;
    tourStartBtn.setAttribute("aria-pressed", "true");
    tourStartBtn.setAttribute("aria-expanded", "false");
    setSidebar(false);
    setUrlParam("tour", tr.id);
    toast(`${tr.icon} ${tr.name}`);
    tourShow(i);
  }
  function endTour() {
    speech.stop();
    if (!tour.on) return;
    tour.on = false;
    tourSetPaused(false);
    document.body.classList.remove("touring");
    tourEl.hidden = true;
    tourStartBtn.setAttribute("aria-pressed", "false");
    if (tour.savedDate) { setDate(tour.savedDate); tour.savedDate = null; }
    setUrlParam("tour", null);
    syncUrl();
  }
  function updateTour() {
    if (!tour.on) return;
    if (!tour.paused) {
      tour.remaining = tour.deadline - performance.now();
      if (tour.remaining <= 0) {
        if (tour.i + 1 < TOUR.length) tourShow(tour.i + 1);
        else endTour();
        return;
      }
    }
    tourBar.style.width = `${(100 * (1 - tour.remaining / (TOUR[tour.i].seconds * 1000))).toFixed(1)}%`;
  }
  // 導覽鈕：導覽中按下就結束；否則打開主題選單
  const tourMenu = $("#tour-menu");
  tourMenu.innerHTML = TOURS.map((tr) => `<button type="button" data-tour="${esc(tr.id)}"><b>${esc(tr.icon)} ${esc(tr.name)}</b><span>${esc(tr.blurb)}</span></button>`).join("");
  const setTourMenu = (open) => { tourMenu.hidden = !open; tourStartBtn.setAttribute("aria-expanded", String(open)); };
  tourStartBtn.addEventListener("click", () => (tour.on ? endTour() : setTourMenu(tourMenu.hidden)));
  tourMenu.addEventListener("click", (e) => { const b = e.target.closest("[data-tour]"); if (b) startTour(0, b.dataset.tour); });
  document.addEventListener("pointerdown", (e) => { if (!tourMenu.hidden && !tourMenu.contains(e.target) && e.target !== tourStartBtn) setTourMenu(false); });
  tourPauseBtn.addEventListener("click", () => tourSetPaused(!tour.paused));
  $("#tour-prev").addEventListener("click", () => tourShow((tour.i - 1 + TOUR.length) % TOUR.length));
  $("#tour-next").addEventListener("click", () => tourShow((tour.i + 1) % TOUR.length));
  $("#tour-exit").addEventListener("click", endTour);

  return { get on() { return tour.on; }, start: startTour, end: endTour, update: updateTour, setPaused: tourSetPaused };
}
