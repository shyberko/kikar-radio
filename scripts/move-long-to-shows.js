/** Move long music-playlist tracks onto shows, and put approved shows back. Never prints the API key. */

import path from "node:path";
import { DATA } from "./lib/paths.js";
import { readJson } from "./lib/io.js";
import { requireKey, listPlaylists, listDir, listHistory, getFile, setManagedPlaylists } from "./lib/azura.js";
import { emptySystem, knownIdSet } from "./lib/playlists.js";
import { keepDespiteReplace } from "../site/js/pure.js";

const MUSIC = 8;
const SHOWS = 9;
const LONG_SECONDS = 10 * 60;
const FORBIDDEN = new Set([1, 2, 3, 5]);

function countOf(playlists, id) {
  const pl = playlists.find((row) => Number(row.id) === id);
  return pl ? Number(pl.num_songs ?? 0) : null;
}

function onPlaylist(media, id) {
  return (media?.playlists || []).some((pl) => Number(pl.id) === id);
}

async function main() {
  const key = requireKey();
  const selections = readJson(path.join(DATA, "selections.json"), { items: {} });
  const uploads = readJson(path.join(DATA, "status/uploads.json"), { items: {} });
  const system = readJson(path.join(DATA, "system.json"), emptySystem());
  const ads = readJson(path.join(DATA, "ads.json"), {});
  const managed = knownIdSet(system, ads);
  managed.add(MUSIC);
  managed.add(SHOWS);
  for (const id of FORBIDDEN) managed.delete(id);

  const before = await listPlaylists(key);
  console.log(JSON.stringify({ before: { music: countOf(before, MUSIC), shows: countOf(before, SHOWS) } }));

  const wanted = new Map();
  for (const [id, rec] of Object.entries(uploads.items || {})) {
    if (!rec?.azuraFileId) continue;
    const sel = selections.items?.[id];
    const long = Number(rec.durationSec) > LONG_SECONDS;
    const critic = rec.seriesSlug === "the-music-critic" || String(rec.title || "").includes("500 ברגים");
    const onMusic = Number(rec.playlistId) === MUSIC || rec.playlistKey === "music";
    const pinnedShow = sel?.playlistKey === "shows" && keepDespiteReplace(sel, new Date()) && rec.azuraFileId;
    if ((onMusic && (long || critic)) || pinnedShow) {
      wanted.set(Number(rec.azuraFileId), {
        itemId: id,
        title: String(rec.title || "").slice(0, 80),
        durationSec: rec.durationSec || null,
        reason: critic ? "the-music-critic" : long && onMusic ? "longer-than-10-min" : "approved-show",
      });
    }
  }

  for (const dir of ["kikar-auto/music", "kikar-auto/vod", "sweepers"]) {
    let rows = [];
    try {
      rows = await listDir(key, dir);
    } catch (err) {
      console.log(JSON.stringify({ list: dir, error: String(err.message || err).slice(0, 120) }));
      continue;
    }
    for (const row of rows) {
      const media = row.media || {};
      const fileId = Number(media.id || row.id);
      const length = Number(media.length || row.length || 0);
      const lists = media.playlists || row.playlists || [];
      const inMusic = lists.some((pl) => Number(pl.id) === MUSIC);
      if (!fileId || !inMusic || length <= LONG_SECONDS) continue;
      if (!wanted.has(fileId)) {
        wanted.set(fileId, {
          itemId: null,
          title: String(media.title || row.text || row.path || "").slice(0, 80),
          durationSec: length,
          reason: "longer-than-10-min",
        });
      }
    }
  }

  for (const [fileId, info] of wanted) {
    if (FORBIDDEN.has(fileId)) continue;
    let media;
    try {
      media = await getFile(key, fileId);
    } catch (err) {
      console.log(JSON.stringify({ fileId, ...info, error: String(err.message || err).slice(0, 140) }));
      continue;
    }
    const lists = (media.playlists || []).map((pl) => Number(pl.id));
    if (lists.some((id) => FORBIDDEN.has(id))) {
      console.log(JSON.stringify({ fileId, skipped: "protected-membership", lists }));
      continue;
    }
    if (onPlaylist(media, SHOWS) && !onPlaylist(media, MUSIC) && info.reason === "approved-show") {
      continue;
    }
    if (!onPlaylist(media, MUSIC) && !onPlaylist(media, SHOWS) && info.reason !== "approved-show") continue;
    const finalIds = await setManagedPlaylists(key, fileId, [SHOWS], managed);
    console.log(JSON.stringify({ moved: fileId, ...info, playlists: finalIds }));
  }

  const after = await listPlaylists(key);
  console.log(JSON.stringify({ after: { music: countOf(after, MUSIC), shows: countOf(after, SHOWS) } }));

  const start = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  let history = [];
  try {
    history = await listHistory(key, start);
  } catch (err) {
    console.log(JSON.stringify({ historyError: String(err.message || err).slice(0, 180) }));
  }
  const counts = new Map();
  for (const row of history) {
    const title = row?.song?.title || row?.title || row?.song?.text || "";
    const playlist = row?.playlist?.name || (typeof row?.playlist === "string" ? row.playlist : "") || "";
    const when = row?.played_at || row?.timestamp || "";
    const keyName = `${title} | ${playlist}`;
    const prev = counts.get(keyName) || { count: 0, playlist, title: String(title).slice(0, 80), first: when, last: when };
    prev.count += 1;
    prev.last = when || prev.last;
    counts.set(keyName, prev);
  }
  const repeats = [...counts.values()].filter((row) => row.count > 1);
  console.log(JSON.stringify({
    historyRows: history.length,
    repeats: repeats.sort((a, b) => b.count - a.count).slice(0, 20),
  }));
}

main().catch((err) => {
  console.error(String(err.message || err).slice(0, 300));
  process.exit(1);
});
