import { windowEnd, jerusalemParts } from "./pure.js";

/** Fixture for ?demo=1. Covers the states screenshots need, without live credentials. */
export function demoBundle(now = new Date()) {
  const iso = (offsetMin) => new Date(now.getTime() - offsetMin * 60000).toISOString();
  const poster = "https://i.kikar.co.il/2026/11/15/fbe6c930-e108-11f1-a761-818aba60818f__h1081_w1921.png";
  const items = [
    item("new-vod", "vod", "היום בכיכר", "ayom-bakikar", "הילד שסירב לחלל שבת", "סיכום חדשות קצר מהאולפן.", poster, iso(50), 245),
    item("approved-vod", "vod", "דבר ראשון", "davar-rishon", "אין דבר כזה אנשי חורף", "שיחה קצרה על עונות ועל אנשים.", poster, iso(80), 512),
    item("uploading-vod", "vod", "היום בכיכר", "ayom-bakikar", "מהדורת הערב באולפן", "פרק שממתין באמצע ההמרה.", poster, iso(30), 300),
    item("failed-vod", "vod", "חדשות חרדי", "haredi-news", "דיווח מהשטח שלא עלה", "ההורדה מהמקור נכשלה.", poster, iso(120), 180),
    item("live-vod", "vod", "היום בכיכר", "ayom-bakikar", "פרק שכבר בפלייליסט", "משודר עד סוף השבוע.", poster, iso(400), 260),
    item("expired-vod", "vod", "דבר ראשון", "davar-rishon", "פרק שהחלון שלו נגמר", "הקובץ נשמר, והוא ירד מהפלייליסט.", poster, iso(2000), 200),
    item("new-music", "music", "סינגלים", "singles", "חמדה לבי", "סינגל חדש שמחכה לאישור.", "", iso(90), 214),
  ];
  const endWeek = windowEnd("week", now).toISOString();
  const endPast = new Date(now.getTime() - 86400000).toISOString();
  return {
    catalog: { schemaVersion: 1, updatedAt: now.toISOString(), items },
    selections: {
      schemaVersion: 1,
      items: {
        "approved-vod": approved("shows", endWeek, now),
        "uploading-vod": approved("shows", endWeek, now),
        "failed-vod": approved("shows", endWeek, now),
        "live-vod": approved("shows", endWeek, now),
        "expired-vod": approved("shows", endPast, new Date(now.getTime() - 8 * 86400000)),
      },
    },
    uploads: {
      schemaVersion: 1,
      updatedAt: now.toISOString(),
      lastRun: { finishedAt: new Date(now.getTime() - 20 * 60000).toISOString(), ok: false, uploaded: 1, failed: 1 },
      items: {
        "uploading-vod": { state: "uploading", title: items[2].title },
        "failed-vod": {
          state: "failed",
          errorCode: "download",
          errorMessage: "לא הצלחנו להוריד את הקובץ מהמקור.",
          attempts: 3,
          failedAt: iso(10),
          title: items[3].title,
        },
        "live-vod": {
          state: "active",
          playlistKey: "shows",
          uploadedAt: iso(60),
          title: items[4].title,
        },
        "expired-vod": {
          state: "expired",
          removedAt: iso(30),
          playlistKey: "shows",
          title: items[5].title,
        },
      },
    },
    bulletin: {
      schemaVersion: 1,
      updatedAt: now.toISOString(),
      note: "on-air",
      active: {
        key: "demo-15",
        label: "15:00",
        uploadedAt: new Date(now.getTime() - 6 * 60000).toISOString(),
        durationSec: 154,
        onAir: true,
        mediaUrl: "",
        title: "מבזק 15:00",
      },
      history: [],
      hour: { label: "15:00" },
      consecutiveFailures: 0,
    },
    system: {
      schemaVersion: 1,
      playlists: {
        shows: { id: 9, name: "כיכר אוטו – תוכניות" },
        briefs: { id: 7, name: "כיכר אוטו – מבזקים" },
        music: { id: 8, name: "כיכר אוטו – מוזיקה" },
        bulletin: { id: 6, name: "כיכר אוטו – מבזק שעתי" },
      },
    },
    rules: { schemaVersion: 1, seriesMap: {}, rules: [] },
    ads: {
      schemaVersion: 1,
      campaigns: [demoCampaign(now)],
      jingles: { everySongs: 4, enabled: true, playlistId: null, files: [] },
      sweepers: { everySongs: 3, enabled: true, playlistId: null, files: [] },
    },
    history: demoHistory(now),
    stationPlaylists: demoPlaylists(),
    np: {
      is_online: true,
      listeners: { current: 12 },
      now_playing: {
        elapsed: 40,
        duration: 180,
        playlist: "כיכר אוטו – תוכניות",
        song: { text: "היום בכיכר — פרק שכבר בפלייליסט", title: "פרק שכבר בפלייליסט", artist: "היום בכיכר" },
      },
    },
    pending: [{ dedupeKey: "put:data/selections.json", type: "put", path: "data/selections.json" }],
    inflight: { ids: ["uploading-vod"], at: now.getTime() },
    progress: { "uploading-vod": 0.62 },
  };
}

function demoHistory(now) {
  const unix = (minAgo) => Math.floor((now.getTime() - minAgo * 60000) / 1000);
  const song = (title) => ({ title, text: title });
  return [
    { played_at: unix(8), duration: 180, playlist: "כיכר אוטו – מוזיקה", song: song("שיר בוקר") },
    { played_at: unix(15), duration: 5, playlist: "כיכר אוטו – מעברונים", song: song("כיכר FM") },
    { played_at: unix(40), duration: 620, playlist: "כיכר אוטו – תוכניות", song: song("הפגישה המוזרה") },
    { played_at: unix(70), duration: 150, playlist: "כיכר אוטו – מבזק שעתי", song: song("מבזק השעה") },
    { played_at: unix(200), duration: 620, playlist: "כיכר אוטו – תוכניות", song: song("הפגישה המוזרה") },
    { played_at: unix(400), duration: 210, playlist: "Shows", song: song("תוכנית ישנה") },
    { played_at: unix(26 * 60), duration: 100, playlist: "כיכר אוטו – מוזיקה", song: song("מחוץ לחלון") },
  ];
}

function demoPlaylists() {
  return [
    { id: 6, name: "כיכר אוטו – מבזק שעתי", is_enabled: true, play_per_hour_minute: 15, schedule_items: [] },
    { id: 8, name: "כיכר אוטו – מוזיקה", is_enabled: true, num_songs: 12, schedule_items: [] },
    { id: 9, name: "כיכר אוטו – תוכניות", is_enabled: true, num_songs: 10, schedule_items: [] },
    { id: 10, name: "כיכר אוטו – מעברונים", is_enabled: true, schedule_items: [] },
    { id: 4, name: "תוכנית בוקר", is_enabled: true, schedule_items: [{ start_time: 700, end_time: 900, days: [1, 2, 3, 4, 5] }] },
    { id: 1, name: "Shows", is_enabled: true, schedule_items: [{ start_time: 1800, end_time: 1900, days: [1] }] },
  ];
}

function demoCampaign(now) {
  const p = jerusalemParts(now);
  const hour = (p.hour + 3) % 24;
  return {
    id: "demo-ad",
    name: "חסות הצהריים",
    paused: false,
    startDate: "2026-01-01",
    endDate: "2027-01-01",
    days: [0, 1, 2, 3, 4, 5, 6],
    fixedTimes: [`${String(hour).padStart(2, "0")}:20`],
  };
}

function item(id, feed, seriesName, seriesSlug, title, description, poster, pubDate, durationSec) {
  return { id, feed, seriesName, seriesSlug, title, description, poster, pubDate, durationSec, mediaUrl: "", link: "https://www.kikar.co.il/" };
}

function approved(playlistKey, windowEndIso, now) {
  return {
    status: "approved",
    playlistKey,
    window: "week",
    windowStart: now.toISOString(),
    windowEnd: windowEndIso,
    replacePrevious: false,
    uploadNow: false,
    source: "manual",
    updatedAt: now.toISOString(),
  };
}
