import fs from "node:fs";
import path from "node:path";
import { PipelineError, asPipeline } from "./errors.js";

export async function downloadTo(url, dest) {
  let res;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "kikar-radio/1.0" },
      signal: AbortSignal.timeout(180000),
    });
  } catch (err) {
    const mapped = asPipeline(err);
    if (mapped.code === "timeout") throw new PipelineError("download", "timeout");
    throw new PipelineError("download", mapped.message);
  }
  if (!res.ok) throw new PipelineError("download", `HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new PipelineError("download", "הקובץ שהתקבל קטן מדי");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}
