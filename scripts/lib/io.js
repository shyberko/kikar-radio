import fs from "node:fs";
import path from "node:path";

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = `${JSON.stringify(data, null, 2)}\n`;
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (prev === next) return false;
  fs.writeFileSync(file, next);
  return true;
}

export function log(message, extra) {
  const line = extra === undefined ? message : `${message} ${safe(extra)}`;
  if (/bearer|api[_-]?key|ghp_|github_pat_|token/i.test(line)) {
    console.log(`${message} [redacted]`);
    return;
  }
  console.log(line);
}

function safe(value) {
  try {
    return JSON.stringify(value, (k, v) => {
      if (/key|token|authorization|secret/i.test(k)) return "[redacted]";
      return v;
    });
  } catch {
    return "";
  }
}
