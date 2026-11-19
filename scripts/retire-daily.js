/**
 * Take yesterday's daily news off playlist 9.
 * דבר ראשון and היום בכיכר stay only on their publish day, and only the newest episode.
 * Files stay on the server. Playlists 1, 2, 3 and 5 are never modified.
 */

import path from "node:path";
import { DATA } from "./lib/paths.js";
import { readJson } from "./lib/io.js";
import { requireKey, getFile, listDir, setManagedPlaylists } from "./lib/azura.js";
import { emptySystem, knownIdSet } from "./lib/playlists.js";
import { jerusalemParts } from "../site/js/pure.js";

const SHOWS = 9;
const FORBIDDEN = new Set([1, 2, 3, 5]);

function dayKey(iso) {
  if (!iso) return "";
  const p = jerusalemParts(iso);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function playlistIds(media) {
  return (media?.playlists || []).map((pl) => Number(pl.id)).filter((id) => Number.isFinite(id));
}

async function main() {
  const key = requireKey();
  const catalog = readJson(path.join(DATA, "catalog.json"), { items: [] });
  const uploads = readJson(path.join(DATA, "status/uploads.json"), { items: {} });
  const rules = readJson(path.join(DATA, "rules.json"), { rules: [] });
  const system = readJson(path.join(DATA, "system.json"), emptySystem());
  const ads = readJson(path.join(DATA, "ads.json"), {});
  const showsId = Number(system.playlists?.shows?.id);
  if (showsId !== SHOWS) throw new Error(`shows playlist is ${showsId}, expected ${SHOWS}`);
  if (FORBIDDEN.has(showsId)) throw new Error("refusing to touch a protected playlist");

  const daySlugs = new Set(
    (rules.rules || []).filter((rule) => rule.enabled !== false && rule.window === "day" && rule.seriesSlug).map((rule) => rule.seriesSlug),
  );
  if (!daySlugs.has("ayom-bakikar") || !daySlugs.has("davar-rishon")) {
    throw new Error("day rules for the two daily series are missing");
  }

  const byId = new Map();
  for (const item of catalog.items || []) {
    if (!daySlugs.has(item.seriesSlug)) continue;
    byId.set(item.id, {
      id: item.id,
      seriesSlug: item.seriesSlug,
      pubDate: item.pubDate || "",
      title: item.title || "",
    });
  }
  for (const [id, rec] of Object.entries(uploads.items || {})) {
    if (!daySlugs.has(rec.seriesSlug) || byId.has(id)) continue;
    byId.set(id, { id, seriesSlug: rec.seriesSlug, pubDate: "", title: rec.title || "" });
  }

  const fileToItem = new Map();
  for (const [id, rec] of Object.entries(uploads.items || {})) {
    const item = byId.get(id);
    if (!item || !rec.azuraFileId) continue;
    fileToItem.set(Number(rec.azuraFileId), item);
  }

  let listed = [];
  try {
    listed = await listDir(key, "kikar-auto/vod");
  } catch (err) {
    console.log(JSON.stringify({ list: "kikar-auto/vod", error: String(err.message || err).slice(0, 160) }));
  }
  for (const row of listed) {
    const fileId = Number(row.media?.id || row.id);
    const filePath = String(row.path || row.path_short || "");
    const match = filePath.match(/([a-f0-9]{12})\.mp3$/i);
    if (!fileId || !match) continue;
    const item = byId.get(match[1]);
    if (item) fileToItem.set(fileId, item);
  }

  const managed = knownIdSet(system, ads);
  for (const id of FORBIDDEN) managed.delete(id);
  if (!managed.has(SHOWS)) managed.add(SHOWS);

  const today = dayKey(new Date());
  const onAir = [];
  for (const [fileId, item] of fileToItem) {
    const media = await getFile(key, fileId);
    if (!media?.id) continue;
    const lists = playlistIds(media);
    if (lists.some((id) => FORBIDDEN.has(id) && id === SHOWS)) throw new Error("protected id collision");
    if (!lists.includes(SHOWS)) continue;
    onAir.push({
      fileId,
      itemId: item.id,
      seriesSlug: item.seriesSlug,
      pubDate: item.pubDate,
      day: dayKey(item.pubDate),
      title: String(media.title || item.title || "").slice(0, 120),
      lists,
    });
  }

  const keep = new Set();
  for (const slug of daySlugs) {
    const todays = onAir
      .filter((row) => row.seriesSlug === slug && row.day === today)
      .sort((a, b) => Date.parse(b.pubDate || 0) - Date.parse(a.pubDate || 0));
    if (todays[0]) keep.add(todays[0].fileId);
  }

  const removed = [];
  const kept = [];
  for (const row of onAir) {
    if (keep.has(row.fileId)) {
      kept.push({ fileId: row.fileId, itemId: row.itemId, seriesSlug: row.seriesSlug, day: row.day, title: row.title });
      continue;
    }
    const desired = row.lists.filter((id) => id !== SHOWS && managed.has(id) && !FORBIDDEN.has(id));
    if (desired.some((id) => FORBIDDEN.has(id))) throw new Error("refusing to write a protected playlist");
    await setManagedPlaylists(key, row.fileId, desired, managed);
    const after = await getFile(key, row.fileId);
    if (!after?.id) throw new Error(`file ${row.fileId} disappeared`);
    const afterLists = playlistIds(after);
    if (afterLists.includes(SHOWS)) throw new Error(`file ${row.fileId} is still on playlist 9`);
    const beforeProtected = row.lists.filter((id) => FORBIDDEN.has(id)).sort().join(",");
    const afterProtected = afterLists.filter((id) => FORBIDDEN.has(id)).sort().join(",");
    if (beforeProtected !== afterProtected) {
      throw new Error(`protected playlist membership changed for file ${row.fileId}`);
    }
    removed.push({ fileId: row.fileId, itemId: row.itemId, seriesSlug: row.seriesSlug, day: row.day, title: row.title });
  }

  console.log(JSON.stringify({ today, onAir: onAir.length, kept, removed }, null, 2));
}

main().catch((err) => {
  console.error(String(err.message || err).slice(0, 300));
  process.exit(1);
});
