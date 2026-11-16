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
} from "../site/js/pure.js";

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

console.log("self-check ok");
