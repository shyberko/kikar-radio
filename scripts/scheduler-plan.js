/** Clock decisions for the in-repo scheduler. No network. */

import { jerusalemParts, jerusalemToUtc } from "../site/js/pure.js";

export const SCHEDULER_RUN_MINUTES = 345;
export const UPLOAD_MINUTE = 5;
export const SCAN_EVERY_MINUTES = 15;
export const BULLETIN_POLL_UNTIL = 20;
export const BULLETIN_ARM_MINUTE = 50;

export function hourKey(parts) {
  const p = (n) => String(n).padStart(2, "0");
  return `${parts.year}-${p(parts.month)}-${p(parts.day)}-${p(parts.hour)}`;
}

export function nextHourKey(parts) {
  const utc = jerusalemToUtc(parts.year, parts.month, parts.day, parts.hour, 0, 0);
  return hourKey(jerusalemParts(new Date(utc.getTime() + 60 * 60 * 1000)));
}

/**
 * What to start at this Israel clock tick.
 * Bulletin: once for the coming hour at :50, or once during :00–:20 if that was missed.
 * Upload: once an hour from minute 5.
 * Scan: once per 15-minute slot, caught up to 5 minutes late.
 */
export function schedulerTick(parts, state = {}) {
  const current = hourKey(parts);
  const minute = Number(parts.minute) || 0;
  const actions = [];
  const inBulletinWindow = minute >= BULLETIN_ARM_MINUTE || minute <= BULLETIN_POLL_UNTIL;
  if (inBulletinWindow) {
    const key = minute >= BULLETIN_ARM_MINUTE ? nextHourKey(parts) : current;
    if (state.bulletinKey !== key) actions.push({ kind: "bulletin", key });
  }
  if (minute >= UPLOAD_MINUTE && state.uploadKey !== current) {
    actions.push({ kind: "upload", key: current });
  }
  const slot = Math.floor(minute / SCAN_EVERY_MINUTES) * SCAN_EVERY_MINUTES;
  const scanKey = `${current}-${String(slot).padStart(2, "0")}`;
  if (minute - slot < 5 && state.scanKey !== scanKey) {
    actions.push({ kind: "scan", key: scanKey });
  }
  return { actions };
}

export function applySchedulerAction(state, action) {
  const next = { ...state };
  if (action.kind === "bulletin") next.bulletinKey = action.key;
  if (action.kind === "upload") next.uploadKey = action.key;
  if (action.kind === "scan") next.scanKey = action.key;
  return next;
}

export function cronFieldOk(field, min, max) {
  return String(field).split(",").every((part) => {
    const match = part.match(/^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
    if (!match) return false;
    const step = match[4] ? Number(match[4]) : null;
    if (step !== null && (step < 1 || step > max)) return false;
    if (match[1] === "*") return true;
    const start = Number(match[2]);
    const end = match[3] ? Number(match[3]) : start;
    return start >= min && end <= max && start <= end;
  });
}

/** GitHub cron is five UTC fields. Day-of-week may be 0–7. */
export function cronOk(expr) {
  const fields = String(expr).trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const limits = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  return fields.every((field, i) => cronFieldOk(field, limits[i][0], limits[i][1]));
}
