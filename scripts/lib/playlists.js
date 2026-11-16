import { PLAYLISTS, MANAGED_MARKER, isProtectedName, isSweeperPlaylist } from "../../site/js/pure.js";
import { createPlaylist, listPlaylists } from "./azura.js";
import { log } from "./io.js";
import { PipelineError } from "./errors.js";

const CORE = {
  shows: {
    type: "default",
    order: "shuffle",
    weight: 3,
    is_jingle: false,
    play_per_songs: 0,
    play_per_minutes: 0,
    play_per_hour_minute: 0,
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
    weight: 3,
    is_jingle: false,
    play_per_songs: 0,
    play_per_minutes: 0,
    play_per_hour_minute: 0,
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
  }
  return changed;
}
