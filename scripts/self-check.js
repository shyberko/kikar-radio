import assert from "node:assert/strict";
import { parseRss } from "./lib/rss.js";
import { extractMedia } from "./lib/article.js";
import {
  parseIsoDuration,
  windowEnd,
  jerusalemToUtc,
  jerusalemParts,
  bulletinEdition,
  swipeDecision,
  isProtectedName,
  isManagedPlaylist,
  inboxRangeStart,
  formatDayMonth,
  defaultPlaylistKey,
  defaultWindow,
  cleanSeriesName,
  bulletinWatchPlan,
  hePlural,
  UPLOAD_ARM_MS,
  WRITE_DEBOUNCE_MS,
  WRITE_TOAST_AFTER_MS,
  ROTATION_MIN,
  DEAD_AIR_TEXT,
  planRotationExpiry,
  rotationSongCount,
  rotationWarning,
  isSweeperPlaylist,
  existingSweeperId,
} from "../site/js/pure.js";
import { planGithubResponse, planGithubPermissions, planAzuraError, bulletinOffAirAt, githubSetupMessage, mergeJsonDocs, coalesceWrites } from "../site/js/policy.js";
import { knownIdSet } from "./lib/playlists.js";

assert.equal(parseIsoDuration("PT4M5S"), 245);
assert.equal(parseIsoDuration("PT2M31S"), 151);
assert.equal(swipeDecision(40), "approve");
assert.equal(swipeDecision(-12), "skip");
assert.equal(swipeDecision(0), null);
assert.equal(isProtectedName(" election "), true);
assert.equal(isProtectedName("Election"), true);
assert.equal(isProtectedName("כיכר אוטו – מבזקים"), false);
assert.equal(
  isManagedPlaylist({ id: 9, name: "election", description: "managed-by:kikar-radio" }, new Set([9])),
  false,
);
assert.equal(
  isManagedPlaylist({ id: 9, name: "כיכר אוטו – מבזקים", description: "managed-by:kikar-radio key:briefs" }, new Set()),
  true,
);
assert.equal(
  isManagedPlaylist({ id: 3, name: "כיכר אוטו – מוזיקה", description: "" }, new Set([3])),
  true,
);
assert.equal(
  isManagedPlaylist({ id: 4, name: "מישהו אחר", description: "managed-by:kikar-radio" }, new Set([4])),
  false,
);

const monday = jerusalemToUtc(2026, 11, 16, 10, 0, 0);
const parts = jerusalemParts(monday);
assert.equal(parts.hour, 10);
assert.equal(parts.day, 16);
assert.equal(parts.weekday, 1);
const friday = windowEnd("week", monday);
const fp = jerusalemParts(friday);
assert.equal(fp.weekday, 5);
assert.equal(fp.day, 20);
assert.equal(fp.hour, 23);
assert.equal(fp.minute, 59);
assert.match(formatDayMonth(friday), /יום ו׳/);

const edition = bulletinEdition("Mon, 16 Nov 2026 13:00:00 GMT", "מבזק חדשות כיכר FM | מהדורת השעה 15:00");
assert.equal(edition.label, "15:00");
assert.equal(edition.expires.getTime() - edition.start.getTime(), 60 * 60 * 1000);
const ep = jerusalemParts(edition.start);
assert.equal(ep.hour, 15);
assert.equal(ep.minute, 0);

const weekStart = inboxRangeStart("week", monday);
assert.ok(monday.getTime() - weekStart.getTime() >= 6 * 86400000 - 1000);

const xml = `<?xml version="1.0"?><rss><channel><item>
<title><![CDATA[כותרת &amp; עוד]]></title>
<link>https://www.kikar.co.il/ayom-bakikar/demo</link>
<guid>https://www.kikar.co.il/ayom-bakikar/demo</guid>
<pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate>
<description><![CDATA[תקציר]]></description>
<enclosure url="https://i.kikar.co.il/a.jpg" length="0" type="image/jpeg"/>
</item></channel></rss>`;
const items = parseRss(xml);
assert.equal(items.length, 1);
assert.equal(items[0].title, "כותרת & עוד");
assert.equal(items[0].enclosure, "https://i.kikar.co.il/a.jpg");

const html = `<script type="application/ld+json">{"@type":"NewsArticle","headline":"כותרת","articleSection":"היום בכיכר","video":[{"@type":"VideoObject","contentUrl":"https://stream.kikar.co.il/621d2f79-d26c-4523-a071-34b5e10be75e/play_480p.mp4","duration":"PT4M5S","thumbnailUrl":["https://i.kikar.co.il/p.png"]}]}</script>`;
const media = extractMedia(html);
assert.equal(media.mediaUrl, "https://stream.kikar.co.il/621d2f79-d26c-4523-a071-34b5e10be75e/play_480p.mp4");
assert.equal(media.durationIso, "PT4M5S");
assert.equal(media.section, "היום בכיכר");
assert.equal(media.poster, "https://i.kikar.co.il/p.png");

const fallback = extractMedia(`<div>https://stream.kikar.co.il/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/play_480p.mp4</div>`);
assert.ok(fallback.mediaUrl.endsWith("/play_480p.mp4"));

const retry = planGithubResponse(409, 0);
assert.equal(retry.action, "retry");
assert.equal(retry.code, "conflict");
assert.equal(planGithubResponse(409, 4).action, "retry");
assert.equal(planGithubResponse(409, 5).action, "fail");
assert.match(planGithubResponse(409, 5).message, /כמה ניסיונות/);
assert.equal(planGithubResponse(422, 0).action, "retry");
assert.equal(planGithubResponse(422, 0).code, "conflict");
assert.equal(planGithubResponse(422, 5).action, "fail");
const rate = planGithubResponse(403, 0, 6, "You have exceeded a secondary rate limit.", "2");
assert.equal(rate.action, "retry");
assert.equal(rate.code, "rate");
assert.equal(rate.waitMs, 2000);
assert.equal(planGithubResponse(429, 1, 6, "rate limit", "").code, "rate");
const token = planGithubResponse(401, 0);
assert.equal(token.action, "fail");
assert.equal(token.code, "token");
assert.equal(token.recovery, "settings");
assert.match(token.message, /GitHub/);
const scope = planGithubResponse(403, 0);
assert.equal(scope.code, "scope");
const fineGrainedRepo = {
  permissions: { admin: false, maintain: false, push: true, triage: true, pull: true },
};
assert.equal(planGithubPermissions({ permissions: fineGrainedRepo.permissions, workflowsOk: true }).ok, true);
assert.equal(planGithubPermissions({ permissions: fineGrainedRepo.permissions, workflowsOk: true }).code, "ok");
assert.equal(
  planGithubPermissions({ permissions: { admin: false, maintain: false, push: false, triage: false, pull: true }, workflowsOk: true }).code,
  "contents",
);
assert.equal(planGithubPermissions({ permissions: { push: true }, workflowsOk: false }).code, "actions");
assert.equal(planGithubPermissions({ contents: "write", workflowsOk: true }).ok, true);
assert.equal(githubSetupMessage({ status: 401 }), "הטוקן לא תקף");
assert.equal(githubSetupMessage({ status: 404 }), "הטוקן לא מכסה את המאגר kikar-radio");
assert.equal(githubSetupMessage({ code: "network", name: "TypeError" }), "אין חיבור ל־GitHub. נסה שוב.");
assert.match(githubSetupMessage({ code: "contents" }), /כתיבה לתוכן/);
assert.match(githubSetupMessage({ code: "actions" }), /להפעיל העלאות/);

const azuraAuth = planAzuraError(401, { message: "Not logged in" });
assert.equal(azuraAuth.code, "auth");
assert.equal(azuraAuth.recovery, "settings");
assert.match(azuraAuth.message, /API/);
assert.equal(planAzuraError(403, "Invalid API key").code, "auth");
assert.equal(planAzuraError(500, "This station is out of available storage space.").code, "storage");
assert.equal(planAzuraError(404, "not found").code, "playlist");

const editionStart = jerusalemToUtc(2026, 11, 16, 15, 0, 0).getTime();
const uploadedAt = editionStart + 40 * 60 * 1000;
assert.equal(bulletinOffAirAt(editionStart), editionStart + 60 * 60 * 1000);
assert.notEqual(bulletinOffAirAt(editionStart), uploadedAt + 60 * 60 * 1000);
const replacedAt = editionStart + 25 * 60 * 1000;
assert.equal(bulletinOffAirAt(editionStart, replacedAt), replacedAt);
const scoop = bulletinEdition("Mon, 16 Nov 2026 13:00:00 GMT", "מבזק חדשות כיכר FM | מהדורת השעה 15:00");
assert.equal(bulletinOffAirAt(scoop.start.getTime()), scoop.expires.getTime());

assert.equal(defaultPlaylistKey({ feed: "vod", seriesSlug: "davar-rishon" }, {}), "shows");
assert.equal(defaultPlaylistKey({ feed: "music", seriesSlug: "music" }, {}), "music");
assert.equal(defaultPlaylistKey({ feed: "vod", seriesSlug: "x" }, { x: { playlistKey: "bulletin" } }), "shows");
assert.equal(defaultPlaylistKey({ feed: "vod", seriesSlug: "x" }, { x: { playlistKey: "briefs" } }), "briefs");
assert.equal(cleanSeriesName("חדשות\u200dחרדי", "haredi"), "חדשות חרדי");
assert.equal(cleanSeriesName("VOD", "vod"), "");
assert.equal(defaultWindow({ feed: "vod", seriesSlug: "ayom-bakikar", seriesName: "היום בכיכר" }, {}), "next");
assert.equal(defaultWindow({ feed: "vod", seriesSlug: "davar-rishon", seriesName: "דבר ראשון" }, {}), "next");
assert.equal(defaultWindow({ feed: "vod", seriesSlug: "haredim-news", seriesName: "חרדים" }, {}), "next");
assert.equal(defaultWindow({ feed: "vod", seriesSlug: "news-interviews", seriesName: "ראיונות" }, {}), "next");
assert.equal(defaultWindow({ feed: "music", seriesSlug: "singles", seriesName: "סינגלים" }, {}), "week");
assert.equal(defaultWindow({ feed: "vod", seriesSlug: "ayom-bakikar" }, { "ayom-bakikar": { window: "today" } }), "today");
assert.equal(windowEnd("next", monday), null);
assert.equal(bulletinWatchPlan({ minute: 50, second: 0 }).phase, "sleep-until-hour");
assert.equal(bulletinWatchPlan({ minute: 50, second: 10 }).waitMs, (10 * 60 - 10) * 1000);
assert.equal(bulletinWatchPlan({ minute: 3, second: 0 }).phase, "poll");
assert.equal(bulletinWatchPlan({ minute: 0, second: 0 }).phase, "poll");
assert.equal(bulletinWatchPlan({ minute: 20, second: 0 }).phase, "poll");
assert.equal(bulletinWatchPlan({ minute: 21, second: 0 }).phase, "once");
assert.equal(hePlural(1, "פעולה אחת", "שתי פעולות", "# פעולות"), "פעולה אחת");
assert.equal(hePlural(2, "פעולה אחת", "שתי פעולות", "# פעולות"), "שתי פעולות");
assert.equal(hePlural(5, "פעולה אחת", "שתי פעולות", "# פעולות"), "5 פעולות");

assert.equal(WRITE_DEBOUNCE_MS, 1500);
assert.equal(WRITE_TOAST_AFTER_MS, 30000);
assert.equal(UPLOAD_ARM_MS, 20000);

const rapid = coalesceWrites([
  { path: "data/selections.json", body: { items: { a: { status: "approved", updatedAt: "2026-11-16T14:33:01Z" } } } },
  { path: "data/selections.json", body: { items: { a: { status: "approved", updatedAt: "2026-11-16T14:33:01Z" }, b: { status: "approved", updatedAt: "2026-11-16T14:33:02Z" } } } },
  { path: "data/rules.json", body: { rules: [{ id: "r1", updatedAt: "2026-11-16T14:31:57Z" }] } },
  { path: "data/selections.json", body: { items: { a: { status: "approved", updatedAt: "2026-11-16T14:33:01Z" }, b: { status: "approved", updatedAt: "2026-11-16T14:33:02Z" }, c: { status: "skipped", updatedAt: "2026-11-16T14:33:20Z" } } } },
]);
assert.equal(rapid.length, 2);
const selectionsWrite = rapid.find((row) => row.path === "data/selections.json");
const botCommit = {
  items: {
    a: { status: "approved", updatedAt: "2026-11-16T14:32:14Z", playlistKey: "shows" },
    scan: { status: "approved", updatedAt: "2026-11-16T14:30:00Z", playlistKey: "music" },
  },
};
const merged = mergeJsonDocs(botCommit, selectionsWrite.body);
assert.equal(merged.items.a.status, "approved");
assert.equal(merged.items.a.playlistKey, "shows");
assert.equal(merged.items.b.status, "approved");
assert.equal(merged.items.c.status, "skipped");
assert.equal(merged.items.scan.playlistKey, "music");
const newerLocal = mergeJsonDocs(
  { items: { a: { status: "approved", updatedAt: "2026-11-16T14:33:01Z" } } },
  { items: { a: { status: "skipped", updatedAt: "2026-11-16T14:33:20Z" } } },
);
assert.equal(newerLocal.items.a.status, "skipped");
const olderLocal = mergeJsonDocs(
  { items: { a: { status: "approved", updatedAt: "2026-11-16T14:33:20Z" } } },
  { items: { a: { status: "skipped", updatedAt: "2026-11-16T14:32:00Z" } } },
);
assert.equal(olderLocal.items.a.status, "approved");

assert.equal(ROTATION_MIN, 5);
assert.equal(DEAD_AIR_TEXT, "אין תוכן בשידור רציף — הרדיו משמיע הודעת ברירת מחדל");
const stationPlaylists = [
  { id: 8, name: "כיכר אוטו – מוזיקה", type: "default", num_songs: 3 },
  { id: 9, name: "כיכר אוטו – תוכניות", type: "default", num_songs: 1 },
  { id: 7, name: "כיכר אוטו – מבזקים", type: "default", num_songs: 20 },
  { id: 10, name: "כיכר אוטו – מעברונים", description: "managed-by:kikar-radio sweepers", type: "once_per_x_songs", num_songs: 2 },
];
assert.equal(rotationSongCount(stationPlaylists, [8, 9]), 4);
assert.match(rotationWarning(4), /כמעט ריק/);
assert.equal(rotationWarning(0), DEAD_AIR_TEXT);
assert.equal(rotationWarning(5), "");
assert.equal(rotationWarning(rotationSongCount([], [8, 9])), "");

const at = new Date("2026-11-16T12:00:00Z");
const expired = (id, key, uploadedAt, windowEnd) => ({
  id, playlistKey: key, state: "active", azuraFileId: id, uploadedAt, windowEnd,
});
const healthy = planRotationExpiry([
  expired("e1", "shows", "2026-11-16T08:00:00Z", "2026-11-16T09:00:00Z"),
  expired("e2", "music", "2026-11-16T10:00:00Z", "2026-11-16T11:00:00Z"),
  ...["s1", "s2", "s3", "s4", "s5", "s6"].map((id, i) => expired(id, i % 2 ? "music" : "shows", `2026-11-16T07:0${i}:00Z`, "2026-11-16T18:00:00Z")),
], at);
assert.deepEqual(healthy.keepIds, []);
assert.deepEqual(healthy.expireIds, ["e1", "e2"]);
const thin = planRotationExpiry([
  expired("oldest", "shows", "2026-11-16T01:00:00Z", "2026-11-16T08:00:00Z"),
  expired("older", "music", "2026-11-16T02:00:00Z", "2026-11-16T09:00:00Z"),
  expired("mid", "shows", "2026-11-16T03:00:00Z", "2026-11-16T10:00:00Z"),
  expired("newer", "music", "2026-11-16T04:00:00Z", "2026-11-16T11:00:00Z"),
  expired("newest", "shows", "2026-11-16T05:00:00Z", "2026-11-16T11:30:00Z"),
  expired("stay", "music", "2026-11-16T06:00:00Z", "2026-11-16T18:00:00Z"),
  expired("brief", "briefs", "2026-11-16T01:00:00Z", "2026-11-16T02:00:00Z"),
  { ...expired("skipped", "shows", "2026-11-16T00:00:00Z", "2026-11-16T07:00:00Z"), explicitRemove: true },
], at);
assert.equal(thin.held, true);
assert.deepEqual(thin.keepIds, ["oldest", "older", "mid", "newer"]);
assert.deepEqual(thin.expireIds, ["newest", "skipped"]);
const empty = planRotationExpiry([
  expired("a", "shows", "2026-11-16T01:00:00Z", "2026-11-16T08:00:00Z"),
  expired("b", "music", "2026-11-16T02:00:00Z", "2026-11-16T09:00:00Z"),
], at);
assert.deepEqual(empty.keepIds, ["a", "b"]);
assert.deepEqual(empty.expireIds, []);

const sweeperAds = {
  campaigns: [],
  jingles: { playlistId: null, files: [] },
  sweepers: {
    playlistId: 10,
    files: [{ mediaId: 47, enabled: true }, { mediaId: 48, enabled: true }],
  },
};
const known = knownIdSet({ playlists: { shows: { id: 9 }, music: { id: 8 }, bulletin: { id: 6 } } }, sweeperAds);
assert.equal(known.has(10), true);
assert.equal(known.has(8), true);
assert.equal(known.has(9), true);
assert.equal(isManagedPlaylist({ id: 10, name: "כיכר אוטו – מעברונים", description: "managed-by:kikar-radio sweepers" }, known), true);
assert.equal(isSweeperPlaylist({ id: 10, name: "כיכר אוטו – מעברונים", description: "managed-by:kikar-radio sweepers" }), true);
assert.equal(existingSweeperId(stationPlaylists), 10);
for (const name of ["Shows", "Jingles", "Hourly News", "election"]) {
  assert.equal(isManagedPlaylist({ id: 1, name, description: "managed-by:kikar-radio" }, known), false);
  assert.equal(isSweeperPlaylist({ id: 1, name, description: "" }), false);
}

console.log("self-check ok");
