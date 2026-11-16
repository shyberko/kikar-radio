import fs from "node:fs";
import path from "node:path";
import { DATA, TMP } from "./lib/paths.js";
import { readJson, writeJson, log } from "./lib/io.js";
import { parseRss } from "./lib/rss.js";
import { extractMedia } from "./lib/article.js";
import { requireKey, uploadBase64, setManagedPlaylists, deleteFile, getFile, renameFile, setPlaylistHourMinute, listPlaylists } from "./lib/azura.js";
import { ensureCorePlaylists, emptySystem, knownIdSet } from "./lib/playlists.js";
import { downloadTo } from "./lib/fetch-media.js";
import { transcodeToMp3, probeDuration } from "./lib/ffmpeg.js";
import { PipelineError, asPipeline } from "./lib/errors.js";
import {
  bulletinEdition,
  bulletinPlayMinute,
  bulletinWatchPlan,
  currentHourEdition,
  collapseWs,
  formatShortDate,
  isProtectedName,
  isSweeperPlaylist,
  jerusalemParts,
  MANAGED_PREFIX,
  shouldRetireBulletin,
} from "../site/js/pure.js";
import { spawnSync } from "node:child_process";

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

async function runOnce() {
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

  const fingerprint = () => JSON.stringify({
    note: status.note,
    activeKey: status.active?.key || null,
    onAir: status.active?.onAir ?? null,
    removed: (status.history || []).map((row) => [row.key, row.removedAt || null, row.deletedAt || null, row.failed || false]),
    slotFor: status.slotFor || null,
    playMinute: status.playMinute ?? null,
    alert: status.alert || null,
    failure: status.failure?.key || null,
    paused: !!status.paused,
    sourcePending: !!status.sourcePending,
  });
  const before = fingerprint();
  let pipelineFailed = false;
  let uploadedNow = false;
  status.lastCheck = now.toISOString();
  status.paused = isPaused;
  status.note = null;
  status.sourcePending = false;

  await expireOld(key, status, managedIds, now);

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
      status.failure = null;
      uploadedNow = true;
      if (status.slotPending === current.key && status.slotFor !== current.key) {
        await rememberSlot(key, playlistId, status, current.key);
      }
    } else {
      try {
        const uploaded = await publishEdition(key, current, playlistId, managedIds, status);
        status.active = uploaded;
        status.consecutiveFailures = 0;
        status.note = "on-air";
        status.failure = null;
        status.sourcePending = false;
        uploadedNow = true;
        log("bulletin uploaded", { edition: uploaded.key, at: uploaded.uploadedAt });
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
  status.history = (status.history || []).slice(0, 80);
  const outcome = {
    uploaded: uploadedNow,
    failed: pipelineFailed,
    note: pipelineFailed ? status.failure?.message || status.sourceMessage || "העלאת המבזק נכשלה" : "",
  };
  if (fingerprint() === before) {
    log("bulletin unchanged; skipping commit");
    return outcome;
  }
  status.updatedAt = new Date().toISOString();
  writeJson(path.join(DATA, "status/bulletin.json"), status);
  writeJson(path.join(DATA, "system.json"), system);
  return outcome;
}

function sameDay(a, b) {
  const pa = jerusalemParts(a);
  const pb = jerusalemParts(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

function bulletinPathOk(filePath) {
  const text = String(filePath || "").replace(/\\/g, "/");
  return text.includes("kikar-auto/bulletins/") && !text.includes("..");
}

function syncRetired(status, row) {
  const stamp = (target) => {
    if (!target || Number(target.fileId) !== Number(row.fileId)) return;
    target.removedAt = row.removedAt || target.removedAt;
    target.onAir = false;
    if (row.deletedAt) target.deletedAt = row.deletedAt;
    if (row.path) target.path = row.path;
  };
  stamp(status.active);
  for (const other of status.history || []) stamp(other);
}

async function retireBulletinFile(key, row, managedIds) {
  if (!row?.fileId || row.deletedAt) return;
  let filePath = row.path || "";
  try {
    if (!row.removedAt) {
      await setManagedPlaylists(key, row.fileId, [], managedIds);
      row.removedAt = new Date().toISOString();
      row.onAir = false;
      log("bulletin removed from playlist", { fileId: row.fileId, edition: row.key });
    }
  } catch (err) {
    const missing = err.code === "playlist" || /404|not found/i.test(String(err.message || ""));
    if (!missing) {
      log("bulletin unassign failed", { fileId: row.fileId, message: String(err.message || err).slice(0, 160) });
      return;
    }
    row.removedAt = row.removedAt || new Date().toISOString();
    row.onAir = false;
  }
  if (!bulletinPathOk(filePath)) {
    try {
      const media = await getFile(key, row.fileId);
      filePath = media?.path || "";
    } catch (err) {
      if (err.code === "playlist" || /404|not found/i.test(String(err.message || ""))) {
        row.deletedAt = new Date().toISOString();
      }
      return;
    }
  }
  if (!bulletinPathOk(filePath)) {
    log("refusing to delete non-bulletin file", { fileId: row.fileId, path: String(filePath).slice(0, 120) });
    return;
  }
  try {
    await deleteFile(key, row.fileId);
    row.deletedAt = new Date().toISOString();
    log("deleted bulletin file", { fileId: row.fileId, path: filePath });
  } catch (err) {
    if (err.code === "playlist" || /404|not found/i.test(String(err.message || ""))) {
      row.deletedAt = new Date().toISOString();
      return;
    }
    const base = filePath.split("/").pop();
    const dest = `kikar-auto/bulletins/expired/${Date.now()}-${base}`;
    try {
      await renameFile(key, filePath, dest);
      row.path = dest;
      row.deletedAt = new Date().toISOString();
      log("moved bulletin file out of rotation", { fileId: row.fileId, dest });
    } catch (err2) {
      log("bulletin delete failed", { fileId: row.fileId, message: String(err2.message || err2).slice(0, 160) });
    }
  }
}

async function retireBulletins(key, status, managedIds, now, options) {
  const rows = [...(status.history || [])];
  if (status.active?.fileId) rows.push(status.active);
  const seen = new Set();
  for (const row of rows) {
    if (!row?.fileId || seen.has(Number(row.fileId))) continue;
    seen.add(Number(row.fileId));
    if (!shouldRetireBulletin(row, now, options)) continue;
    await retireBulletinFile(key, row, managedIds);
    syncRetired(status, row);
  }
}

async function expireOld(key, status, managedIds, now) {
  await retireBulletins(key, status, managedIds, now, { replaceAll: false });
  if (status.active?.fileId && status.active.expiresAt && now >= new Date(status.active.expiresAt)) {
    status.active.onAir = false;
    status.active.removedAt = status.active.removedAt || now.toISOString();
  }
}

async function rememberSlot(key, playlistId, status, editionKey) {
  const live = await listPlaylists(key);
  const pl = live.find((row) => Number(row.id) === Number(playlistId));
  const name = String(pl?.name || "");
  const description = String(pl?.description || "");
  if (!pl || isProtectedName(name) || isSweeperPlaylist(pl) || !name.startsWith(MANAGED_PREFIX)) {
    throw new PipelineError("playlist", "refusing to retune a playlist that is not the hourly bulletin");
  }
  if (!description.includes("key:bulletin") && !name.includes("מבזק שעתי")) {
    throw new PipelineError("playlist", "refusing to retune a playlist that is not the hourly bulletin");
  }
  const playAt = bulletinPlayMinute(jerusalemParts(new Date()).minute);
  await setPlaylistHourMinute(key, playlistId, playAt);
  status.slotFor = editionKey;
  status.playMinute = playAt;
  status.slotPending = null;
  log("bulletin slot moved", { playlistId, play_per_hour_minute: playAt });
  return playAt;
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
  await retireBulletins(key, status, managedIds, new Date(), { replaceAll: true });
  const uploadedMedia = await uploadBase64(key, dest, mp3);
  const uploadedAt = new Date().toISOString();
  await setManagedPlaylists(key, uploadedMedia.id, [playlistId], managedIds);
  status.slotPending = current.key;
  await rememberSlot(key, playlistId, status, current.key);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function commitStatus() {
  if (!process.env.GITHUB_ACTIONS) return;
  const result = spawnSync(
    "bash",
    ["scripts/ci-commit.sh", "עדכון מבזק שעתי", "data/system.json", "data/status/bulletin.json"],
    { stdio: "inherit" },
  );
  if (result.status) log("status commit failed", { status: result.status });
}

function writeOutputs(uploaded, note) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const safe = String(note || "").replace(/[\r\n]/g, " ").slice(0, 500);
  fs.appendFileSync(file, `uploaded=${uploaded ? "true" : "false"}\nnote=${safe}\n`);
}

function finish(result) {
  const uploaded = !!result?.uploaded;
  const note = result?.note || "";
  writeOutputs(uploaded, note);
  if (uploaded) {
    console.log(note ? `המהדורה עלתה. ניסיונות מוקדמים שלא הצליחו: ${note}` : "המהדורה עלתה.");
    process.exitCode = 0;
    return;
  }
  if (result?.failed) {
    console.error(`המבזק לא עלה. ${note}`.trim());
    process.exitCode = 1;
  }
}

async function watch() {
  let uploaded = false;
  let failed = false;
  const notes = [];
  for (let loop = 0; loop < 30; loop += 1) {
    const plan = bulletinWatchPlan(jerusalemParts(new Date()));
    const clock = jerusalemParts(new Date());
    log("bulletin watch", {
      israel: `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`,
      phase: plan.phase,
      loop,
    });
    if (plan.phase === "sleep-until-hour") {
      await sleep(plan.waitMs);
      continue;
    }
    let result = { uploaded: false, failed: false, note: "" };
    try {
      result = (await runOnce()) || result;
    } catch (err) {
      result = { uploaded: false, failed: true, note: String(err?.message || err).slice(0, 300) };
    }
    if (result.uploaded) uploaded = true;
    if (result.failed) failed = true;
    if (result.note) notes.push(result.note);
    commitStatus();
    if (plan.phase === "once") break;
    await sleep(plan.waitMs);
  }
  return { uploaded, failed, note: [...new Set(notes.filter(Boolean))].join(" | ").slice(0, 500) };
}

const entry = async () => {
  if (process.env.BULLETIN_WATCH === "1") finish(await watch());
  else finish(await runOnce());
};
entry().catch((err) => {
  const note = String(err?.message || err).slice(0, 400);
  console.error(note);
  writeOutputs(false, note);
  process.exit(1);
});
