// npm run frames -- <demo | video> [--every 1] [--at 1.5,3.2] [--steps] [--width 1600]
// Extracts PNG frames into frames/<video name>/ beside the video (output/frames/ for a video
// outside output/) plus a contact sheet (sheet.png). A demo's name means its take.
//   --every  seconds between frames (default 1)
//   --at     specific times in seconds
//   --steps  one frame at the end of each step, from <video>.steps.json
//   --width  frame width in px (default 1600, half the recorded size, or the video's own if narrower)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { OUTPUT_DIR, videoArg } from "./config.js";
import { FFMPEG, FFPROBE } from "./ffmpeg.js";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const valued = ["--every", "--at", "--width"];
const video = videoArg(args.find((a, i) => !a.startsWith("--") && !valued.includes(args[i - 1])));
if (!video || !fs.existsSync(video)) {
  console.error("Usage: recital frames <demo | video> [--every 1] [--at 1.5,3.2] [--steps] [--width 1600]");
  process.exit(1);
}

const width = option("width") ? Number(option("width")) : "min(1600,iw)";
const duration = Number(
  execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).toString(),
);

let times;
let labels = [];
if (args.includes("--steps")) {
  const log = JSON.parse(fs.readFileSync(video.replace(/\.mp4$/, ".steps.json"), "utf8"));
  const visible = log.filter((s) => !s.skipped);
  times = visible.map((s) => Math.min(duration - 0.05, s.end - 0.05));
  labels = visible.map((s) => `${s.step}. ${s.label}`);
} else if (option("at")) {
  times = option("at").split(",").map(Number);
} else {
  const every = Number(option("every") ?? 1);
  times = [];
  for (let t = 0; t < duration; t += every) times.push(Number(t.toFixed(3)));
}

const inOutput = path.resolve(video).startsWith(OUTPUT_DIR + path.sep);
const dir = path.join(inOutput ? path.dirname(path.resolve(video)) : OUTPUT_DIR, "frames", path.basename(video, path.extname(video)));
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const files = times.map((t, i) => {
  const file = path.join(dir, `${String(i + 1).padStart(3, "0")}-${t.toFixed(2)}s.png`);
  execFileSync(FFMPEG, ["-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf", `scale='${width}':-1`, file]);
  return file;
});

// Contact sheet, 4 across at 480px
const columns = Math.min(4, files.length);
const rows = Math.ceil(files.length / columns);
execFileSync(FFMPEG, [
  "-v", "error", "-y", "-pattern_type", "glob", "-i", path.join(dir, "*.png"),
  "-vf", `scale=480:-1,tile=${columns}x${rows}:padding=4:color=white`,
  "-frames:v", "1", path.join(dir, "sheet.png"),
]);

files.forEach((file, i) => console.log(`${path.relative(process.cwd(), file)}${labels[i] ? `  ${labels[i]}` : ""}`));
console.log(path.relative(process.cwd(), path.join(dir, "sheet.png")));
