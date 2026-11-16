import { spawn } from "node:child_process";
import fs from "node:fs";
import { PipelineError } from "./errors.js";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    let out = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
      if (err.length > 12000) err = err.slice(-12000);
    });
    child.stdout.on("data", (d) => {
      out += d.toString();
    });
    child.on("error", (e) => reject(new PipelineError("conversion", e.message)));
    child.on("close", (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new PipelineError("conversion", `${cmd} יצא עם קוד ${code}: ${err.slice(-400)}`));
    });
  });
}

export async function transcodeToMp3(input, output, tags) {
  const args = [
    "-y",
    "-i",
    input,
    "-vn",
    "-af",
    "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    "-id3v2_version",
    "3",
    "-metadata",
    `title=${tags.title || ""}`,
    "-metadata",
    `artist=${tags.artist || "כיכר השבת"}`,
    "-metadata",
    `album=${tags.album || "רדיו כיכר"}`,
    "-metadata",
    `comment=${tags.comment || ""}`,
    "-metadata",
    `date=${tags.date || ""}`,
    output,
  ];
  await run("ffmpeg", args);
  if (!fs.existsSync(output) || fs.statSync(output).size < 1000) {
    throw new PipelineError("conversion", "קובץ ה־MP3 לא נוצר");
  }
}

export async function probeDuration(file) {
  try {
    const { out } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      file,
    ]);
    const n = Number(String(out).trim());
    return Number.isFinite(n) ? Math.round(n) : null;
  } catch {
    return null;
  }
}

export async function synthTestMp3(output) {
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "64k",
    output,
  ]);
}
