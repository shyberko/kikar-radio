/** Pure helpers shared by the static UI and the Node jobs. No DOM, no secrets. */

export const JERUSALEM = "Asia/Jerusalem";

export const PLAYLISTS = {
  briefs: { key: "briefs", name: "כיכר אוטו – מבזקים", short: "מבזקים" },
  music: { key: "music", name: "כיכר אוטו – מוזיקה", short: "מוזיקה" },
  bulletin: { key: "bulletin", name: "כיכר אוטו – מבזק שעתי", short: "מבזק שעתי" },
};

export const MANAGED_PREFIX = "כיכר אוטו";
export const MANAGED_MARKER = "managed-by:kikar-radio";
export const PROTECTED_PLAYLIST = "election";

export const ERROR_TEXT = {
  download: "לא הצלחנו להוריד את הקובץ מהמקור. ייתכן שהקישור ב־RSS כבר לא פעיל.",
  conversion: "ההמרה ל־MP3 נכשלה. ייתכן שהקובץ המקורי פגום.",
  auth: "מפתח ה־API של הרדיו לא תקף או שפג תוקפו.",
  storage: "אין מספיק מקום בשרת הרדיו.",
  playlist: "הפלייליסט לא נמצא. אולי נמחק או ששמו שונה.",
  github: "GitHub הגביל את ההרצות כרגע. ננסה שוב בהרצה הבאה.",
  timeout: "ההעלאה לקחה יותר מדי זמן ונעצרה.",
  unknown: "משהו השתבש בהעלאה.",
};

const WEEKDAY_EN = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const HE_DAYS = ["יום א׳", "יום ב׳", "יום ג׳", "יום ד׳", "יום ה׳", "יום ו׳", "שבת"];

export function parseIsoDuration(iso) {
  if (!iso || typeof iso !== "string") return null;
  const m = iso.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (!m) return null;
  if (!m[1] && !m[2] && !m[3] && !m[4]) return null;
  return Math.round((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0));
}

export function formatDuration(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return "";
  let s = Math.max(0, Math.round(Number(sec)));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function jerusalemParts(date) {
  const d = date instanceof Date ? date : new Date(date);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: JERUSALEM,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const map = {};
  for (const p of fmt.formatToParts(d)) map[p.type] = p.value;
  return {
    year: +map.year,
    month: +map.month,
    day: +map.day,
    hour: +map.hour,
    minute: +map.minute,
    second: +map.second,
    weekday: WEEKDAY_EN[map.weekday] ?? 0,
  };
}

/** Wall-clock time in Asia/Jerusalem → UTC Date. */
export function jerusalemToUtc(y, m, d, hh = 0, mm = 0, ss = 0) {
  let utc = Date.UTC(y, m - 1, d, hh - 2, mm, ss);
  for (let i = 0; i < 4; i++) {
    const parts = jerusalemParts(new Date(utc));
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const desired = Date.UTC(y, m - 1, d, hh, mm, ss);
    const diff = desired - asUtc;
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc);
}

export function startOfJerusalemDay(date) {
  const p = jerusalemParts(date);
  return jerusalemToUtc(p.year, p.month, p.day, 0, 0, 0);
}

export function endOfJerusalemDay(date) {
  const p = jerusalemParts(date);
  return jerusalemToUtc(p.year, p.month, p.day, 23, 59, 59);
}

export function addCalendarDays(y, m, d, days) {
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function hebrewWeekday(date) {
  return HE_DAYS[jerusalemParts(date).weekday];
}

export function formatShortDate(date) {
  const p = jerusalemParts(date);
  return `${p.day}.${String(p.month).padStart(2, "0")}`;
}

export function formatFullDate(date) {
  const p = jerusalemParts(date);
  return `${p.day}.${String(p.month).padStart(2, "0")}.${String(p.year).slice(2)}`;
}

export function formatTime(date) {
  const p = jerusalemParts(date);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

export function formatDayMonth(date) {
  const p = jerusalemParts(date);
  return `${hebrewWeekday(date)}, ${p.day}.${String(p.month).padStart(2, "0")}`;
}

/**
 * Broadcast window end.
 * today → end of today, week → coming Friday 23:59 (today if Friday), month → end of month.
 * Times are Asia/Jerusalem.
 */
export function windowEnd(kind, fromDate, customEnd) {
  const from = fromDate instanceof Date ? fromDate : new Date(fromDate);
  if (kind === "today") return endOfJerusalemDay(from);
  if (kind === "week") {
    const p = jerusalemParts(from);
    const delta = (5 - p.weekday + 7) % 7;
    const friday = addCalendarDays(p.year, p.month, p.day, delta);
    return jerusalemToUtc(friday.year, friday.month, friday.day, 23, 59, 59);
  }
  if (kind === "month") {
    const p = jerusalemParts(from);
    const last = new Date(Date.UTC(p.year, p.month, 0));
    return jerusalemToUtc(last.getUTCFullYear(), last.getUTCMonth() + 1, last.getUTCDate(), 23, 59, 59);
  }
  if (kind === "custom" && customEnd) return endOfJerusalemDay(new Date(customEnd));
  return endOfJerusalemDay(from);
}

export function inboxRangeStart(kind, now) {
  const n = now instanceof Date ? now : new Date(now);
  if (kind === "today") return startOfJerusalemDay(n);
  if (kind === "week") return new Date(startOfJerusalemDay(n).getTime() - 6 * 86400000);
  if (kind === "month") {
    const p = jerusalemParts(n);
    return jerusalemToUtc(p.year, p.month, 1, 0, 0, 0);
  }
  return new Date(0);
}

/** Positive dx (finger moves right) approves. Negative dx skips. Owner decision 16.11.2026. */
export function swipeDecision(dx) {
  if (dx > 0) return "approve";
  if (dx < 0) return "skip";
  return null;
}

export function bulletinEdition(pubDate, title) {
  const pub = new Date(pubDate);
  const flat = String(title || "").replace(/\s+/g, " ");
  const m = flat.match(/השעה\s*(\d{1,2}):(\d{2})/) || flat.match(/(\d{1,2}):(\d{2})/);
  const p = jerusalemParts(pub);
  const hour = m ? +m[1] : p.hour;
  const minute = m ? +m[2] : 0;
  const start = jerusalemToUtc(p.year, p.month, p.day, hour, minute, 0);
  const expires = new Date(start.getTime() + 60 * 60 * 1000);
  const label = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { start, expires, hour, minute, label };
}

export function currentHourEdition(now) {
  const n = now instanceof Date ? now : new Date(now);
  const p = jerusalemParts(n);
  const start = jerusalemToUtc(p.year, p.month, p.day, p.hour, 0, 0);
  return {
    start,
    expires: new Date(start.getTime() + 60 * 60 * 1000),
    label: `${String(p.hour).padStart(2, "0")}:00`,
  };
}

/** Next upload cron at minute :05 (same minute in Jerusalem and UTC). */
export function nextCron(now, minute = 5) {
  const n = now instanceof Date ? now : new Date(now);
  const p = jerusalemParts(n);
  let target = jerusalemToUtc(p.year, p.month, p.day, p.hour, minute, 0);
  if (target.getTime() <= n.getTime()) target = new Date(target.getTime() + 3600000);
  return target;
}

export function isProtectedName(name) {
  return String(name || "").trim().toLowerCase() === PROTECTED_PLAYLIST;
}

export function isManagedPlaylist(pl, knownIds) {
  if (!pl || pl.id == null) return false;
  if (isProtectedName(pl.name)) return false;
  if (!String(pl.name || "").startsWith(MANAGED_PREFIX)) return false;
  const marked = String(pl.description || "").includes(MANAGED_MARKER);
  const known = knownIds instanceof Set ? knownIds.has(Number(pl.id)) : false;
  return marked || known;
}

export function toAzuraDay(jsWeekday) {
  return jsWeekday === 0 ? 7 : jsWeekday;
}

export function fromAzuraDay(day) {
  return day === 7 ? 0 : day;
}

export function hhmmToCode(hhmm) {
  const [h, m] = String(hhmm).split(":").map((x) => +x);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 100 + m;
}

export function codeToHhmm(code) {
  const n = Number(code);
  const h = Math.floor(n / 100);
  const m = n % 100;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function collapseWs(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

export function playlistShort(key) {
  return PLAYLISTS[key]?.short || key || "";
}

export function daysUntil(end, now) {
  const ms = new Date(end).getTime() - (now instanceof Date ? now : new Date(now)).getTime();
  return Math.ceil(ms / 86400000);
}
