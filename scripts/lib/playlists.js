import { PLAYLISTS, MANAGED_MARKER, isProtectedName, isSweeperPlaylist } from "../../site/js/pure.js";
import { createPlaylist, listPlaylists, patchPlaylist } from "./azura.js";
import { log } from "./io.js";
import { PipelineError } from "./errors.js";

const CORE = {
  shows: {
    type: "once_per_x_songs",
    order: "shuffle",
    weight: 1,
    is_jingle: false,
    play_per_songs: 4,
    play_per_minutes: 0,
    play_per_hour_minute: 0,
    avoid_duplicates: true,
  },
  briefs: {
    type: "default",
    order: "shuffle",
    weight: 3,
    is_jingle: false,
    play_per_songs: 0,
    play_per_minutes: 0,
    play_per_hour_minute: 0,
  },
  music: {
    type: "default",
    order: "shuffle",
    weight: 5,
    is_jingle: false,
    play_per_songs: 0,
    play_per_minutes: 0,
    play_per_hour_minute: 0,
    avoid_duplicates: true,
  },
  bulletin: {
    type: "once_per_hour",
    order: "sequential",
    weight: 6,
    is_jingle: false,
    play_per_songs: 0,
    play_per_minutes: 0,
    play_per_hour_minute: 8,
  },
};

/** Re-applied whenever we touch these playlists, so a later run does not restore equal weights. */
export const ROTATION_PATCH = {
  shows: {
    type: "once_per_x_songs",
    order: "shuffle",
    weight: 1,
    is_jingle: false,
    play_per_songs: 4,
    avoid_duplicates: true,
  },
  music: {
    type: "default",
    order: "shuffle",
    weight: 5,
    is_jingle: false,
    play_per_songs: 0,
    avoid_duplicates: true,
  },
  sweepers: {
    type: "once_per_x_songs",
    order: "shuffle",
    is_jingle: true,
    play_per_songs: 1,
    avoid_duplicates: true,
    is_enabled: true,
    schedule_items: [],
    backend_options: [],
  },
};

export const SWEEPER_MEDIA_IDS = [47, 48];

export function emptySystem() {
  return {
    schemaVersion: 1,
    playlists: {
      shows: { id: null, name: PLAYLISTS.shows.name },
      briefs: { id: null, name: PLAYLISTS.briefs.name },
      music: { id: null, name: PLAYLISTS.music.name },
      bulletin: { id: null, name: PLAYLISTS.bulletin.name },
    },
  };
}

export function knownIdSet(system, ads) {
  const ids = new Set();
  for (const row of Object.values(system?.playlists || {})) {
    if (row?.id != null) ids.add(Number(row.id));
  }
  for (const c of ads?.campaigns || []) {
    if (c.frequencyPlaylistId) ids.add(Number(c.frequencyPlaylistId));
    if (c.fixedPlaylistId) ids.add(Number(c.fixedPlaylistId));
  }
  if (ads?.jingles?.playlistId) ids.add(Number(ads.jingles.playlistId));
  if (ads?.sweepers?.playlistId) ids.add(Number(ads.sweepers.playlistId));
  return ids;
}

export async function ensureCorePlaylists(key, system, keys) {
  const live = await listPlaylists(key);
  for (const livePl of live) {
    if (isProtectedName(livePl.name)) {
      log("leaving protected playlist untouched", { id: livePl.id });
    }
  }
  let changed = false;
  for (const keyName of keys) {
    const def = PLAYLISTS[keyName];
    const extra = CORE[keyName];
    const description = `${MANAGED_MARKER} key:${keyName}`;
    const currentId = system.playlists[keyName]?.id;
    let found = live.find((pl) => currentId && Number(pl.id) === Number(currentId));
    if (found && isSweeperPlaylist(found)) {
      log("leaving sweeper playlist untouched", { id: found.id });
      found = null;
    }
    if (found && (isProtectedName(found.name) || !String(found.name).startsWith("כיכר אוטו"))) {
      throw new PipelineError("playlist", "stored playlist id no longer points at a managed playlist");
    }
    if (!found) {
      found = live.find(
        (pl) =>
          pl.name === def.name &&
          String(pl.description || "").includes(MANAGED_MARKER) &&
          !isProtectedName(pl.name) &&
          !isSweeperPlaylist(pl),
      );
    }
    if (!found) {
      const sameName = live.find((pl) => pl.name === def.name);
      if (sameName && !String(sameName.description || "").includes(MANAGED_MARKER)) {
        throw new PipelineError(
          "playlist",
          `פלייליסט בשם ${def.name} כבר קיים ולא נוצר על ידי המערכת. לא נוגעים בו.`,
        );
      }
      log("creating playlist", { playlist: keyName, name: def.name });
      found = await createPlaylist(key, {
        name: def.name,
        description,
        source: "songs",
        include_in_requests: false,
        include_in_on_demand: false,
        avoid_duplicates: true,
        is_enabled: true,
        backend_options: [],
        schedule_items: [],
        ...extra,
      });
      changed = true;
    }
    if (!system.playlists[keyName] || system.playlists[keyName].id !== found.id) changed = true;
    system.playlists[keyName] = { id: found.id, name: found.name || def.name };
    if (ROTATION_PATCH[keyName] && !isSweeperPlaylist(found) && !isProtectedName(found.name)) {
      await patchPlaylist(key, found.id, ROTATION_PATCH[keyName]);
      log("applied rotation settings", { playlist: keyName, id: found.id });
    }
  }
  return changed;
}

export async function ensureSweeperRotation(key, ads, live) {
  const id = Number(ads?.sweepers?.playlistId);
  if (!id) return;
  const found = (live || (await listPlaylists(key))).find((pl) => Number(pl.id) === id);
  if (!found || isProtectedName(found.name) || !isSweeperPlaylist(found)) {
    log("sweeper playlist id is not the managed sweeper; leaving it", { id });
    return;
  }
  await patchPlaylist(key, id, ROTATION_PATCH.sweepers);
  log("applied sweeper rotation", { id });
}
