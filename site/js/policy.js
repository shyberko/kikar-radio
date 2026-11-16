/** Pure decisions for GitHub and AzuraCast errors. No network, no secrets. */

export const GITHUB_MAX_ATTEMPTS = 4;

export function planGithubResponse(status, attempt = 0, maxAttempts = GITHUB_MAX_ATTEMPTS) {
  const n = Number(status);
  if (n === 409 && attempt < maxAttempts - 1) {
    return {
      action: "retry",
      code: "conflict",
      message: "GitHub עדכן את הקובץ בינתיים. קוראים את הגרסה החדשה ומנסים שוב.",
    };
  }
  if (n === 409) {
    return {
      action: "fail",
      code: "conflict",
      message: "לא הצלחנו לשמור אחרי כמה ניסיונות. נסה שוב בעוד רגע.",
      recovery: "retry",
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
  if (n === 429) {
    return {
      action: "fail",
      code: "github",
      message: "GitHub הגביל את הבקשות כרגע. ננסה שוב בהרצה הבאה.",
      recovery: "later",
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
