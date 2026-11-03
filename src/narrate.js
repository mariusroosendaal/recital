// npm run narrate -- <demo | video> [--voice Lily,Daniel] [--provider elevenlabs] [--variant steady,v3]
//                              [--burn] [--out file]
// npm run narrate -- --voices        the voices in the ElevenLabs account
// Mixes the scenario's narration into a take or its camera version (a demo's name means its
// camera version, or its take if it has none), each line from the start of its step (from
// <video>.steps.json). Writes output/<demo>/narration/<voice>.mp4,
// or with --variant one <voice>-<variant>.mp4 per variant (VARIANTS below), to compare them.
// The lines are a subtitle track, and an .srt and a placed .vtt beside it; --burn also draws
// them on the video as captions. See narration.js for the scenario's `narration`.
// The voice defaults to the scenario's `voice`, the voice of the video that's used, and that
// voice (with no --variant, --out or --burn) also makes the demo's final video:
// output/final/<final>.mp4 with its captions burned in and no subtitle track (`final` in the
// scenario, or the demo's name), <final>-plain.mp4 without the captions, and their .vtt and
// .srt; narration/<voice>-burned.mp4 is the one Community clips are cut from. --no-final
// leaves output/final/ as it is.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { OUTPUT_DIR, SCENARIO_DIR, demoOf, loadEnv, videoArg } from "./config.js";
import { FFMPEG } from "./ffmpeg.js";
import { elevenLabsVoices, mix, narratedWidth, renderCaptions, voiceLines } from "./narration.js";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
loadEnv();
if (args.includes("--voices")) {
  for (const v of elevenLabsVoices()) console.log(`${v.name.padEnd(28)} ${[v.accent, v.gender, v.age, v.description ?? v.descriptive].filter(Boolean).join(", ")}`);
  process.exit(0);
}
const video = videoArg(
  args.find((a, i) => !a.startsWith("--") && !["--out", "--voice", "--provider", "--variant"].includes(args[i - 1])),
  ["camera.mp4", "take.mp4"],
);
if (!video || !fs.existsSync(video)) {
  console.error("Usage: recital narrate <demo | video> [--voice am_michael,bf_emma] [--provider elevenlabs] [--burn] [--out file]");
  process.exit(1);
}

// output/resize-to-ratio/camera.mp4 is a take of scenarios/resize-to-ratio.js
const name = demoOf(video);
const scenario = (await import(pathToFileURL(path.join(SCENARIO_DIR, `${name}.js`)))).default;
if (!scenario.narration?.length) {
  console.error(`scenarios/${name}.js has no narration`);
  process.exit(1);
}
const log = JSON.parse(fs.readFileSync(video.replace(/\.mp4$/, ".steps.json"), "utf8"));
// Ways to read the same lines, for ElevenLabs
const VARIANTS = {
  base: {},
  steady: { stability: 0.7 },
  warm: { stability: 0.4, style: 0.25 },
  final: { last: { speed: 0.92, stability: 0.7 } },
  fast: { speed: 1.1 },
  "steady-fast": { stability: 0.7, speed: 1.1 },
  "warm-fast": { stability: 0.4, style: 0.25, speed: 1.1 },
  // ElevenLabs' fastest
  "steady-faster": { stability: 0.7, speed: 1.2 },
  "warm-faster": { stability: 0.4, style: 0.25, speed: 1.2 },
  alt: { seed: 2 },
  alt2: { seed: 3 },
  alt3: { seed: 4 },
  v3: { model: "eleven_v3" },
  "v3-calm": { model: "eleven_v3", tag: "[calm]" },
};
const used = scenario.voice ?? scenario.narrator?.voice;
const voices = option("voice")?.split(",") ?? [scenario.voice ?? null];
const burn = args.includes("--burn");
const variants = option("variant")?.split(",") ?? [null];
for (const variant of variants) if (variant && !VARIANTS[variant]) throw new Error(`No variant "${variant}"; there are ${Object.keys(VARIANTS).join(", ")}`);
for (const voice of voices) {
  for (const variant of variants) {
    const provider = option("provider");
    const narrator = { ...scenario.narrator, ...(provider && { provider }), ...(voice && { voice }), ...VARIANTS[variant] };
    const tag = [narrator.voice ?? narrator.provider ?? "narrated", variant].filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    const out = option("out") ?? path.join(OUTPUT_DIR, name, "narration", `${tag}.mp4`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    console.log(tag);
    const voiced = await voiceLines(scenario, narrator);
    if (!(await renderCaptions(voiced.map((l) => l.text), narratedWidth(video))) && burn) console.log("  (Chromium can't start here: captions not rendered by a take come from pango)");
    const { duration, lines } = mix(video, voiced, log, out, { burn });
    for (const l of lines) console.log(`  ${l.start.toFixed(1)}s  ${l.duration.toFixed(1)}s  ${l.text}`);
    console.log(`${path.relative(process.cwd(), out)}: ${duration.toFixed(1)}s`);
    if (variant || burn || option("out") || args.includes("--no-final")) continue;
    if (narrator.voice?.toLowerCase() !== used?.toLowerCase()) continue;
    // The final video has its captions burned in: none of the places it goes (Notion, the
    // Community page, a playground) lets the viewer turn subtitles on. The plain one beside it
    // is for a player that does, with the .vtt
    const burned = out.replace(/\.mp4$/, "-burned.mp4");
    mix(video, voiced, log, burned, { burn: true });
    for (const ext of [".vtt", ".srt"]) fs.rmSync(burned.replace(/\.mp4$/, ext));
    const final = path.join(OUTPUT_DIR, "final", `${scenario.final ?? name}.mp4`);
    fs.mkdirSync(path.dirname(final), { recursive: true });
    const strip = (from, to) => execFileSync(FFMPEG, ["-v", "error", "-y", "-i", from, "-sn", "-c", "copy", "-movflags", "+faststart", to]);
    strip(burned, final);
    strip(out, final.replace(/\.mp4$/, "-plain.mp4"));
    for (const ext of [".vtt", ".srt"]) fs.copyFileSync(out.replace(/\.mp4$/, ext), final.replace(/\.mp4$/, ext));
    console.log(`${path.relative(process.cwd(), final)}: the final video, captions burned in; -plain.mp4 beside it, with the .vtt and .srt`);
  }
}
