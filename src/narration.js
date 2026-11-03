// Narration with Kokoro (kokoro-js, run locally) or ElevenLabs. A scenario's `narration`
// lists lines, each spoken from the start of a step:
//
//   narrator: { voice: "af_heart", speed: 1 },   // optional; kokoro-js ships 54 voices
//   narrator: { provider: "elevenlabs", voice: "Lily" },    // a voice in your account, by
//                                                          // name; ELEVENLABS_API_KEY in .env
//   ElevenLabs also takes stability (0.5), style (0), seed, model ("eleven_multilingual_v2";
//   "eleven_v3" reads audio tags such as [calm] but no context), tag (put before each line,
//   e.g. "[calm]"), and last: settings for the last line alone, e.g. { speed: 0.92 }
//   narration: [
//     { at: "select a card", text: "Select the cards to fit to their images." },
//     { at: "copy", text: "Copy them from Huetone.", say: "Copy them from Hue-tone." },
//   ]                                       // `say`: what's spoken, where the subtitle's text
//                                           // would be mispronounced; `pause`: seconds more
//                                           // before the next line, when recording
//
// The lines are voiced before the take (cached in .narration/), so the take can wait for
// one line to finish before the step with the next starts. npm run narrate then mixes them
// into the take or its camera version at each step's start.

import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Worker, isMainThread, workerData } from "node:worker_threads";
import { CACHE_DIR, WORKSPACE } from "./config.js";
import { FFMPEG, FFPROBE } from "./ffmpeg.js";

const CACHE = path.join(WORKSPACE, ".narration");
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
// A local copy of the model, if there is one (see the README), else Hugging Face
const MODELS = path.join(CACHE_DIR, "models");

let tts = null;
async function kokoro() {
  if (tts) return tts;
  const [{ env }, { KokoroTTS }] = await Promise.all([import("@huggingface/transformers"), import("kokoro-js")]);
  if (fs.existsSync(path.join(MODELS, MODEL))) {
    env.localModelPath = MODELS + path.sep;
    env.allowRemoteModels = false;
  }
  tts = await KokoroTTS.from_pretrained(MODEL, { dtype: "q8", device: "cpu" });
  return tts;
}

const seconds = (file) =>
  Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

const ELEVENLABS = "https://api.elevenlabs.io/v1";

/** ElevenLabs over curl: it goes through the sandbox's proxy, where Node's fetch can't */
function elevenlabs(endpoint, { body, out } = {}) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ElevenLabs narration needs ELEVENLABS_API_KEY in .env");
  // The key goes in on stdin (-H @-), so it's in no command line or error message; --retry
  // waits out rate limits (429)
  const args = ["-sS", "--fail-with-body", "--retry", "5", "--retry-max-time", "120", "-H", "@-", `${ELEVENLABS}${endpoint}`];
  if (body) args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  if (out) args.push("-o", out);
  try {
    return execFileSync("curl", args, { input: `xi-api-key: ${key}\n`, maxBuffer: 64 * 1024 * 1024 }).toString();
  } catch (error) {
    if (out) fs.rmSync(out, { force: true });
    const said = `${error.stdout?.toString() ?? ""} ${error.stderr?.toString() ?? ""}`.trim();
    throw new Error(`ElevenLabs ${endpoint.split("?")[0]}: ${said || `curl exited ${error.status}`}`);
  }
}

let elevenVoices = null;
/** A voice's id from its name in the account (case-insensitive, first word enough), or an id */
function elevenVoice(name) {
  elevenVoices ??= JSON.parse(elevenlabs("/voices")).voices;
  const want = name.toLowerCase();
  const voice = elevenVoices.find((v) => v.voice_id === name || v.name.toLowerCase() === want)
    ?? elevenVoices.find((v) => v.name.toLowerCase().split(/\W/)[0] === want);
  if (!voice) throw new Error(`No ElevenLabs voice "${name}"; there are ${elevenVoices.map((v) => v.name).join(", ")}`);
  return voice.voice_id;
}

/**
 * The scenario's lines with their audio file and length in seconds, voicing the new ones;
 * `narrator` overrides the scenario's, e.g. to try another voice
 */
export async function voiceLines(scenario, narrator = scenario.narrator) {
  const { provider = "kokoro", voice = provider === "kokoro" ? "af_heart" : "Lily", speed = 1, model = "eleven_multilingual_v2", stability = 0.5, style = 0, seed, tag, last } = narrator ?? {};
  fs.mkdirSync(CACHE, { recursive: true });
  const ext = provider === "kokoro" ? "wav" : "mp3";
  const said = (scenario.narration ?? []).map(({ text, say = text }) => say);
  const count = scenario.narration?.length ?? 0;
  const lines = (scenario.narration ?? []).map(({ at, text, pause }, i) => {
    const say = tag ? `${tag} ${said[i]}` : said[i];
    // ElevenLabs hears the script up to each line and the line after, so a line sounds like
    // it goes on or, the last, like the script ends; v3 takes no context
    const context = provider === "kokoro" || model === "eleven_v3" ? {} : { previous: said.slice(0, i).join(" ") || undefined, next: said[i + 1] };
    const voicing = { speed, stability, style, ...(i === count - 1 && last) };
    // Only what differs from the defaults goes in the key, so earlier files still match
    const extra = voicing.stability !== 0.5 || voicing.style || seed !== undefined ? `|${JSON.stringify({ stability: voicing.stability, style: voicing.style, seed })}` : "";
    const settings = provider === "kokoro" ? `${voice}|${speed}` : `${provider}|${voice}|${model}|${voicing.speed}|${context.previous ?? ""}|${context.next ?? ""}${extra}`;
    const hash = crypto.createHash("sha1").update(`${settings}|${say}`).digest("hex").slice(0, 16);
    return { at, text, say, pause, context, voicing, file: path.join(CACHE, `${hash}.${ext}`) };
  });
  const missing = lines.filter((l) => !fs.existsSync(l.file));
  if (missing.length && provider === "elevenlabs") {
    const id = elevenVoice(voice);
    for (const { say, context, voicing, file } of missing) {
      elevenlabs(`/text-to-speech/${id}?output_format=mp3_44100_128`, {
        body: {
          text: say,
          model_id: model,
          voice_settings: { stability: voicing.stability, similarity_boost: 0.75, style: voicing.style, speed: voicing.speed },
          ...(seed !== undefined && { seed }),
          ...(context.previous && { previous_text: context.previous }),
          ...(context.next && { next_text: context.next }),
        },
        out: file,
      });
    }
  } else if (missing.length) {
    if (!/^[a-z]{2}_[a-z]+$/.test(voice)) {
      throw new Error(`"${voice}" isn't a Kokoro voice, such as af_heart or bf_emma; for an ElevenLabs voice, narrator: { provider: "elevenlabs", voice: "${voice}" }`);
    }
    // In a thread of its own: onnxruntime aborts the process it ran in when that exits
    // ("mutex lock failed"), which would fail the take. Not a process: Claude Desktop's
    // built-in Node can't start one (see mcp.js).
    const kokoroJobs = missing.map(({ say, file }) => ({ text: say, file, voice, speed }));
    const error = await new Promise((resolve) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { kokoroJobs } });
      worker.on("error", resolve);
      worker.on("exit", () => resolve(null));
    });
    const failed = missing.filter((l) => !fs.existsSync(l.file));
    if (failed.length) throw new Error(`Kokoro didn't voice ${failed.length} lines${error ? `: ${error.message}` : ""}`);
  }
  return lines.map((l) => {
    const file = provider === "kokoro" ? l.file : trimmed(l.file);
    return { ...l, file, duration: seconds(file) };
  });
}

/**
 * The line cut to its speech, beside the voiced file: given the lines around it, ElevenLabs
 * can start on the next one or end the one before, a short burst cut off from the rest by
 * silence, heard as a blip. Short fades keep the cuts from clicking.
 */
function trimmed(file) {
  const out = file.replace(/\.[a-z0-9]+$/, ".trimmed.wav");
  if (fs.existsSync(out)) return out;
  const log = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af", "silencedetect=noise=-40dB:d=0.1", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const length = seconds(file);
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  // Sound between the silences
  let sound = [];
  let from = 0;
  starts.forEach((start, i) => {
    if (start > from) sound.push([from, start]);
    from = ends[i] ?? length;
  });
  if (from < length) sound.push([from, length]);
  // A burst at either end under 0.2s, set apart by 0.2s of silence or more, isn't the line
  const burst = (a, b) => a[1] - a[0] < 0.2 && Math.abs(b[0] - a[1]) >= 0.2;
  const burstAfter = (a, b) => b[1] - b[0] < 0.2 && b[0] - a[1] >= 0.2;
  while (sound.length > 1 && burst(sound[0], sound[1])) sound.shift();
  while (sound.length > 1 && burstAfter(sound.at(-2), sound.at(-1))) sound.pop();
  const start = Math.max(0, (sound[0]?.[0] ?? 0) - 0.03);
  const end = Math.min(length, (sound.at(-1)?.[1] ?? length) + 0.12);
  execFileSync(FFMPEG, [
    "-v", "error", "-y", "-ss", start.toFixed(3), "-to", end.toFixed(3), "-i", file,
    "-af", `afade=t=in:d=0.01,afade=t=out:st=${(end - start - 0.04).toFixed(3)}:d=0.04`, out,
  ]);
  return out;
}

/** The voices in the ElevenLabs account: name, accent, gender, description */
export function elevenLabsVoices() {
  return JSON.parse(elevenlabs("/voices")).voices.map((v) => ({ name: v.name, id: v.voice_id, ...v.labels }));
}

// voiceLines' worker: voices the jobs it's given
if (!isMainThread && workerData?.kokoroJobs) {
  for (const { text, file, voice, speed } of workerData.kokoroJobs)
    await (await (await kokoro()).generate(text, { voice, speed })).save(file);
}

const timestamp = (t) => {
  const ms = Math.round(t * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

// Captions: white text on a translucent dark box with rounded corners, as macOS draws
// subtitles, sized for a video `width` wide. Rendered in Chromium, which has the system font
// everywhere; Chromium can't start in Claude Code's sandbox, so `npm run demo` renders the
// take's captions beforehand (at 1920, the width of a narrated video) and narrate reuses them.
// pango-view, if there is one, stands in for a caption that wasn't rendered.

const captionStyle = (width) => {
  const size = Math.round(width * 0.0172);
  // Drawn at twice the size and scaled down, for smoother edges; weight 450 with CoreText's
  // default smoothing comes closest to QuickTime's own subtitles
  return { size, padY: Math.round(size * 0.03), padX: Math.round(size * 0.3), radius: Math.round(size * 0.235), weight: 450, smoothing: "auto", supersample: 2 };
};

const captionFile = (text, width) => {
  const style = JSON.stringify({ renderer: "chromium", width, ...captionStyle(width), text });
  return path.join(CACHE, `caption-${crypto.createHash("sha1").update(style).digest("hex").slice(0, 16)}.png`);
};

/** The output width of a narrated `video`: its own, or 1920 for a bigger take */
export function narratedWidth(video) {
  const [source, sourceHeight] = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", video])
    .toString()
    .split(",")
    .map(Number);
  // A take at 3200 px (one with no camera version) is too big for iPhones to play
  return Math.min(source, 1920);
}

/**
 * Renders the captions for `texts` that aren't cached yet. False when Chromium can't start
 * (in the sandbox); caption() then falls back to pango.
 */
export async function renderCaptions(texts, width = 1920) {
  const missing = [...new Set(texts)].filter((t) => !fs.existsSync(captionFile(t, width)));
  if (!missing.length) return true;
  const { chromium } = await import("playwright");
  const { useChrome } = await import("./browser.js");
  let browser;
  try {
    // Google Chrome where there's no Playwright Chromium, as for the takes
    browser = await chromium.launch(useChrome() ? { channel: "chrome" } : {});
  } catch {
    return false;
  }
  try {
    fs.mkdirSync(CACHE, { recursive: true });
    const { size, padY, padX, radius, weight, smoothing, supersample } = captionStyle(width);
    const page = await browser.newPage({ viewport: { width, height: 600 }, deviceScaleFactor: supersample });
    await page.setContent(`<body style="margin:0;background:transparent"><div id="c" style="display:inline-block;white-space:nowrap;box-sizing:border-box;padding:${padY}px ${padX}px;border-radius:${radius}px;background:rgb(30 30 30 / 0.6);color:#fff;font:${weight} ${size}px -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;letter-spacing:0.025em;text-align:center;-webkit-font-smoothing:${smoothing}"></div></body>`);
    const box = page.locator("#c");
    for (const text of missing) {
      // As wide as the text; only a line too long for the video wraps, at 70% of its width
      await box.evaluate((el, [t, w]) => {
        el.textContent = t;
        el.style.whiteSpace = "nowrap";
        el.style.width = "";
        if (el.offsetWidth > w * 0.8) {
          el.style.whiteSpace = "normal";
          el.style.width = `${Math.round(w * 0.7)}px`;
        }
      }, [text, width]);
      const file = captionFile(text, width);
      const big = file.replace(/\.png$/, "-big.png");
      await box.screenshot({ path: big, omitBackground: true });
      execFileSync(FFMPEG, ["-v", "error", "-y", "-i", big, "-vf", `scale=iw/${supersample}:ih/${supersample}:flags=lanczos,format=rgba`, file]);
      fs.rmSync(big);
    }
  } finally {
    await browser.close();
  }
  return true;
}

/** A caption's image: rendered by renderCaptions(), else by pango-view */
function caption(text, width) {
  const rendered = captionFile(text, width);
  if (fs.existsSync(rendered)) return rendered;
  if (spawnSync("pango-view", ["--version"]).error || spawnSync("rsvg-convert", ["--version"]).error) {
    throw new Error(`No caption for "${text}": Chromium couldn't render it here, and there's no pango-view and rsvg-convert. Run narrate outside the sandbox, or record the take again.`);
  }
  // San Francisco, as macOS draws subtitles; pango finds it by its CoreText name only
  const size = Math.round(width * 0.0172);
  const font = `.AppleSystemUIFont ${size}`;
  const margin = `${Math.round(size * 0.03)} ${Math.round(size * 0.3)}`;
  const radius = Math.round(size * 0.235);
  // In Pango units, 1/1024 px with --pixels: 0.025em
  const tracking = Math.round(size * 0.025 * 1024);
  const markup = `<span letter_spacing="${tracking}">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>`;
  const hash = crypto.createHash("sha1").update(`${font}|${margin}|${radius}|${markup}`).digest("hex").slice(0, 16);
  const file = path.join(CACHE, `caption-${hash}.png`);
  if (!fs.existsSync(file)) {
    const words = path.join(CACHE, `caption-${hash}-text.png`);
    const box = path.join(CACHE, `caption-${hash}-box.png`);
    const dims = (f) => execFileSync(FFPROBE, ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", f]).toString().trim().split(",").map(Number);
    const render = (wrap) =>
      execFileSync("pango-view", [
        "-q", "--pixels", `--font=${font}`, "--foreground=#ffffff", "--background=transparent",
        `--margin=${margin}`, "--align=center",
        ...(wrap ? [`--width=${wrap}`, "--wrap=word"] : []), "--markup", `--text=${markup}`, "-o", words,
      ]);
    // As wide as the text; a wrap width would make the box that wide, so only a line
    // too long for the video wraps
    render();
    if (dims(words)[0] > width * 0.8) render(Math.round(width * 0.7));
    // pango-view's background has square corners: the box is drawn on its own, then the text on it
    const [w, h] = dims(words);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}" fill="#1e1e1e" fill-opacity="0.6"/></svg>`;
    execFileSync("rsvg-convert", ["-o", box], { input: svg });
    execFileSync(FFMPEG, ["-v", "error", "-y", "-i", box, "-i", words, "-filter_complex", "[0][1]overlay=format=auto,format=rgba", "-frames:v", "1", file]);
    fs.rmSync(words);
    fs.rmSync(box);
  }
  return file;
}

/**
 * Mixes the lines into `video` at the start of their steps (from the steps file beside it),
 * holding the last frame if the last line runs past the end. Writes `out`, with the lines as
 * a subtitle track and as an .srt beside it; `burn` also draws them on the video as captions.
 */
export function mix(video, lines, log, out, { burn = false } = {}) {
  const duration = seconds(video);
  const [source, sourceHeight] = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", video])
    .toString()
    .split(",")
    .map(Number);
  const width = narratedWidth(video);
  const placed = lines.flatMap((line) => {
    const step = log.find((s) => s.label === line.at);
    if (!step) throw new Error(`No step labelled "${line.at}" in the steps file`);
    // A step its `when` or `unless` skipped in this take: its line goes unsaid
    if (step.absent) {
      console.log(`  "${line.at}" was skipped in the take: its line is left out`);
      return [];
    }
    return [{ ...line, start: step.start }];
  });
  if (!placed.length) throw new Error("No line to mix in: every narrated step was skipped");
  placed.forEach((line, i) => {
    const next = placed[i + 1];
    if (next && line.start + line.duration > next.start)
      console.warn(`  "${line.at}" runs ${(line.start + line.duration - next.start).toFixed(1)}s into "${next.at}"`);
  });
  const end = Math.max(duration, ...placed.map((l) => l.start + l.duration + 0.5));

  // Each caption shows while its line is spoken, until the next starts at the latest
  const shown = placed.map((l, i) => ({ text: l.text, from: l.start, to: Math.min(l.start + l.duration + 0.3, placed[i + 1]?.start ?? end) }));
  const srt = out.replace(/\.mp4$/, ".srt");
  fs.writeFileSync(srt, shown.map((c, i) => `${i + 1}\n${timestamp(c.from)} --> ${timestamp(c.to)}\n${c.text}\n`).join("\n"));
  // A .vtt with each cue placed, for a player on a page: iOS draws an MP4's own track
  // flush right on the bottom edge, whatever the file asks for
  const vtt = out.replace(/\.mp4$/, ".vtt");
  const cue = (t) => timestamp(t).replace(",", ".");
  fs.writeFileSync(vtt, `WEBVTT\n\n${shown.map((c) => `${cue(c.from)} --> ${cue(c.to)} line:88% position:50% align:center size:80%\n${c.text}\n`).join("\n")}`);
  // The track itself comes from ASS, which carries what an .srt can't: the frame it's
  // placed in, and a style. Bottom centre, white on a dark box, sized to the video
  // The frame's own shape (a phone viewport is tall), at the width it's narrated at
  const height = Math.round((width * sourceHeight) / source / 2) * 2;
  const ass = path.join(CACHE, `${path.basename(out, ".mp4")}.ass`);
  const assTime = (t) => timestamp(t).replace(",", ".").slice(1, -1);
  fs.writeFileSync(ass, [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${width}`, `PlayResY: ${height}`, "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Helvetica Neue,${Math.round(height * 0.04)},&H00FFFFFF,&H00FFFFFF,&H33000000,&H33000000,0,0,0,0,100,100,0,0,3,0,0,2,40,40,${Math.round(height * 0.05)},1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    // One event a line: a line break is ASS's \N, and a brace would start an override block
    ...shown.map((c) => `Dialogue: 0,${assTime(c.from)},${assTime(c.to)},Default,,0,0,0,,${c.text.replace(/\r?\n/g, "\\N").replace(/\{/g, "(").replace(/\}/g, ")")}`),
  ].join("\n") + "\n");

  // Inputs: the video, a file per line, the subtitles, then the caption images
  const audioIn = (i) => i + 1;
  const captionIn = (i) => placed.length + 2 + i;
  const graph = [
    ...placed.map((l, i) => `[${audioIn(i)}:a]adelay=${Math.round(l.start * 1000)}:all=1[a${i}]`),
    `${placed.map((_, i) => `[a${i}]`).join("")}amix=inputs=${placed.length}:normalize=0[a]`,
  ];
  let v = "0:v";
  if (width < source) {
    graph.push(`[${v}]scale=${width}:-2:flags=lanczos[vs]`);
    v = "vs";
  }
  if (end > duration) {
    graph.push(`[${v}]tpad=stop_mode=clone:stop_duration=${(end - duration).toFixed(2)}[vp]`);
    v = "vp";
  }
  if (burn) {
    shown.forEach((c, i) => {
      graph.push(`[${v}][${captionIn(i)}:v]overlay=x=(W-w)/2:y=H-h-H*0.06:enable='between(t,${c.from.toFixed(2)},${c.to.toFixed(2)})'[vc${i}]`);
      v = `vc${i}`;
    });
  }
  const reencode = v !== "0:v";
  execFileSync(FFMPEG, [
    "-v", "error", "-y", "-i", video, ...placed.flatMap((l) => ["-i", l.file]), "-i", ass,
    ...(burn ? shown.flatMap((c) => ["-i", caption(c.text, width)]) : []),
    "-filter_complex", graph.join(";"),
    "-map", reencode ? `[${v}]` : "0:v", "-map", "[a]", "-map", `${placed.length + 1}:s`,
    ...(reencode
      ? ["-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p"]
      : ["-c:v", "copy"]),
    "-c:a", "aac", "-b:a", "160k", "-c:s", "mov_text", "-height", String(height), "-s:s", `${width}x${height}`, "-metadata:s:s:0", "language=eng", "-movflags", "+faststart", out,
  ]);
  textBox(out, width, height);
  return { duration: end, lines: placed, srt };
}

/**
 * Sets the subtitle track's text box, which ffmpeg leaves at zero: iOS then draws the text
 * flush right on the bottom edge. The box is the frame inset 5% on each side, and the
 * track's bottom-centre justification places the text in it. Patched in place: the box is
 * a fixed-size field of the tx3g sample description, in the moov at the front of the file.
 */
function textBox(file, width, height) {
  const data = fs.readFileSync(file);
  const moov = data.indexOf("moov");
  const end = moov < 4 ? -1 : moov - 4 + data.readUInt32BE(moov - 4);
  const tx3g = data.indexOf("tx3g", moov);
  if (end < 0 || tx3g < 0 || tx3g > end) throw new Error(`No tx3g sample description in ${file}`);
  // After the type: 6 reserved bytes, data reference index, display flags, the two
  // justifications and the background colour; then top, left, bottom, right as int16
  const box = tx3g + 4 + 8 + 4 + 2 + 4;
  const inset = (n) => Math.round(n * 0.05);
  [inset(height), inset(width), height - inset(height), width - inset(width)].forEach((v, i) => data.writeInt16BE(v, box + i * 2));
  fs.writeFileSync(file, data);
}
