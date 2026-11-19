/** Pure helpers shared by the static UI and the Node jobs. No DOM, no secrets. */

export const JERUSALEM = "Asia/Jerusalem";

export const PLAYLISTS = {
  shows: { key: "shows", name: "כיכר אוטו – תוכניות", short: "תוכניות" },
  briefs: { key: "briefs", name: "כיכר אוטו – מבזקים", short: "מבזקים" },
  music: { key: "music", name: "כיכר אוטו – מוזיקה", short: "מוזיקה" },
  bulletin: { key: "bulletin", name: "כיכר אוטו – מבזק שעתי", short: "מבזק שעתי" },
};

/** Assignable targets. The hourly bulletin playlist is never a manual default. */
export const ASSIGNABLE_PLAYLISTS = ["shows", "briefs", "music"];

export function cleanSeriesName(name, slug) {
  const text = String(name || "")
    .replace(/\u200d/g, " ")
    .replace(/#/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /^vod$/i.test(text) || String(slug || "") === "vod") return "";
  return text;
}

/** A track longer than this is a show, even if the feed or the approval says music. */
export const MUSIC_MAX_SECONDS = 12 * 60;

export function playlistKeyForIntent(playlistKey, durationSec) {
  if (playlistKey === "music" && Number(durationSec) > MUSIC_MAX_SECONDS) return "shows";
  return playlistKey;
}

/** A manual approval that asked to keep the episode is not removed when a later episode replaces the series. */
export function keepDespiteReplace(selection, now) {
  if (!selection || selection.status !== "approved" || selection.replacePrevious) return false;
  if (!selection.windowEnd) return true;
  const end = new Date(selection.windowEnd).getTime();
  const at = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return Number.isFinite(end) && end > at;
}

export function defaultPlaylistKey(item, seriesMap) {
  const mapped = seriesMap?.[item?.seriesSlug]?.playlistKey;
  if (mapped && mapped !== "bulletin" && PLAYLISTS[mapped]) return mapped;
  if (item?.feed === "music") return "music";
  return "shows";
}

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

export function formatRelative(date, now = new Date()) {
  const p = jerusalemParts(date);
  const n = jerusalemParts(now);
  const time = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  if (p.year === n.year && p.month === n.month && p.day === n.day) return `היום ${time}`;
  const yest = addCalendarDays(n.year, n.month, n.day, -1);
  if (p.year === yest.year && p.month === yest.month && p.day === yest.day) return `אתמול ${time}`;
  return `${p.day}.${String(p.month).padStart(2, "0")}`;
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
  if (kind === "next") return null;
  if (kind === "custom" && customEnd) return endOfJerusalemDay(new Date(customEnd));
  return endOfJerusalemDay(from);
}

const DAILY_NEWS_SLUGS = new Set(["ayom-bakikar", "davar-rishon", "haredim-news", "news-interviews"]);

/** Daily news shows stay on air until the next episode of the same series replaces them. */
export function isDailyNewsSeries(item) {
  const slug = String(item?.seriesSlug || "");
  const name = String(item?.seriesName || "");
  if (DAILY_NEWS_SLUGS.has(slug)) return true;
  if (/היום בכיכר|דבר ראשון/.test(name)) return true;
  if (item?.feed === "music") return false;
  return /(^|-)news($|-)|interview/.test(slug);
}

export function defaultWindow(item, seriesMap) {
  const mapped = seriesMap?.[item?.seriesSlug]?.window;
  if (mapped) return mapped;
  if (isDailyNewsSeries(item)) return "next";
  return "week";
}

export function hePlural(n, one, two, many) {
  const cat = new Intl.PluralRules("he").select(Number(n));
  if (cat === "one") return one;
  if (cat === "two") return two;
  return many.replace("#", String(n));
}

/**
 * How a bulletin watcher should behave at a Jerusalem clock time.
 * From :00 through :20 the first check runs immediately (a dispatch at :03
 * does not wait). A start in the last 15 minutes only sleeps until :00.
 */
export function bulletinWatchPlan(parts) {
  const minute = parts.minute;
  const second = parts.second || 0;
  if (minute >= 45) {
    return { phase: "sleep-until-hour", waitMs: ((60 - minute) * 60 - second) * 1000, immediate: false };
  }
  if (minute <= 20) return { phase: "poll", waitMs: 60_000, immediate: true };
  return { phase: "once", waitMs: 0, immediate: true };
}

/** once_per_hour plays this minute. Two minutes from now, wrapping the hour. */
export function bulletinPlayMinute(minute) {
  const m = Math.floor(Number(minute));
  if (!Number.isFinite(m)) return 2;
  return ((m % 60) + 2) % 60;
}

/**
 * A bulletin file should leave the station when its hour is over, when it was
 * already taken off the playlist but the file is still on disk, or when a new
 * edition is about to replace it. The file we are keeping stays.
 */
export function shouldRetireBulletin(row, now, { keepFileId = null, replaceAll = false } = {}) {
  if (!row?.fileId || row.failed || row.deletedAt) return false;
  if (keepFileId != null && Number(row.fileId) === Number(keepFileId)) return false;
  if (replaceAll) return true;
  if (row.removedAt) return true;
  const exp = row.expiresAt ? new Date(row.expiresAt).getTime() : NaN;
  const at = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return Number.isFinite(exp) && at >= exp;
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

export const UPLOAD_ARM_MS = 20000;
export const WRITE_DEBOUNCE_MS = 1500;
export const WRITE_TOAST_AFTER_MS = 30000;

/** General rotation is the default shows + music playlists, not briefs or the hourly bulletin. */
export const ROTATION_PLAYLIST_KEYS = ["shows", "music"];
export const ROTATION_MIN = 5;
export const DEAD_AIR_TEXT = "אין תוכן בשידור רציף — הרדיו משמיע הודעת ברירת מחדל";
export const SWEEPER_NAME = "כיכר אוטו – מעברונים";

export function isSweeperPlaylist(pl) {
  if (!pl || isProtectedName(pl.name)) return false;
  const description = String(pl.description || "");
  if (description.includes(MANAGED_MARKER) && description.includes("sweepers")) return true;
  return pl.name === SWEEPER_NAME;
}

export function existingSweeperId(playlists) {
  const found = (playlists || []).find((pl) => isSweeperPlaylist(pl));
  return found?.id != null ? Number(found.id) : null;
}

export function rotationSongCount(playlists, rotationIds) {
  const wanted = new Set((rotationIds || []).map(Number).filter((id) => Number.isFinite(id)));
  if (!wanted.size) return null;
  let seen = 0;
  let total = 0;
  for (const pl of playlists || []) {
    if (!wanted.has(Number(pl?.id))) continue;
    seen += 1;
    total += Math.max(0, Number(pl.num_songs ?? pl.song_count ?? pl.count ?? 0) || 0);
  }
  return seen ? total : null;
}

/** Empty string when rotation is healthy or still unknown. */
export function rotationWarning(count, min = ROTATION_MIN) {
  if (count == null || count >= min) return "";
  if (count <= 0) return DEAD_AIR_TEXT;
  if (count === 1) return "השידור הרציף כמעט ריק — נשאר פריט אחד בתוכניות ובמוזיקה";
  const left = hePlural(count, "פריט אחד", "שני פריטים", "# פריטים");
  return `השידור הרציף כמעט ריק — נשארו ${left} בתוכניות ובמוזיקה`;
}

function isRotationRecord(row) {
  return ROTATION_PLAYLIST_KEYS.includes(row?.playlistKey) && row?.state === "active" && row?.azuraFileId;
}

/**
 * Never let expiry empty shows+music. If removing expired items would leave
 * fewer than `min` files, keep the oldest-expired ones until replacements exist.
 * An explicit removal (no approval) is still removed.
 */
export function planRotationExpiry(records, now, min = ROTATION_MIN) {
  const at = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const floor = Math.max(1, Number(min) || ROTATION_MIN);
  const general = (records || []).filter(isRotationRecord);
  const explicit = [];
  const staying = [];
  const ending = [];
  for (const row of general) {
    if (row.explicitRemove) {
      explicit.push(row);
      continue;
    }
    const end = row.windowEnd ? new Date(row.windowEnd).getTime() : null;
    if (end != null && !Number.isNaN(end) && at >= end) ending.push(row);
    else staying.push(row);
  }
  const oldestFirst = [...ending].sort((a, b) => {
    const endDelta = (Date.parse(a.windowEnd || "") || 0) - (Date.parse(b.windowEnd || "") || 0);
    if (endDelta) return endDelta;
    return (Date.parse(a.uploadedAt || "") || 0) - (Date.parse(b.uploadedAt || "") || 0);
  });
  const keepCount = Math.max(0, floor - staying.length);
  const keepIds = oldestFirst.slice(0, keepCount).map((row) => row.id);
  const expireIds = [...oldestFirst.slice(keepCount), ...explicit].map((row) => row.id);
  return { expireIds, keepIds, held: keepIds.length > 0, floor };
}

export function daysUntil(end, now) {
  const ms = new Date(end).getTime() - (now instanceof Date ? now : new Date(now)).getTime();
  return Math.ceil(ms / 86400000);
}

export const KIND_LABEL = {
  music: "מוזיקה",
  shows: "תוכניות",
  bulletin: "מבזק",
  sweeper: "מעברון",
  ad: "פרסומת",
  playlist: "מתוזמן",
  other: "אחר",
};

export const ROTATION_NOTE = "תוכנית מתנגנת כל 4 שירים, ומעברון בין פריטים.";

/** Tag a playlist name or id for the schedule. Read-only; it never decides a write. */
export function classifyPlaylist(name, id) {
  const n = Number(id);
  const text = String(name || "");
  if (n === 10 || text.includes("מעברון") || text.includes("מעברונ")) return "sweeper";
  if (n === 6 || text.includes("מבזק שעתי")) return "bulletin";
  if (n === 9 || text.includes("תוכניות")) return "shows";
  if (n === 8 || text.includes("מוזיקה")) return "music";
  if (text.includes("פרסומת")) return "ad";
  return "other";
}

function playedAtMs(value) {
  if (value == null || value === "") return NaN;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    return n < 1e12 ? n * 1000 : n;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/** Plays from the last 24 hours, newest first. Accepts the history API or nowplaying song_history. */
export function normalizeHistory(raw, now = new Date()) {
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.rows) ? raw.rows : [];
  const at = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const cutoff = at - 24 * 60 * 60 * 1000;
  const plays = [];
  for (const row of rows) {
    const when = playedAtMs(row?.played_at ?? row?.timestamp);
    if (!Number.isFinite(when) || when < cutoff || when > at + 60 * 1000) continue;
    const playlistName = typeof row.playlist === "string" ? row.playlist : row.playlist?.name || "";
    const playlistId = typeof row.playlist === "object" && row.playlist ? row.playlist.id : row.playlist_id;
    const song = row.song || {};
    const title = String(song.title || song.text || row.title || "").trim() || "ללא שם";
    plays.push({
      at: when,
      title,
      duration: Number(row.duration ?? song.duration ?? 0) || 0,
      playlistName,
      playlistId: playlistId == null || playlistId === "" ? null : Number(playlistId),
      kind: classifyPlaylist(playlistName, playlistId),
    });
  }
  plays.sort((a, b) => b.at - a.at);
  return plays;
}

/** Same title played again inside six hours. Compared by title, not by playlist. */
export function markRepeats(plays, windowMs = 6 * 60 * 60 * 1000) {
  const times = new Map();
  for (const play of plays || []) {
    const key = String(play.title || "").trim();
    if (!times.has(key)) times.set(key, []);
    times.get(key).push(play.at);
  }
  return (plays || []).map((play) => {
    const hits = times.get(String(play.title || "").trim()) || [];
    const repeat = hits.some((when) => when !== play.at && Math.abs(when - play.at) <= windowMs);
    return { ...play, repeat };
  });
}

/** Newest hour first. Plays inside an hour stay newest first. */
export function groupPlays(plays) {
  const groups = [];
  const index = new Map();
  for (const play of plays || []) {
    const p = jerusalemParts(play.at);
    const key = `${p.year}-${p.month}-${p.day}-${p.hour}`;
    if (!index.has(key)) {
      const row = { key, at: play.at, plays: [] };
      index.set(key, row);
      groups.push(row);
    }
    index.get(key).plays.push(play);
  }
  return groups;
}

function clockCode(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.includes(":")) return hhmmToCode(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function scheduleDayMatches(days, jsWeekday) {
  if (!Array.isArray(days) || days.length === 0) return true;
  const set = new Set(days.map(Number));
  return set.has(toAzuraDay(jsWeekday)) || set.has(jsWeekday);
}

function dateKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function bulletinMinute(playlists) {
  const pl = (playlists || []).find((row) => Number(row?.id) === 6);
  const minute = Number(pl?.play_per_hour_minute);
  if (Number.isInteger(minute) && minute >= 0 && minute <= 59) return minute;
  return 8;
}

/**
 * A projected plan for the next 24 hours. Bulletin slots, scheduled playlists, and ad fixed times.
 * This is not the station queue.
 */
export function projectSchedule({ now = new Date(), playlists = [], campaigns = [] } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const until = at.getTime() + 24 * 60 * 60 * 1000;
  const events = [];
  const alwaysOn = [];
  const minute = bulletinMinute(playlists);
  const start = jerusalemParts(at);
  const hour0 = jerusalemToUtc(start.year, start.month, start.day, start.hour, 0, 0);

  for (let i = 0; i < 25; i++) {
    const hour = jerusalemParts(new Date(hour0.getTime() + i * 60 * 60 * 1000));
    const slot = jerusalemToUtc(hour.year, hour.month, hour.day, hour.hour, minute, 0).getTime();
    if (slot <= at.getTime() || slot > until) continue;
    events.push({ at: slot, kind: "bulletin", title: "מבזק שעתי", detail: `דקה ${minute}` });
  }

  for (const pl of playlists || []) {
    if (!pl || pl.is_enabled === false || Number(pl.id) === 6) continue;
    for (const item of pl.schedule_items || []) {
      const startCode = clockCode(item.start_time);
      const endCode = clockCode(item.end_time);
      if (startCode == null) continue;
      if (startCode === 0 && (endCode == null || endCode >= 2359)) {
        if (pl.name) alwaysOn.push(pl.name);
        continue;
      }
      const sh = Math.floor(startCode / 100);
      const sm = startCode % 100;
      if (sh > 23 || sm > 59) continue;
      for (let day = 0; day < 2; day++) {
        const p = jerusalemParts(new Date(at.getTime() + day * 86400000));
        if (!scheduleDayMatches(item.days, p.weekday)) continue;
        const slot = jerusalemToUtc(p.year, p.month, p.day, sh, sm, 0).getTime();
        if (slot <= at.getTime() || slot > until) continue;
        events.push({
          at: slot,
          kind: "playlist",
          title: pl.name || "פלייליסט",
          detail: endCode == null ? codeToHhmm(startCode) : `${codeToHhmm(startCode)}–${codeToHhmm(endCode)}`,
        });
      }
    }
  }

  for (const campaign of campaigns || []) {
    if (!campaign || campaign.paused || campaign.draft) continue;
    for (const time of campaign.fixedTimes || []) {
      const code = hhmmToCode(time);
      if (code == null) continue;
      const sh = Math.floor(code / 100);
      const sm = code % 100;
      if (sh > 23 || sm > 59) continue;
      for (let day = 0; day < 2; day++) {
        const p = jerusalemParts(new Date(at.getTime() + day * 86400000));
        const key = dateKey(p);
        if (campaign.startDate && key < campaign.startDate) continue;
        if (campaign.endDate && key > campaign.endDate) continue;
        const days = (campaign.days || []).map(Number);
        if (days.length && !days.includes(p.weekday)) continue;
        const slot = jerusalemToUtc(p.year, p.month, p.day, sh, sm, 0).getTime();
        if (slot <= at.getTime() || slot > until) continue;
        events.push({ at: slot, kind: "ad", title: campaign.name || "קמפיין", detail: "שעה קבועה" });
      }
    }
  }

  events.sort((a, b) => a.at - b.at);
  return { events, alwaysOn: [...new Set(alwaysOn)], note: ROTATION_NOTE, bulletinMinute: minute };
}
