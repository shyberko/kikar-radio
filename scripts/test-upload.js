import fs from "node:fs";
import path from "node:path";
import { TMP } from "./lib/paths.js";
import { log } from "./lib/io.js";
import { requireKey, uploadBase64, deleteFile, listDir } from "./lib/azura.js";
import { synthTestMp3 } from "./lib/ffmpeg.js";
import { PipelineError } from "./lib/errors.js";

async function main() {
  const key = requireKey();
  fs.mkdirSync(TMP, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `kikar-connect-${stamp}.mp3`;
  const local = path.join(TMP, name);
  await synthTestMp3(local);
  const dest = `_test/${name}`;
  log("uploading test file", { dest, bytes: fs.statSync(local).size });
  const media = await uploadBase64(key, dest, local);
  if (!media?.id) throw new PipelineError("unknown", "העלאת הבדיקה לא החזירה מזהה");
  log("uploaded", { id: media.id, path: media.path || dest });
  const listed = await listDir(key, "_test");
  const found = listed.some((row) => String(row.path || row.text || "").includes(name) || row.media?.id === media.id);
  if (!found) log("list did not show the file yet; delete will still use the returned id");
  await deleteFile(key, media.id);
  log("deleted test file", { id: media.id });
  const after = await listDir(key, "_test");
  const still = after.some((row) => row.media?.id === media.id);
  if (still) throw new PipelineError("unknown", "קובץ הבדיקה עדיין קיים אחרי המחיקה");
  log("test upload verified and removed");
  fs.rmSync(local, { force: true });
}

main().catch((err) => {
  console.error(String(err?.code || "error") + ": " + String(err?.message || err).slice(0, 300));
  process.exit(1);
});
