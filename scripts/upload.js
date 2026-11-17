import fs from "node:fs";
import path from "node:path";
import { DATA, TMP } from "./lib/paths.js";
import { readJson, writeJson, log } from "./lib/io.js";
import { requireKey, uploadBase64, setManagedPlaylists, updatePlaylist, listPlaylists } from "./lib/azura.js";
import { ensureCorePlaylists, ensureSweeperRotation, emptySystem, knownIdSet } from "./lib/playlists.js";
import { downloadTo } from "./lib/fetch-media.js";
import { transcodeToMp3, probeDuration } from "./lib/ffmpeg.js";
import { PipelineError, asPipeline } from "./lib/errors.js";
import { isProtectedName, collapseWs, endOfJerusalemDay, jerusalemParts, planRotationExpiry, playlistKeyForIntent, keepDespiteReplace, ROTATION_PLAYLIST_KEYS, ROTATION_MIN } from "../site/js/pure.js";

function intentFor(id, selections, auto) {
  const sel = selections.items?.[id];
  if (sel) {
    if (sel.status !== "approved") return null;
    return sel;
  }
  const row = auto.items?.[id];
  if (!row) return null;
  return {
    status: "approved",
    playlistKey: row.playlistKey,
    window: row.window,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    replacePrevious: !!row.replacePrevious,
    uploadNow: false,
    source: "rule",
    ruleId: row.ruleId,
  };
}

function runMeta() {
  const id = process.env.GITHUB_RUN_ID;
  const repo = process.env.GITHUB_REPOSITORY;
  const server = process.env.GITHUB_SERVER_URL || "https://github.com";
  return {
    runId: id || null,
    runUrl: id && repo ? `${server}/${repo}/actions/runs/${id}` : null,
  };
}

async function assignExact(key, fileId, keepIds, managedIds) {
  await setManagedPlaylists(key, fileId, keepIds, managedIds);
}

function dateTag(iso) {
  if (!iso) return "";
  const p = jerusalemParts(iso);
  return `${p.year}`;
}

async function main() {
  const key = requireKey();
  const onlyId = String(process.env.ITEM_ID || "").trim();
  if (onlyId && !/^[a-zA-Z0-9_-]{4,40}$/.test(onlyId)) {
    throw new PipelineError("unknown", "item id לא תקין");
  }
  fs.mkdirSync(TMP, { recursive: true });
  const catalog = readJson(path.join(DATA, "catalog.json"), { items: [] });
  const selections = readJson(path.join(DATA, "selections.json"), { items: {} });
  const auto = readJson(path.join(DATA, "auto-approvals.json"), { items: {} });
  const ads = readJson(path.join(DATA, "ads.json"), { campaigns: [] });
  const system = readJson(path.join(DATA, "system.json"), emptySystem());
  const uploads = readJson(path.join(DATA, "status/uploads.json"), {
    schemaVersion: 1,
    updatedAt: null,
    lastRun: null,
    items: {},
  });
  const runsDoc = readJson(path.join(DATA, "status/runs.json"), { schemaVersion: 1, runs: [] });
  const byId = new Map((catalog.items || []).map((item) => [item.id, item]));

  await ensureCorePlaylists(key, system, ["shows", "briefs", "music"]);
  await ensureSweeperRotation(key, ads, await listPlaylists(key));
  const managedIds = knownIdSet(system, ads);
  const playlistIdFor = (playlistKey) => {
    const id = system.playlists?.[playlistKey]?.id;
    if (!id) throw new PipelineError("playlist", `הפלייליסט ${playlistKey} לא נוצר`);
    return Number(id);
  };

  const started = new Date();
  const summary = { uploaded: 0, failed: 0, removed: 0, held: 0, reassigned: 0 };
  const ids = new Set([
    ...Object.keys(selections.items || {}),
    ...Object.keys(auto.items || {}),
    ...Object.keys(uploads.items || {}),
  ]);
  const rotationPlan = planRotationExpiry(
    [...ids].map((id) => {
      const intent = intentFor(id, selections, auto);
      const rec = uploads.items[id] || {};
      return {
        id,
        playlistKey: intent?.playlistKey || rec.playlistKey,
        playlistId: rec.playlistId,
        state: rec.state,
        azuraFileId: rec.azuraFileId,
        uploadedAt: rec.uploadedAt,
        windowEnd: intent ? intent.windowEnd : rec.windowEnd,
        explicitRemove: !intent,
      };
    }),
    started,
  );
  const holdIds = new Set(rotationPlan.keepIds);
  if (rotationPlan.held) {
    log("kept oldest-expired general-rotation items", {
      ids: rotationPlan.keepIds,
      floor: rotationPlan.floor,
      reason: "rotation would drop below the minimum",
    });
  }

  for (const id of ids) {
    const item = byId.get(id);
    const existing = uploads.items[id];
    const intentPreview = intentFor(id, selections, auto);
    if (!existing && !intentPreview) continue;
    const rec = existing || {
      state: "queued",
      attempts: 0,
      azuraFileId: null,
      azuraPath: null,
      playlistKey: null,
      playlistId: null,
    };
    uploads.items[id] = rec;
    const intent = intentFor(id, selections, auto);
    const now = new Date();
    try {
      const playlistKey = playlistKeyForIntent(intent?.playlistKey || rec.playlistKey, item?.durationSec || rec.durationSec);
      const playlistId = playlistKey && system.playlists?.[playlistKey]?.id ? Number(system.playlists[playlistKey].id) : rec.playlistId;
      const windowEndAt = intent?.windowEnd ? new Date(intent.windowEnd) : null;
      const active = rec.state === "active" && rec.azuraFileId && playlistId;

      if (holdIds.has(id)) {
        rec.state = "active";
        rec.heldForRotation = true;
        summary.held += 1;
        log("kept general-rotation item past its window", { id, playlistKey, floor: ROTATION_MIN });
        continue;
      }

      if (!intent || (windowEndAt && now >= windowEndAt)) {
        if (rec.azuraFileId && playlistId && (rec.state === "active" || rec.state === "expiring")) {
          await assignExact(key, rec.azuraFileId, [], managedIds);
          rec.state = intent ? "expired" : "removed";
          rec.removedAt = now.toISOString();
          rec.playlistId = playlistId;
          summary.removed += 1;
          log("removed from playlist", { id, state: rec.state });
        } else if (intent && windowEndAt && now >= windowEndAt && rec.state !== "expired") {
          rec.state = "expired";
        }
        continue;
      }

      const urgentOnly = Boolean(onlyId);
      const selected = !urgentOnly || id === onlyId || intent.uploadNow;
      if (!selected) continue;
      if (!item?.mediaUrl) {
        throw new PipelineError("download", "אין כתובת מדיה בקטלוג");
      }

      if (rec.azuraFileId && rec.state !== "failed") {
        const targetKey = playlistKeyForIntent(intent.playlistKey, item?.durationSec || rec.durationSec);
        await assignExact(key, rec.azuraFileId, [playlistIdFor(targetKey)], managedIds);
        rec.state = "active";
        rec.playlistKey = targetKey;
        rec.playlistId = playlistIdFor(targetKey);
        rec.windowEnd = intent.windowEnd;
        rec.removedAt = null;
        rec.errorCode = null;
        rec.errorMessage = null;
        summary.reassigned += 1;
        if (intent.replacePrevious && item) await replaceOlder(key, uploads, item, rec, managedIds, selections);
        continue;
      }

      if (rec.state === "failed" && rec.attempts >= 3) {
        const retryAt = intent.retryAt ? new Date(intent.retryAt).getTime() : 0;
        const failedAt = rec.failedAt ? new Date(rec.failedAt).getTime() : 0;
        if (retryAt <= failedAt && !intent.uploadNow && id !== onlyId) continue;
      }

      rec.state = "uploading";
      const work = path.join(TMP, id);
      fs.mkdirSync(work, { recursive: true });
      const src = path.join(work, "source.mp4");
      const mp3 = path.join(work, "audio.mp3");
      log("download", { id, title: item.title });
      await downloadTo(item.mediaUrl, src);
      await transcodeToMp3(src, mp3, {
        title: collapseWs(item.title).slice(0, 180),
        artist: item.seriesName || "כיכר השבת",
        album: item.seriesName || (item.feed === "music" ? "מוזיקה" : "מבזקים"),
        comment: item.link || "",
        date: dateTag(item.pubDate),
      });
      const durationSec = (await probeDuration(mp3)) || item.durationSec || null;
      const dest = `kikar-auto/${item.feed === "music" ? "music" : "vod"}/${id}.mp3`;
      log("upload", { id, dest, bytes: fs.statSync(mp3).size });
      const media = await uploadBase64(key, dest, mp3);
      const targetKey = playlistKeyForIntent(intent.playlistKey, durationSec || item?.durationSec);
      const plId = playlistIdFor(targetKey);
      await assignExact(key, media.id, [plId], managedIds);
      rec.state = "active";
      rec.azuraFileId = media.id;
      rec.azuraPath = media.path || dest;
      rec.playlistKey = targetKey;
      rec.playlistId = plId;
      rec.uploadedAt = new Date().toISOString();
      rec.durationSec = durationSec;
      rec.title = item.title;
      rec.seriesSlug = item.seriesSlug;
      rec.feed = item.feed;
      rec.windowEnd = intent.windowEnd;
      rec.errorCode = null;
      rec.errorMessage = null;
      rec.attempts = (rec.attempts || 0) + 1;
      rec.removedAt = null;
      summary.uploaded += 1;
      if (intent.replacePrevious) await replaceOlder(key, uploads, item, rec, managedIds, selections);
      fs.rmSync(work, { recursive: true, force: true });
    } catch (err) {
      const mapped = err instanceof PipelineError ? err : asPipeline(err);
      rec.state = "failed";
      rec.errorCode = mapped.code || "unknown";
      rec.errorMessage = String(mapped.message || "").slice(0, 300);
      rec.failedAt = new Date().toISOString();
      rec.attempts = (rec.attempts || 0) + 1;
      summary.failed += 1;
      log("item failed", { id, code: rec.errorCode, message: rec.errorMessage });
    }
  }

  await reconcileAds(key, ads, managedIds);
  const meta = runMeta();
  uploads.updatedAt = new Date().toISOString();
  uploads.lastRun = {
    startedAt: started.toISOString(),
    finishedAt: new Date().toISOString(),
    ok: summary.failed === 0,
    ...summary,
    itemId: onlyId || null,
    ...meta,
  };
  runsDoc.runs = [
    { kind: "upload", ...uploads.lastRun },
    ...(runsDoc.runs || []),
  ].slice(0, 40);
  writeJson(path.join(DATA, "system.json"), system);
  writeJson(path.join(DATA, "status/uploads.json"), uploads);
  writeJson(path.join(DATA, "status/runs.json"), runsDoc);
  log("upload done", summary);
  if (summary.failed > 0) process.exitCode = 1;
}

function rotationActiveCount(uploads) {
  let count = 0;
  for (const rec of Object.values(uploads.items || {})) {
    if (rec.state === "active" && rec.azuraFileId && ROTATION_PLAYLIST_KEYS.includes(rec.playlistKey)) count += 1;
  }
  return count;
}

async function replaceOlder(key, uploads, item, current, managedIds, selections) {
  const candidates = [];
  for (const [otherId, other] of Object.entries(uploads.items)) {
    if (otherId === item.id) continue;
    if (other.seriesSlug !== item.seriesSlug) continue;
    if (other.playlistId !== current.playlistId) continue;
    if (other.state !== "active" || !other.azuraFileId) continue;
    candidates.push([otherId, other]);
  }
  candidates.sort((a, b) => (Date.parse(b[1].uploadedAt || "") || 0) - (Date.parse(a[1].uploadedAt || "") || 0));
  for (const [otherId, other] of candidates) {
    if (keepDespiteReplace(selections?.items?.[otherId], new Date())) {
      log("kept approved episode; it was not marked replace-previous", { id: otherId });
      continue;
    }
    if (ROTATION_PLAYLIST_KEYS.includes(other.playlistKey) && rotationActiveCount(uploads) - 1 < ROTATION_MIN) {
      log("kept general-rotation item; replacement would drop below minimum", { id: otherId, floor: ROTATION_MIN });
      continue;
    }
    await assignExact(key, other.azuraFileId, [], managedIds);
    other.state = "replaced";
    other.removedAt = new Date().toISOString();
    log("replaced previous episode", { id: otherId });
  }
}

function campaignEnded(campaign, now) {
  if (!campaign?.endDate) return false;
  const end = endOfJerusalemDay(`${campaign.endDate}T12:00:00Z`);
  return now > end;
}

function playlistIdsForFile(ads, mediaId, now) {
  const ids = [];
  const same = (file) => Number(file.mediaId) === Number(mediaId);
  for (const campaign of ads.campaigns || []) {
    if (campaign.paused || campaignEnded(campaign, now)) continue;
    if (!(campaign.files || []).some(same)) continue;
    if (campaign.frequencyPlaylistId) ids.push(Number(campaign.frequencyPlaylistId));
    if (campaign.fixedPlaylistId) ids.push(Number(campaign.fixedPlaylistId));
  }
  for (const group of [ads.jingles, ads.sweepers]) {
    if (!group?.enabled || !group.playlistId) continue;
    if ((group.files || []).some((file) => same(file) && file.enabled !== false)) ids.push(Number(group.playlistId));
  }
  return ids;
}

async function reconcileAds(key, ads, managedIds) {
  const now = new Date();
  const live = await listPlaylists(key);
  const byId = new Map(live.map((pl) => [Number(pl.id), pl]));
  for (const campaign of ads.campaigns || []) {
    if (!campaignEnded(campaign, now)) continue;
    for (const pid of [campaign.frequencyPlaylistId, campaign.fixedPlaylistId]) {
      if (!pid) continue;
      const pl = byId.get(Number(pid));
      if (!pl || isProtectedName(pl.name) || !managedIds.has(Number(pl.id))) continue;
      if (pl.is_enabled) {
        await updatePlaylist(key, pl, { is_enabled: false }, managedIds);
        log("disabled ended campaign playlist", { id: pl.id, name: pl.name });
      }
    }
    for (const file of campaign.files || []) {
      if (!file.mediaId) continue;
      const keep = playlistIdsForFile(ads, file.mediaId, now).filter((id) => managedIds.has(id));
      try {
        await assignExact(key, file.mediaId, keep, managedIds);
      } catch (err) {
        log("campaign file detach failed", { mediaId: file.mediaId, message: String(err.message || err).slice(0, 160) });
      }
    }
  }
}

main().catch((err) => {
  const mapped = err instanceof PipelineError ? err : asPipeline(err);
  console.error(`${mapped.code}: ${String(mapped.message || "").slice(0, 300)}`);
  process.exit(1);
});
