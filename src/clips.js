// npm run clips -- <demo | video> [--gif] [--whole] [--crop x,y,w,h] [--speed part=1.5,...] [--parts a,b] [--width 960] [--out dir]
// Cuts a take into a clip per part, from <video>.steps.json: steps whose labels start with
// the same word before " · " ("add · name", "add · url") make one part, "add". A demo's name
// means its take. Writes clips/<video name>-<part>.mp4 beside the video, e.g.
// clips/camera-add.mp4 (H.264 level 4.2, plays on phones), or GIFs with --gif.
//   --crop   a region in CSS px (1600 × 900 unless the scenario sets a viewport), e.g. the plugin window
//   --speed  plays a part faster: map=1.5
//   --parts  only these parts, e.g. to crop some and not others
//   --whole  the whole take as one clip, clips/<video name>.mp4/.gif, when it is one guide section
//   --width  width in px (default 960 for GIFs, 1600 for MP4s)
//   --out    folder for the clips (default: clips/ beside the video)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { videoArg, viewportOf } from "./config.js";
import { FFMPEG, FFPROBE } from "./ffmpeg.js";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const valued = ["--crop", "--speed", "--parts", "--width", "--out"];
const video = videoArg(args.find((a, i) => !a.startsWith("--") && !valued.includes(args[i - 1])));
if (!video || !fs.existsSync(video)) {
  console.error("Usage: recital clips <demo | video> [--gif] [--whole] [--crop x,y,w,h] [--speed part=1.5] [--parts a,b] [--width 960] [--out dir]");
  process.exit(1);
}

const gif = args.includes("--gif");
const width = Number(option("width") ?? (gif ? 960 : 1600));
const speeds = Object.fromEntries((option("speed") ?? "").split(",").filter(Boolean).map((s) => s.split("=")).map(([p, v]) => [p, Number(v)]));
const outDir = option("out") ?? path.join(path.dirname(video), "clips");
const name = path.basename(video, ".mp4");
const duration = Number(
  execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).toString(),
);
// Recorded pixels per CSS px
const videoWidth = Number(
  execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", video]).toString(),
);
const scale = videoWidth / (await viewportOf(video)).width;

// Consecutive steps with the same label prefix; a part runs until the next one starts
const log = JSON.parse(fs.readFileSync(video.replace(/\.mp4$/, ".steps.json"), "utf8"));
const parts = [];
for (const step of args.includes("--whole") ? [] : log) {
  const part = step.label.split(" · ")[0];
  if (parts.at(-1)?.part === part) continue;
  parts.at(-1) && (parts.at(-1).end = step.start);
  parts.push({ part, start: parts.length ? step.start : 0 });
}
if (!parts.length) parts.push({ part: "", start: 0 });
parts.at(-1).end = duration;

const filters = [];
if (option("crop")) {
  const [x, y, w, h] = option("crop").split(",").map((n) => Math.round(Number(n) * scale));
  filters.push(`crop=${w}:${h}:${x}:${y}`);
}

const only = option("parts")?.split(",");
fs.mkdirSync(outDir, { recursive: true });
for (const { part, start, end } of parts.filter((p) => !only || only.includes(p.part))) {
  const speed = speeds[part] ?? 1;
  const vf = [...filters, ...(speed !== 1 ? [`setpts=PTS/${speed}`] : [])];
  const out = path.join(outDir, `${name}${part ? `-${part}` : ""}.${gif ? "gif" : "mp4"}`);
  const input = ["-v", "error", "-y", "-ss", start.toFixed(2), "-t", (end - start).toFixed(2), "-i", video];
  if (gif) {
    // A palette per clip, dithered lightly; only the changed area of each frame is stored
    vf.push(`fps=15,scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`);
    execFileSync(FFMPEG, [...input, "-vf", vf.join(","), "-loop", "0", out]);
  } else {
    vf.push(`scale=${width}:-2:flags=lanczos`);
    execFileSync(FFMPEG, [
      ...input, "-vf", vf.join(","),
      "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-tune", "animation",
      "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
    ]);
  }
  const size = (fs.statSync(out).size / 1e6).toFixed(1);
  console.log(`${path.relative(process.cwd(), out)}: ${((end - start) / speed).toFixed(1)}s, ${size} MB`);
}
