// npm run camera -- <demo | video> [--width 1920] [--out file]   (width: 1.2× the viewport's)
// A version of a take with a camera that zooms in on the action: the scenario's `camera`
// lists framings, each from the start of a step on, and the camera eases between them.
// The take is twice the output's CSS size, so zooming in up to 1.67× still downscales.
//
//   camera: [
//     { at: "add · open the form", center: [1400, 470], zoom: 1.5 },  // CSS px of the viewport
//     { at: "apply · create copies", zoom: 1, ms: 1200 },             // the whole frame
//   ]
//
// `at` is a step's label; `ms` the move's length (default 900). A framing at the edge is
// pushed in, so it never shows past the take. A demo's name means its take; writes camera.mp4
// beside the take, with a copy of the steps file for npm run clips.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SCENARIO_DIR, VIEWPORT, demoOf, videoArg } from "./config.js";
import { FFMPEG, FFPROBE } from "./ffmpeg.js";
import { dissolveGraph, dissolves, undissolved } from "./dissolve.js";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const valued = ["--width", "--out"];
const video = videoArg(args.find((a, i) => !a.startsWith("--") && !valued.includes(args[i - 1])));
if (!video || !fs.existsSync(video)) {
  console.error("Usage: recital camera <demo | video> [--width 1920] [--out file]");
  process.exit(1);
}

const name = demoOf(video);
const scenario = (await import(pathToFileURL(path.join(SCENARIO_DIR, `${name}.js`)))).default;
if (!scenario.camera?.length) {
  console.error(`scenarios/${name}.js has no camera`);
  process.exit(1);
}
const log = JSON.parse(fs.readFileSync(video.replace(/\.mp4$/, ".steps.json"), "utf8"));
const viewport = scenario.viewport ?? VIEWPORT;
const width = Number(option("width") ?? Math.round((viewport.width * 1.2) / 2) * 2);
const height = Math.round((width * viewport.height) / viewport.width / 2) * 2;
const out = option("out") ?? path.join(path.dirname(video), "camera.mp4");

// The whole frame first, then each framing from its step's start
const whole = { center: [viewport.width / 2, viewport.height / 2], zoom: 1 };
const moves = scenario.camera.map((shot) => {
  const step = log.find((s) => s.label === shot.at);
  if (!step) throw new Error(`No step labelled "${shot.at}" in ${path.relative(process.cwd(), video.replace(/\.mp4$/, ".steps.json"))}`);
  const zoom = shot.zoom ?? 1;
  // Pushed in before easing: clipped per frame instead, a move from or to past the edge sits
  // still at the edge and crosses in a jump in the middle of the ease
  const inside = (c, size) => Math.min(Math.max(c, size / zoom / 2), size - size / zoom / 2);
  const [x, y] = shot.center ?? whole.center;
  return { start: step.start, ms: shot.ms ?? 900, center: [inside(x, viewport.width), inside(y, viewport.height)], zoom };
});

/** ffmpeg expression for a value over time `t`: held, then eased to each move's value */
function track(pick, t = "t") {
  const values = [pick(whole), ...moves.map(pick)];
  let expr = `${values.at(-1)}`;
  for (let i = moves.length - 1; i >= 0; i--) {
    const { start, ms } = moves[i];
    const end = start + ms / 1000;
    const [from, to] = [values[i], values[i + 1]];
    const p = `((${t}-${start.toFixed(3)})/${(ms / 1000).toFixed(3)})`;
    const eased = `if(lt(${p},0.5),4*pow(${p},3),1-pow(2-2*${p},3)/2)`;
    expr = `if(lt(${t},${start.toFixed(3)}),${from},if(lt(${t},${end.toFixed(3)}),${from}+(${to - from})*${eased},${expr}))`;
  }
  return expr;
}

const fps = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", video]).toString().trim();
// crop takes its input's size once, at the first frame, so it works the scaled size out
// from the zoom too, with the time from the frame number
const time = `(n/(${fps}))`;
const scaledWidth = `(2*trunc(${width}*(${track((s) => s.zoom, time)})/2))`;
const scaledHeight = `(2*trunc(${height}*(${track((s) => s.zoom, time)})/2))`;
const cx = track((s) => s.center[0], time);
const cy = track((s) => s.center[1], time);
// Each frame scaled to the zoom, then a fixed window cut around the centre, kept inside
const filter = [
  `scale=w='2*trunc(${width}*(${track((s) => s.zoom)})/2)':h='2*trunc(${height}*(${track((s) => s.zoom)})/2)':eval=frame:flags=lanczos`,
  `crop=${width}:${height}:x='clip((${cx})*${scaledWidth}/${viewport.width}-${width / 2},0,${scaledWidth}-${width})':y='clip((${cy})*${scaledHeight}/${viewport.height}-${height / 2},0,${scaledHeight}-${height})'`,
].join(",");

// Cut from the take without dissolves, then dissolved here, so a dissolve never shows the
// framing change at its cut
const cuts = dissolves(log);
const source = cuts.length && fs.existsSync(undissolved(video)) ? undissolved(video) : video;
execFileSync(FFMPEG, [
  "-v", "error", "-y", "-i", source, "-filter_complex", dissolveGraph(cuts, filter), "-map", "[v]",
  "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-tune", "animation",
  "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
], { stdio: "inherit" });
// Same timing as the take, so npm run clips can cut this version too
fs.copyFileSync(video.replace(/\.mp4$/, ".steps.json"), out.replace(/\.mp4$/, ".steps.json"));
console.log(`${path.relative(process.cwd(), out)}: ${width} × ${height}`);
