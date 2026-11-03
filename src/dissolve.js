// Dissolves at a take's cuts: a step with `dissolve: ms` (a tab switch) fades from the last
// frame before it into the new tab over that long, on the same timeline; with `through:
// "white"` (or "black") it dips through that colour instead, for a break between sections.
// Done after the take and after the camera, each on its own frames, so a dissolve never
// crosses a change of framing. The take without dissolves is kept for npm run camera (undissolved()).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FFMPEG } from "./ffmpeg.js";

/** The cuts a step log asks to dissolve: [{ at: seconds, duration: seconds, through? }] */
export function dissolves(log) {
  return log.filter((s) => s.dissolve && !s.skipped).map((s) => ({ at: s.start, duration: s.dissolve / 1000, through: s.through }));
}

/** Where the take without dissolves is kept, beside its frames */
export function undissolved(video) {
  return path.join(path.dirname(video), ".frames", path.basename(video, ".mp4"), "take.mp4");
}

/**
 * The filter graph from `[0:v]`, after `before` (e.g. the camera's crop), with each cut
 * dissolved: the part before a cut holds its last frame for the dissolve, and the next part
 * fades in over it from the cut on, so the length stays the same.
 */
export function dissolveGraph(cuts, before = "null") {
  if (!cuts.length) return `[0:v]${before}[v]`;
  const times = [0, ...cuts.map((c) => c.at)];
  const parts = times.map((from, i) => {
    const to = times[i + 1];
    const trim = to === undefined ? `trim=start=${from}` : `trim=start=${from}:end=${to}`;
    const hold = to === undefined ? "" : `,tpad=stop_mode=clone:stop_duration=${cuts[i].duration}`;
    return `[s${i}]${trim},setpts=PTS-STARTPTS${hold}[p${i}]`;
  });
  const fades = cuts.map(({ at, duration, through }, i) =>
    `[${i ? `x${i}` : "p0"}][p${i + 1}]xfade=transition=${through ? `fade${through}` : "fade"}:duration=${duration}:offset=${at}[${i === cuts.length - 1 ? "v" : `x${i + 1}`}]`,
  );
  return [`[0:v]${before},split=${times.length}${times.map((_, i) => `[s${i}]`).join("")}`, ...parts, ...fades].join(";");
}

/** Re-encodes a take with its dissolves, keeping the take without them for the camera */
export function dissolveTake(video, cuts) {
  if (!cuts.length) return;
  const kept = undissolved(video);
  fs.mkdirSync(path.dirname(kept), { recursive: true });
  fs.renameSync(video, kept);
  execFileSync(FFMPEG, [
    "-v", "error", "-y", "-i", kept, "-filter_complex", dissolveGraph(cuts), "-map", "[v]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "animation", "-pix_fmt", "yuv420p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart", video,
  ], { stdio: "inherit" });
}
