/** Pure decisions for GitHub and AzuraCast errors. No network, no secrets. */

export const GITHUB_MAX_ATTEMPTS = 6;

function writeBackoffMs(attempt) {
  return Math.min(8000, 400 * 2 ** attempt);
}

export function retryAfterMs(retryAfter, attempt = 0) {
  const raw = String(retryAfter || "").trim();
  if (/^\d+$/.test(raw)) return Math.min(60000, Number(raw) * 1000);
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.min(60000, Math.max(0, when - Date.now()));
  return writeBackoffMs(attempt);
}

export function planGithubResponse(status, attempt = 0, maxAttempts = GITHUB_MAX_ATTEMPTS, body = "", retryAfter = "") {
  const n = Number(status);
  const text = typeof body === "string" ? body : JSON.stringify(body || {});
  const rateLimited = n === 429 || (n === 403 && /secondary rate|rate limit|abuse detection/i.test(text));
  if ((n === 409 || n === 422 || rateLimited) && attempt < maxAttempts - 1) {
    return {
      action: "retry",
      code: rateLimited ? "rate" : "conflict",
      waitMs: rateLimited ? retryAfterMs(retryAfter, attempt) : writeBackoffMs(attempt),
      message: rateLimited
        ? "GitHub הגביל לרגע את קצב השמירה. ננסה שוב בשקט."
        : "GitHub עדכן את הקובץ בינתיים. קוראים את הגרסה החדשה וממזגים.",
    };
  }
  if (n === 409 || n === 422) {
    return {
      action: "fail",
      code: "conflict",
      message: "לא הצלחנו לשמור אחרי כמה ניסיונות. נסה שוב בעוד רגע.",
      recovery: "retry",
    };
  }
  if (rateLimited) {
    return {
      action: "fail",
      code: "rate",
      message: "GitHub הגביל את קצב השמירה. ננסה שוב בעוד רגע.",
      recovery: "later",
    };
  }
  if (n === 401) {
    return {
      action: "fail",
      code: "token",
      message: "הטוקן של GitHub לא תקף או שפג תוקפו. עדכן אותו בהגדרות.",
      recovery: "settings",
    };
  }
  if (n === 403) {
    return {
      action: "fail",
      code: "scope",
      message: "לטוקן אין הרשאה למאגר הזה. צריך Fine-grained token רק ל־kikar-radio, עם Contents ו־Actions לכתיבה.",
      recovery: "settings",
    };
  }
  if (n >= 200 && n < 300) return { action: "ok", code: "ok", message: "" };
  return {
    action: "fail",
    code: "unknown",
    message: "השמירה ל־GitHub נכשלה.",
    recovery: "retry",
  };
}

/**
 * Fine-grained tokens report repo access as {admin, maintain, push, triage, pull}.
 * Contents write is `push: true`. Actions access is a successful GET /actions/workflows.
 * Classic PATs that still send `contents: "write"` are accepted too.
 */
export function planGithubPermissions({ permissions, workflowsOk, contents, actions } = {}) {
  const perms = permissions || {};
  const canWrite = perms.push === true || contents === "write" || perms.contents === "write";
  if (!canWrite) {
    return {
      ok: false,
      code: "contents",
      message: "לטוקן אין הרשאת כתיבה לתוכן. צריך Contents: Read and write.",
    };
  }
  const actionsBlocked = workflowsOk === false || actions === "read";
  if (actionsBlocked) {
    return {
      ok: false,
      code: "actions",
      message: "לטוקן אין הרשאה להפעיל העלאות. צריך Actions: Read and write.",
    };
  }
  return { ok: true, code: "ok", message: "מחובר למאגר ✓" };
}

export function githubSetupMessage(err) {
  const status = Number(err?.status);
  if (err?.code === "network" || err?.name === "TypeError") return "אין חיבור ל־GitHub. נסה שוב.";
  if (status === 401 || err?.code === "token") return "הטוקן לא תקף";
  if (status === 404 || err?.code === "repo") return "הטוקן לא מכסה את המאגר kikar-radio";
  if (err?.code === "contents") return "לטוקן אין הרשאת כתיבה לתוכן. צריך Contents: Read and write.";
  if (err?.code === "actions") return "לטוקן אין הרשאה להפעיל העלאות. צריך Actions: Read and write.";
  return err?.message || "לא הצלחנו לבדוק את הטוקן";
}

function recordTime(row) {
  const stamp = Date.parse(row?.updatedAt || row?.approvedAt || row?.createdAt || "") || 0;
  return stamp;
}

function preferNewer(remoteRow, localRow) {
  if (!remoteRow) return localRow;
  if (!localRow) return remoteRow;
  if (typeof remoteRow !== "object" || typeof localRow !== "object") {
    return recordTime(localRow) >= recordTime(remoteRow) ? localRow : remoteRow;
  }
  const localWins = recordTime(localRow) >= recordTime(remoteRow);
  return localWins ? { ...remoteRow, ...localRow } : { ...localRow, ...remoteRow };
}

function mergeById(remoteRows, localRows) {
  const byId = new Map();
  for (const row of remoteRows || []) if (row?.id) byId.set(row.id, row);
  for (const row of localRows || []) {
    if (!row?.id) continue;
    byId.set(row.id, preferNewer(byId.get(row.id), row));
  }
  return [...byId.values()];
}

/** Rapid writes to the same file collapse to the latest body. Different files stay separate. */
export function coalesceWrites(writes) {
  const byPath = new Map();
  for (const write of writes || []) {
    if (!write?.path) continue;
    byPath.set(write.path, write);
  }
  return [...byPath.values()];
}

/** Keep every decision. A newer updatedAt wins per item; keys only on one side are kept. */
export function mergeJsonDocs(remote, local) {
  if (!remote || typeof remote !== "object") return local;
  if (!local || typeof local !== "object") return remote;
  const out = { ...remote, ...local };
  if (remote.items && local.items && !Array.isArray(remote.items) && !Array.isArray(local.items)) {
    const items = { ...remote.items };
    for (const [id, value] of Object.entries(local.items)) items[id] = preferNewer(items[id], value);
    out.items = items;
  }
  if (remote.seriesMap || local.seriesMap) out.seriesMap = { ...(remote.seriesMap || {}), ...(local.seriesMap || {}) };
  if (Array.isArray(remote.rules) || Array.isArray(local.rules)) out.rules = mergeById(remote.rules, local.rules);
  if (Array.isArray(remote.campaigns) || Array.isArray(local.campaigns)) out.campaigns = mergeById(remote.campaigns, local.campaigns);
  return out;
}

export function planAzuraError(status, body) {
  const n = Number(status);
  const text = typeof body === "string" ? body : JSON.stringify(body || {});
  if (n === 401 || n === 403) {
    return {
      code: "auth",
      message: "מפתח ה־API של הרדיו לא תקף או שפג תוקפו.",
      recovery: "settings",
    };
  }
  if (/storage|quota|disk|out of available space|full/i.test(text)) {
    return {
      code: "storage",
      message: "אין מספיק מקום בשרת הרדיו.",
      recovery: "expired",
    };
  }
  if (n === 404) {
    return {
      code: "playlist",
      message: "הפלייליסט לא נמצא. אולי נמחק או ששמו שונה.",
      recovery: "pick-playlist",
    };
  }
  if (n === 408 || n === 504) {
    return { code: "timeout", message: "ההעלאה לקחה יותר מדי זמן ונעצרה.", recovery: "retry" };
  }
  return { code: "unknown", message: "משהו השתבש מול הרדיו.", recovery: "retry" };
}

/** Bulletin leaves the playlist at edition HH:00 + 60 minutes, not upload time + 60. */
export function bulletinOffAirAt(editionStartMs, replacedAtMs = null) {
  const hard = Number(editionStartMs) + 60 * 60 * 1000;
  if (replacedAtMs == null || Number.isNaN(Number(replacedAtMs))) return hard;
  return Math.min(hard, Number(replacedAtMs));
}
