import fs from "node:fs";
import path from "node:path";
import { DATA, TMP } from "./lib/paths.js";
import { readJson, writeJson, log } from "./lib/io.js";
import { parseRss } from "./lib/rss.js";
import { extractMedia } from "./lib/article.js";
import { requireKey, uploadBase64, setManagedPlaylists } from "./lib/azura.js";
import { ensureCorePlaylists, emptySystem, knownIdSet } from "./lib/playlists.js";
import { downloadTo } from "./lib/fetch-media.js";
import { transcodeToMp3, probeDuration } from "./lib/ffmpeg.js";
import { PipelineError, asPipeline } from "./lib/errors.js";
import {
  bulletinEdition,
  currentHourEdition,
  collapseWs,
  formatShortDate,
  jerusalemParts,
} from "../site/js/pure.js";

const FEED = "https://www.kikar.co.il/category/kikar-scoop-news/feed";

function pausedNow(control, now) {
  if (!control?.paused) return false;
  if (!control.pauseUntil || control.pauseMode === "manual") return true;
  return new Date(control.pauseUntil).getTime() > now.getTime();
}

function editionKey(edition) {
  const p = jerusalemParts(edition.start);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}-${edition.label}`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "kikar-radio/1.0" },
    signal: AbortSignal.timeout(40000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const key = requireKey();
  const now = new Date();
  const control = readJson(path.join(DATA, "bulletin-control.json"), { paused: false });
  const ads = readJson(path.join(DATA, "ads.json"), {});
  const system = readJson(path.join(DATA, "system.json"), emptySystem());
  const status = readJson(path.join(DATA, "status/bulletin.json"), {
    schemaVersion: 1,
    updatedAt: null,
    active: null,
    history: [],
    consecutiveFailures: 0,
    lastCheck: null,
    note: null,
    pauseRemovalFor: null,
  });

  await ensureCorePlaylists(key, system, ["bulletin"]);
  const managedIds = knownIdSet(system, ads);
  const playlistId = Number(system.playlists.bulletin.id);
  const hour = currentHourEdition(now);
  const isPaused = pausedNow(control, now);

  let pipelineFailed = false;
  status.lastCheck = now.toISOString();
  status.paused = isPaused;
  status.note = null;
  status.sourcePending = false;

  await expireOld(key, status, managedIds, playlistId, now);

  let rss = [];
  try {
    rss = parseRss(await fetchText(FEED));
  } catch (err) {
    status.note = "source";
    status.sourceMessage = "לא הצלחנו לקרוא את פיד המבזקים. ננסה שוב.";
    status.updatedAt = new Date().toISOString();
    writeJson(path.join(DATA, "status/bulletin.json"), status);
    writeJson(path.join(DATA, "system.json"), system);
    throw err;
  }

  const editions = [];
  for (const item of rss) {
    const edition = bulletinEdition(item.pubDate, item.title);
    if (Number.isNaN(edition.start.getTime())) continue;
    editions.push({ item, edition, key: editionKey(edition) });
  }
  const current = editions.find((row) => row.edition.label === hour.label && sameDay(row.edition.start, hour.start));

  if (isPaused) {
    status.note = "paused";
    if (control.removeCurrent && status.active?.fileId && status.pauseRemovalFor !== status.active.key) {
      await setManagedPlaylists(key, status.active.fileId, [], managedIds);
      status.active.removedAt = new Date().toISOString();
      status.active.onAir = false;
      status.pauseRemovalFor = status.active.key;
      log("removed bulletin because pause asked to");
    }
    if (!control.removeCurrent) status.pauseRemovalFor = null;
  } else {
    status.pauseRemovalFor = null;
  }

  if (!current) {
    status.sourcePending = true;
    status.sourceMessage = `כיכר עדיין לא פרסמו את מהדורת ${hour.label}. נמשיך לבדוק.`;
    if (!status.note) status.note = "source";
  } else if (now >= current.edition.expires) {
    status.note = status.note || "expired";
  } else if (!isPaused) {
    const already = (status.history || []).find((row) => row.key === current.key && row.uploadedAt && !row.failed);
    if (already?.fileId) {
      status.active = { ...already, onAir: true };
      status.note = "on-air";
    } else {
      try {
        const uploaded = await publishEdition(key, current, playlistId, managedIds, status);
        status.active = uploaded;
        status.consecutiveFailures = 0;
        status.note = "on-air";
        status.sourcePending = false;
        log("bulletin uploaded", { key: uploaded.key, at: uploaded.uploadedAt });
      } catch (err) {
        const mapped = err instanceof PipelineError ? err : asPipeline(err);
        pipelineFailed = true;
        status.consecutiveFailures = (status.consecutiveFailures || 0) + 1;
        status.note = "failed";
        status.failure = {
          key: current.key,
          label: current.edition.label,
          code: mapped.code,
          message: String(mapped.message || "").slice(0, 300),
          at: new Date().toISOString(),
        };
        pushHistory(status, {
          key: current.key,
          label: current.edition.label,
          editionStart: current.edition.start.toISOString(),
          expiresAt: current.edition.expires.toISOString(),
          link: current.item.link,
          failed: true,
          errorCode: mapped.code,
          errorMessage: status.failure.message,
          checkedAt: new Date().toISOString(),
        });
        log("bulletin failed", { code: mapped.code, message: status.failure.message });
      }
    }
  }

  if ((status.consecutiveFailures || 0) >= 3) {
    status.alert = "3 מהדורות אחרונות לא עלו";
  } else {
    status.alert = null;
  }
  status.hour = { label: hour.label, start: hour.start.toISOString(), expires: hour.expires.toISOString() };
  status.updatedAt = new Date().toISOString();
  status.history = (status.history || []).slice(0, 80);
  writeJson(path.join(DATA, "status/bulletin.json"), status);
  writeJson(path.join(DATA, "system.json"), system);
  if (pipelineFailed) process.exitCode = 1;
}

function sameDay(a, b) {
  const pa = jerusalemParts(a);
  const pb = jerusalemParts(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

async function expireOld(key, status, managedIds, playlistId, now) {
  const history = status.history || [];
  for (const row of history) {
    if (!row.fileId || !row.uploadedAt || row.failed) continue;
    const exp = row.expiresAt ? new Date(row.expiresAt) : null;
    if (!exp || now < exp) continue;
    if (row.removedAt) continue;
    try {
      await setManagedPlaylists(key, row.fileId, [], managedIds);
      row.removedAt = now.toISOString();
      row.onAir = false;
      log("expired bulletin removed", { key: row.key, playlistId });
    } catch (err) {
      log("expire remove failed", { key: row.key, message: String(err.message || err).slice(0, 180) });
    }
  }
  if (status.active?.fileId && status.active.expiresAt && now >= new Date(status.active.expiresAt)) {
    status.active.onAir = false;
    status.active.removedAt = status.active.removedAt || now.toISOString();
  }
}

async function publishEdition(key, current, playlistId, managedIds, status) {
  const html = await fetchText(current.item.link);
  const media = extractMedia(html);
  if (!media.mediaUrl) throw new PipelineError("download", "לא נמצא קובץ וידאו בכתבה");
  const work = path.join(TMP, "bulletin");
  fs.mkdirSync(work, { recursive: true });
  const src = path.join(work, "source.mp4");
  const mp3 = path.join(work, "audio.mp3");
  await downloadTo(media.mediaUrl, src);
  const title = `מבזק חדשות ${current.edition.label}`;
  await transcodeToMp3(src, mp3, {
    title,
    artist: "כיכר FM",
    album: "מבזק חדשות שעתי",
    comment: current.item.link,
    date: String(jerusalemParts(current.edition.start).year),
  });
  const durationSec = (await probeDuration(mp3)) || null;
  const p = jerusalemParts(current.edition.start);
  const dest = `kikar-auto/bulletins/${p.year}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}-${current.edition.label.replace(":", "")}.mp3`;
  const uploadedMedia = await uploadBase64(key, dest, mp3);
  const uploadedAt = new Date().toISOString();
  await setManagedPlaylists(key, uploadedMedia.id, [playlistId], managedIds);
  for (const row of status.history || []) {
    if (!row.fileId || row.fileId === uploadedMedia.id || row.removedAt) continue;
    try {
      await setManagedPlaylists(key, row.fileId, [], managedIds);
      row.removedAt = uploadedAt;
      row.onAir = false;
    } catch (err) {
      log("replace remove failed", { key: row.key, message: String(err.message || err).slice(0, 160) });
    }
  }
  if (status.active?.fileId && status.active.fileId !== uploadedMedia.id) {
    try {
      await setManagedPlaylists(key, status.active.fileId, [], managedIds);
    } catch {
      /* history loop covers it */
    }
  }
  const row = {
    key: current.key,
    label: current.edition.label,
    editionStart: current.edition.start.toISOString(),
    expiresAt: current.edition.expires.toISOString(),
    uploadedAt,
    durationSec,
    fileId: uploadedMedia.id,
    path: uploadedMedia.path || dest,
    link: current.item.link,
    poster: media.poster || current.item.enclosure || "",
    mediaUrl: media.mediaUrl,
    title: collapseWs(current.item.title),
    onAir: true,
    removedAt: null,
    failed: false,
    dateLabel: formatShortDate(current.edition.start),
  };
  pushHistory(status, row);
  fs.rmSync(work, { recursive: true, force: true });
  return row;
}

function pushHistory(status, row) {
  status.history = [row, ...(status.history || []).filter((x) => x.key !== row.key)];
}

main().catch((err) => {
  console.error(String(err?.message || err).slice(0, 400));
  process.exit(1);
});
