// 台鐵、高鐵照真實班表跑：時鐘在「現在」時向 /api/rail 要當天時刻表（Worker 一天向 TDX 抓一次）與台鐵誤點（5 分鐘一次），
// 換成「沿路線的距離 s＋時刻」交給 train.js 的 setSchedule；抓不到就照原本的模擬跑。
//   台鐵：班表的站碼對到 rail.json 的車站，誤點分鐘整班往後延（TrainLiveBoard 只給最後經過的車站，站與站之間用時刻表內插）
//   高鐵：只有台南站的到離站時間，進出台南用平均 4 km/分鐘往前後推（TDX 沒有高鐵即時位置，也不含誤點）
// createRail({ trains, hsr, stationIds, unitsPerKm, fetchJson }) → { setLive(on), upcoming(stationId, minute, n), status() }
const POLL_MS = 5 * 60 * 1000;
export const TRA_CODE = { houbi: "4110", xinying: "4120", liuying: "4130", linfengying: "4140", longtian: "4150", balin: "4160", shanhua: "4170", nanke: "4180", xinshi: "4190",
  yongkang: "4200", daqiao: "4210", tainan: "4220", baoan: "4250", rende: "4260", zhongzhou: "4270", changrong: "4271", shalun: "4272" }; // 臺鐵官方站碼
const HSR_KM_PER_MIN = 4, HSR_SPAN_KM = 60; // 高鐵進出台南：每分鐘約 4 公里，前後各推 60 公里（超出地圖就不畫）

// /api/rail 的回應 → 兩組 setSchedule 用的班表
export function buildSchedules(d, { traS, hsrS, unitsPerKm }) {
  const delays = d.delays?.ok ? d.delays.delays : {};
  const tra = !d.tra?.ok ? [] : d.tra.trains.map((t) => {
    const late = delays[t.no] ?? 0;
    const stops = t.stops.filter(([code]) => traS.has(code)).map(([code, arr, dep]) => ({ code, s: traS.get(code), arr: arr + late, dep: dep + late }));
    return { no: t.no, label: `${t.type}${t.no}`, type: t.type, dest: t.dest, late, stops };
  }).filter((e) => e.stops.length >= 2);
  const span = HSR_SPAN_KM * unitsPerKm, mins = HSR_SPAN_KM / HSR_KM_PER_MIN;
  const hsr = !d.thsr?.ok || hsrS == null ? [] : d.thsr.trains.map((t) => {
    const sgn = t.dir === 1 ? -1 : 1; // 南下沿路線 s 遞增（路線由北往南畫）
    return { no: t.no, label: t.no, dest: t.dest, dir: t.dir, stops: [{ s: hsrS - sgn * span, arr: t.arr - mins, dep: t.arr - mins }, { s: hsrS, arr: t.arr, dep: t.dep }, { s: hsrS + sgn * span, arr: t.dep + mins, dep: t.dep + mins }] };
  });
  return { tra, hsr };
}

export function createRail({ trains, hsr, stationIds = [], unitsPerKm = 1, fetchJson = (u) => fetch(u, { cache: "no-store" }).then((r) => r.json()) } = {}) {
  const traStop = trains.stopDistances(0), traS = new Map();
  stationIds.forEach((id, i) => { if (TRA_CODE[id] && traStop[i] != null) traS.set(TRA_CODE[id], traStop[i]); });
  const hsrS = hsr.stopDistances(0)[1] ?? null; // 高鐵路線的第 2 個停靠點是台南站（data/hsr.json）
  let wanted = false, timer = 0, sched = { tra: [], hsr: [] }, status = { mode: "sim", reason: "clock" };

  async function poll() {
    try {
      const d = await fetchJson("/api/rail");
      if (!wanted) return;
      sched = buildSchedules(d, { traS, hsrS, unitsPerKm });
      trains.setSchedule(sched.tra.length ? sched.tra : null);
      hsr.setSchedule(sched.hsr.length ? sched.hsr : null);
      status = { mode: sched.tra.length || sched.hsr.length ? "live" : "sim", reason: d.tra?.ok ? null : d.tra?.code || "error", tra: { ok: !!sched.tra.length, code: d.tra?.code }, hsr: { ok: !!sched.hsr.length, code: d.thsr?.code }, delays: d.delays?.ok ? { asOf: d.delays.asOf } : { code: d.delays?.code } };
    } catch {
      if (!wanted) return;
      status = { mode: "sim", reason: "offline" };
    }
  }
  function setLive(on) {
    if (on === wanted) return;
    wanted = on;
    clearInterval(timer);
    if (on) { poll(); timer = setInterval(() => { if (document.visibilityState === "visible") poll(); }, POLL_MS); }
    else { sched = { tra: [], hsr: [] }; trains.setSchedule(null); hsr.setSchedule(null); status = { mode: "sim", reason: "clock" }; }
  }
  // 某站接下來的班次（已含誤點）：[{ label, dest, time, late, kind }]；台南的沙崙站一併列高鐵台南站
  function upcoming(stationId, minute, n = 5) {
    const code = TRA_CODE[stationId], out = [];
    for (const e of sched.tra) for (const st of e.stops) if (st.code === code && st.dep >= minute - 0.5) out.push({ label: e.label, dest: e.dest, time: st.dep, late: e.late, kind: "tra" });
    if (stationId === "shalun") for (const e of sched.hsr) if (e.stops[1].dep >= minute - 0.5) out.push({ label: e.label, dest: e.dest, time: e.stops[1].dep, late: null, kind: "hsr" });
    return out.sort((a, b) => a.time - b.time).slice(0, n);
  }
  return { setLive, upcoming, status: () => status };
}
