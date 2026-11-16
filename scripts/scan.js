import crypto from "node:crypto";
import path from "node:path";
import { DATA } from "./lib/paths.js";
import { readJson, writeJson, log } from "./lib/io.js";
import { parseRss } from "./lib/rss.js";
import { extractMedia } from "./lib/article.js";
import { parseIsoDuration, collapseWs, windowEnd } from "../site/js/pure.js";

const FEEDS = [
  { feed: "vod", url: "https://www.kikar.co.il/category/vod/feed" },
  { feed: "music", url: "https://www.kikar.co.il/category/music/feed" },
];

function itemId(link) {
  return crypto.createHash("sha1").update(String(link)).digest("hex").slice(0, 12);
}

function seriesSlug(link) {
  try {
    const parts = new URL(link).pathname.split("/").filter(Boolean);
    return decodeURIComponent(parts[0] || "unknown");
  } catch {
    return "unknown";
  }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "kikar-radio/1.0", Accept: "text/html,application/xml,text/xml,*/*" },
    signal: AbortSignal.timeout(40000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function applyRules(catalog, selections, rules, auto) {
  const now = new Date();
  const next = { schemaVersion: 1, items: { ...(auto.items || {}) } };
  let added = 0;
  for (const item of catalog.items || []) {
    if (selections.items?.[item.id]) continue;
    if (next.items[item.id]) continue;
    const rule = (rules.rules || []).find((r) => r.enabled && r.seriesSlug === item.seriesSlug && r.action === "auto");
    if (!rule) continue;
    const end = windowEnd(rule.window || "week", now);
    next.items[item.id] = {
      ruleId: rule.id,
      playlistKey: rule.playlistKey || (item.feed === "music" ? "music" : "briefs"),
      window: rule.window || "week",
      windowStart: now.toISOString(),
      windowEnd: end.toISOString(),
      replacePrevious: !!rule.replacePrevious,
      approvedAt: now.toISOString(),
    };
    added += 1;
  }
  return { next, added };
}

async function main() {
  const limit = process.env.SCAN_LIMIT ? Number(process.env.SCAN_LIMIT) : 0;
  const prev = readJson(path.join(DATA, "catalog.json"), { schemaVersion: 1, items: [] });
  const byId = new Map((prev.items || []).map((item) => [item.id, item]));
  const seen = [];

  for (const source of FEEDS) {
    log("fetch feed", { feed: source.feed });
    const xml = await fetchText(source.url);
    let rssItems = parseRss(xml);
    if (limit > 0) rssItems = rssItems.slice(0, limit);
    log("rss items", { feed: source.feed, count: rssItems.length });
    const extracted = await mapPool(rssItems, 4, async (rss) => {
      const id = itemId(rss.link || rss.guid);
      const previous = byId.get(id);
      if (previous?.mediaUrl && previous.title) {
        return { ...previous, feed: source.feed };
      }
      try {
        const html = await fetchText(rss.link);
        const media = extractMedia(html);
        if (!media.mediaUrl) {
          log("no media", { id, link: rss.link });
          return null;
        }
        const durationSec = parseIsoDuration(media.durationIso);
        const pub = new Date(rss.pubDate);
        return {
          id,
          feed: source.feed,
          title: collapseWs(media.headline || rss.title),
          link: rss.link,
          guid: rss.guid || rss.link,
          pubDate: Number.isNaN(pub.getTime()) ? new Date().toISOString() : pub.toISOString(),
          description: collapseWs(rss.description).slice(0, 400),
          poster: media.poster || rss.enclosure || "",
          seriesSlug: seriesSlug(rss.link),
          seriesName: collapseWs(media.section) || seriesSlug(rss.link),
          mediaUrl: media.mediaUrl,
          durationSec,
          durationIso: media.durationIso || null,
        };
      } catch (err) {
        log("article failed", { link: rss.link, error: String(err.message || err).slice(0, 180) });
        return previous || null;
      }
    });
    for (const item of extracted) {
      if (item?.mediaUrl) seen.push(item);
    }
  }

  const cutoff = Date.now() - 45 * 86400000;
  const merged = new Map(seen.map((item) => [item.id, item]));
  for (const item of prev.items || []) {
    if (merged.has(item.id)) continue;
    if (item.pubDate && new Date(item.pubDate).getTime() >= cutoff) merged.set(item.id, item);
  }
  const items = [...merged.values()].sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)).slice(0, 400);
  const catalog = { schemaVersion: 1, updatedAt: new Date().toISOString(), items };
  writeJson(path.join(DATA, "catalog.json"), catalog);

  const selections = readJson(path.join(DATA, "selections.json"), { schemaVersion: 1, items: {} });
  const rules = readJson(path.join(DATA, "rules.json"), { schemaVersion: 1, rules: [], seriesMap: {} });
  const auto = readJson(path.join(DATA, "auto-approvals.json"), { schemaVersion: 1, items: {} });
  const applied = applyRules(catalog, selections, rules, auto);
  writeJson(path.join(DATA, "auto-approvals.json"), applied.next);
  log("scan done", { items: items.length, autoAdded: applied.added });
}

main().catch((err) => {
  console.error(String(err?.message || err).slice(0, 400));
  process.exit(1);
});
