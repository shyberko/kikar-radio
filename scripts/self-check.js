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
} from "../site/js/pure.js";
import { planGithubResponse, planGithubPermissions, planAzuraError, bulletinOffAirAt, githubSetupMessage } from "../site/js/policy.js";

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
assert.equal(planGithubResponse(409, 1).action, "retry");
assert.equal(planGithubResponse(409, 2).action, "retry");
assert.equal(planGithubResponse(409, 3).action, "fail");
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

console.log("self-check ok");
