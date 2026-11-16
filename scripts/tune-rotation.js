/** One-off: print and correct playlists 8, 9 and 10. Never prints the API key. */

import { requireKey, listPlaylists, getFile, setManagedPlaylists, patchPlaylist } from "./lib/azura.js";
import { ROTATION_PATCH, SWEEPER_MEDIA_IDS } from "./lib/playlists.js";

const ALLOWED = {
  8: { key: "music", name: "כיכר אוטו – מוזיקה" },
  9: { key: "shows", name: "כיכר אוטו – תוכניות" },
  10: { key: "sweepers", name: "כיכר אוטו – מעברונים" },
};
const FORBIDDEN = new Set([1, 2, 3, 5]);
const MANAGED = new Set([6, 7, 8, 9, 10]);

function view(pl) {
  return {
    id: pl.id,
    name: pl.name,
    type: pl.type,
    order: pl.order,
    weight: pl.weight,
    play_per_songs: pl.play_per_songs,
    is_jingle: !!pl.is_jingle,
    avoid_duplicates: pl.avoid_duplicates,
    is_enabled: pl.is_enabled !== false,
    num_songs: pl.num_songs ?? null,
    schedule: Array.isArray(pl.schedule_items) ? pl.schedule_items.length : 0,
  };
}

function fileView(media) {
  const lists = Array.isArray(media?.playlists) ? media.playlists : [];
  return {
    id: media?.id ?? null,
    path: media?.path || "",
    length: media?.length ?? media?.length_text ?? null,
    playlists: lists.map((pl) => ({ id: pl.id, name: pl.name })),
  };
}

async function main() {
  const key = requireKey();
  const live = await listPlaylists(key);
  const byId = new Map(live.map((pl) => [Number(pl.id), pl]));
  console.log("BEFORE");
  for (const id of [8, 9, 10]) {
    const pl = byId.get(id);
    if (!pl) {
      console.log(JSON.stringify({ id, missing: true }));
      continue;
    }
    if (FORBIDDEN.has(Number(pl.id)) || !String(pl.name || "").startsWith("כיכר אוטו")) {
      throw new Error(`refusing playlist ${id}`);
    }
    console.log(JSON.stringify(view(pl)));
  }
  for (const mediaId of SWEEPER_MEDIA_IDS) {
    try {
      console.log(`FILE ${JSON.stringify(fileView(await getFile(key, mediaId)))}`);
    } catch (err) {
      console.log(`FILE ${JSON.stringify({ id: mediaId, error: String(err.message || err).slice(0, 160) })}`);
    }
  }

  for (const [idText, spec] of Object.entries(ALLOWED)) {
    const id = Number(idText);
    const pl = byId.get(id);
    if (!pl || pl.name !== spec.name) {
      console.log(JSON.stringify({ id, skipped: true, reason: pl ? pl.name : "missing" }));
      continue;
    }
    await patchPlaylist(key, id, ROTATION_PATCH[spec.key]);
    console.log(JSON.stringify({ id, patched: spec.key }));
  }

  for (const mediaId of SWEEPER_MEDIA_IDS) {
    try {
      const media = await getFile(key, mediaId);
      const path = String(media?.path || "");
      if (path && !path.includes("sweeper") && !path.includes("מעברון")) {
        console.log(JSON.stringify({ id: mediaId, skipped: true, reason: "path is not a sweeper" }));
        continue;
      }
      const finalIds = await setManagedPlaylists(key, mediaId, [10], MANAGED);
      console.log(JSON.stringify({ id: mediaId, playlists: finalIds }));
    } catch (err) {
      console.log(JSON.stringify({ id: mediaId, error: String(err.message || err).slice(0, 180) }));
    }
  }

  const after = await listPlaylists(key);
  console.log("AFTER");
  for (const id of [8, 9, 10]) {
    const pl = after.find((row) => Number(row.id) === id);
    console.log(JSON.stringify(pl ? view(pl) : { id, missing: true }));
  }
  for (const mediaId of SWEEPER_MEDIA_IDS) {
    try {
      console.log(`FILE ${JSON.stringify(fileView(await getFile(key, mediaId)))}`);
    } catch (err) {
      console.log(`FILE ${JSON.stringify({ id: mediaId, error: String(err.message || err).slice(0, 160) })}`);
    }
  }
}

main().catch((err) => {
  console.error(String(err.message || err).slice(0, 300));
  process.exit(1);
});
