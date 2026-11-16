import fs from "node:fs";
import path from "node:path";
import { PipelineError, mapHttp, asPipeline } from "./errors.js";
import { log } from "./io.js";
import { isProtectedName, isManagedPlaylist, MANAGED_MARKER } from "../../site/js/pure.js";

const BASE = "https://radiocast.kikar.co.il/api";
const STATION = "1";

export function requireKey() {
  const key = process.env.RADIOCAST_API_KEY;
  if (!key || !String(key).trim()) {
    throw new PipelineError("auth", "RADIOCAST_API_KEY is not set");
  }
  return String(key).trim();
}

async function request(key, method, apiPath, { json, timeout = 180000 } = {}) {
  const headers = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  let res;
  try {
    res = await fetch(`${BASE}${apiPath}`, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (err) {
    throw asPipeline(err);
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 300) };
    }
  }
  if (!res.ok) {
    const message = String(data?.message || data?.formatted_message || res.statusText || "request failed")
      .replace(/<[^>]+>/g, "")
      .slice(0, 300);
    throw new PipelineError(mapHttp(res.status, data), message);
  }
  return data;
}

export async function listPlaylists(key) {
  const rows = await request(key, "GET", `/station/${STATION}/playlists`);
  return Array.isArray(rows) ? rows : [];
}

export async function createPlaylist(key, body) {
  if (isProtectedName(body?.name)) throw new PipelineError("playlist", "refusing to create a protected playlist");
  if (!String(body.name || "").startsWith("כיכר אוטו")) {
    throw new PipelineError("playlist", "refusing to create a playlist outside the managed prefix");
  }
  if (!String(body.description || "").includes(MANAGED_MARKER)) {
    throw new PipelineError("playlist", "refusing to create a playlist without the managed marker");
  }
  return request(key, "POST", `/station/${STATION}/playlists`, { json: body });
}

/**
 * AzuraCast returns 500 when this station receives a full playlist body.
 * Send only play_per_hour_minute.
 */
const UNTOUCHABLE_PLAYLISTS = new Set([1, 2, 3, 5]);

/** Partial playlist update. A full playlist body returns 500 on this station. */
export async function patchPlaylist(key, playlistId, fields) {
  const id = Number(playlistId);
  if (UNTOUCHABLE_PLAYLISTS.has(id)) {
    throw new PipelineError("playlist", "refusing to modify a protected playlist");
  }
  const allowed = [
    "type",
    "order",
    "weight",
    "play_per_songs",
    "play_per_minutes",
    "play_per_hour_minute",
    "is_jingle",
    "avoid_duplicates",
    "is_enabled",
    "schedule_items",
    "backend_options",
  ];
  const body = {};
  for (const name of allowed) if (fields[name] !== undefined) body[name] = fields[name];
  try {
    return await request(key, "PUT", `/station/${STATION}/playlist/${id}`, { json: body });
  } catch (err) {
    if (!/500|internal/i.test(String(err.message || ""))) throw err;
    let last = null;
    for (const [name, value] of Object.entries(body)) {
      last = await request(key, "PUT", `/station/${STATION}/playlist/${id}`, { json: { [name]: value } });
    }
    return last;
  }
}

export async function setPlaylistHourMinute(key, playlistId, minute) {
  const play = Number(minute);
  if (!Number.isInteger(play) || play < 0 || play > 59) {
    throw new PipelineError("playlist", "play_per_hour_minute out of range");
  }
  return request(key, "PUT", `/station/${STATION}/playlist/${playlistId}`, {
    json: { play_per_hour_minute: play },
  });
}

export async function renameFile(key, fromPath, toPath) {
  return request(key, "PUT", `/station/${STATION}/files/rename`, {
    json: { path: fromPath, newPath: toPath },
  });
}

export async function updatePlaylist(key, playlist, patch, knownIds) {
  assertTouchable(playlist, knownIds);
  return request(key, "PUT", `/station/${STATION}/playlist/${playlist.id}`, {
    json: { ...publicFields(playlist), ...patch, description: playlist.description || patch.description },
  });
}

export async function getFile(key, id) {
  return request(key, "GET", `/station/${STATION}/file/${id}`);
}

export async function deleteFile(key, id) {
  return request(key, "DELETE", `/station/${STATION}/file/${id}`);
}

export async function listDir(key, dir) {
  const q = new URLSearchParams({ currentDirectory: dir, flushCache: "true" });
  const rows = await request(key, "GET", `/station/${STATION}/files/list?${q}`);
  return Array.isArray(rows) ? rows : [];
}

export async function uploadBase64(key, destPath, filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length > 24 * 1024 * 1024) {
    return uploadFlow(key, destPath, filePath);
  }
  const data = await request(key, "POST", `/station/${STATION}/files`, {
    json: { path: destPath, file: bytes.toString("base64") },
    timeout: 300000,
  });
  if (data?.id) return data;
  return findUploaded(key, destPath);
}

async function uploadFlow(key, destPath, filePath) {
  const dir = path.posix.dirname(destPath);
  const filename = path.posix.basename(destPath);
  const buf = fs.readFileSync(filePath);
  const chunkSize = 4 * 1024 * 1024;
  const total = Math.max(1, Math.ceil(buf.length / chunkSize));
  const identifier = `${Date.now()}-${filename}`.replace(/[^a-zA-Z0-9_-]/g, "");
  for (let i = 0; i < total; i++) {
    const slice = buf.subarray(i * chunkSize, Math.min(buf.length, (i + 1) * chunkSize));
    const form = new FormData();
    form.set("flowChunkNumber", String(i + 1));
    form.set("flowChunkSize", String(chunkSize));
    form.set("flowCurrentChunkSize", String(slice.length));
    form.set("flowTotalSize", String(buf.length));
    form.set("flowIdentifier", identifier);
    form.set("flowFilename", filename);
    form.set("flowRelativePath", filename);
    form.set("flowTotalChunks", String(total));
    form.set("currentDirectory", dir === "." ? "" : dir);
    form.set("file", new Blob([slice]), filename);
    let res;
    try {
      res = await fetch(`${BASE}/station/${STATION}/files/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        body: form,
        signal: AbortSignal.timeout(300000),
      });
    } catch (err) {
      throw asPipeline(err);
    }
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      throw new PipelineError(mapHttp(res.status, text), text.slice(0, 300) || "flow upload failed");
    }
  }
  return findUploaded(key, destPath);
}

async function findUploaded(key, destPath) {
  const dir = path.posix.dirname(destPath);
  const base = path.posix.basename(destPath);
  for (let attempt = 0; attempt < 8; attempt++) {
    const rows = await listDir(key, dir === "." ? "" : dir);
    const hit = rows.find((row) => {
      const p = String(row.path || row.path_short || row.text || "");
      return p.endsWith(base) || p.endsWith(`/${base}`);
    });
    if (hit?.media?.id) return hit.media;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new PipelineError("unknown", "הקובץ עלה אבל המזהה לא נמצא ברשימת הקבצים");
}

/**
 * Set this file's managed playlist membership.
 * Playlists we do not manage — including "election" — stay as they are.
 */
export async function setManagedPlaylists(key, fileId, desiredIds, managedIds) {
  const media = await getFile(key, fileId);
  const existing = Array.isArray(media?.playlists) ? media.playlists : [];
  const keep = [];
  for (const pl of existing) {
    const id = Number(pl.id);
    const name = pl.name || "";
    if (isProtectedName(name)) {
      keep.push(id);
      continue;
    }
    if (!managedIds.has(id)) keep.push(id);
  }
  const electionIds = new Set(
    existing.filter((pl) => isProtectedName(pl.name)).map((pl) => Number(pl.id)),
  );
  const desired = [...desiredIds]
    .map(Number)
    .filter((id) => managedIds.has(id) && !electionIds.has(id));
  const finalIds = [...new Set([...keep, ...desired])];
  await request(key, "PUT", `/station/${STATION}/file/${fileId}`, {
    json: { playlists: finalIds },
  });
  return finalIds;
}

export function assertTouchable(playlist, knownIds) {
  if (!isManagedPlaylist(playlist, knownIds || new Set())) {
    throw new PipelineError("playlist", "refusing to modify a playlist this system did not create");
  }
}

function publicFields(playlist) {
  return {
    name: playlist.name,
    description: playlist.description,
    type: playlist.type,
    source: playlist.source || "songs",
    order: playlist.order || "shuffle",
    is_enabled: playlist.is_enabled !== false,
    is_jingle: !!playlist.is_jingle,
    play_per_songs: playlist.play_per_songs || 0,
    play_per_minutes: playlist.play_per_minutes || 0,
    play_per_hour_minute: playlist.play_per_hour_minute || 0,
    weight: playlist.weight || 3,
    include_in_requests: false,
    include_in_on_demand: false,
    avoid_duplicates: playlist.avoid_duplicates !== false,
    backend_options: playlist.backend_options || [],
    schedule_items: playlist.schedule_items || [],
  };
}

export async function ensureDir(key, dir) {
  const parts = String(dir).split("/").filter(Boolean);
  let cur = "";
  for (const name of parts) {
    try {
      await request(key, "POST", `/station/${STATION}/files/mkdir`, {
        json: { currentDirectory: cur, name },
      });
    } catch (err) {
      log("mkdir skipped", { name, code: err.code });
    }
    cur = cur ? `${cur}/${name}` : name;
  }
}

export { BASE, STATION };
