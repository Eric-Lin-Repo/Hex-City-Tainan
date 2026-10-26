// 農曆換算與活動排程。農曆用瀏覽器內建的 Intl 中國農曆，不需查表。
// 排程寫法：{ lunar:[月,日] } 或 { solar:[月,日] }，window 為前後天數；solar 可加 solarEnd:[月,日] 表示區間；
// 可以是單一物件或陣列（多段，例如去程與回程）。
const fmt = new Intl.DateTimeFormat("en-u-ca-chinese", { month: "numeric", day: "numeric", timeZone: "Asia/Taipei" });
const DAY = 86400000;

export function lunarOf(date) {
  const parts = fmt.formatToParts(date);
  const m = parts.find((p) => p.type === "month")?.value ?? "1";
  const d = parts.find((p) => p.type === "day")?.value ?? "1";
  return { month: parseInt(m, 10), leap: /[^0-9]/.test(m), day: parseInt(d, 10) };
}
export const lunarLabel = (date) => { const l = lunarOf(date); return `農曆${l.leap ? "閏" : ""}${l.month}月${l.day}日`; };

// 在某西元年找出對應農曆月日的日期（略過閏月）
export function gregorianOfLunar(year, month, day) {
  for (let t = Date.UTC(year, 0, 1); t <= Date.UTC(year, 11, 31); t += DAY) {
    const l = lunarOf(new Date(t));
    if (l.month === month && l.day === day && !l.leap) return new Date(t);
  }
  return null;
}
const list = (schedule) => (Array.isArray(schedule) ? schedule : [schedule]);
const years = (s, year) => !s.everyYears || ((((year - s.anchor) % s.everyYears) + s.everyYears) % s.everyYears === 0);

// 某西元年內的各段區間 [{start, end, label, index}]
export function occurrencesIn(schedule, year) {
  const out = [];
  list(schedule).forEach((s, index) => {
    if (!years(s, year)) return;
    let start, end;
    if (s.solar) {
      start = new Date(Date.UTC(year, s.solar[0] - 1, s.solar[1]));
      end = s.solarEnd ? new Date(Date.UTC(year, s.solarEnd[0] - 1, s.solarEnd[1])) : start;
    } else {
      const d = gregorianOfLunar(year, s.lunar[0], s.lunar[1]);
      if (!d) return;
      start = end = d;
    }
    const w = (s.window ?? (s.solarEnd ? 0 : 1)) * DAY;
    out.push({ start: new Date(start - w), end: new Date(+end + w), date: start, label: s.label || "", index });
  });
  return out.sort((a, b) => a.start - b.start);
}
// 相容舊呼叫：今年第一段的日期
export const eventDateIn = (schedule, year) => occurrencesIn(schedule, year)[0]?.date ?? null;
export function nextOccurrence(schedule, from) {
  for (let y = from.getUTCFullYear(); y < from.getUTCFullYear() + 6; y++) {
    const o = occurrencesIn(schedule, y).find((r) => r.end >= from);
    if (o) return o.date >= from ? o.date : o.start;
  }
  return null;
}
// 目前進行中的段（沒有就 null）
export const activeOccurrence = (schedule, date) => {
  const y = date.getUTCFullYear();
  return [...occurrencesIn(schedule, y - 1), ...occurrencesIn(schedule, y)].find((r) => date >= r.start && date <= r.end) || null;
};
export const isActive = (schedule, date) => !!activeOccurrence(schedule, date);
export const fmtDate = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
export const fmtRange = (o) => (o.start.getTime() === o.end.getTime() ? fmtDate(o.start) : `${fmtDate(o.start)} 到 ${fmtDate(o.end)}`) + (o.label ? `（${o.label}）` : "");
