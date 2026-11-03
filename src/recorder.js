// Records the page through Chromium's screencast at full device resolution, then
// re-times the variable-rate frames to a constant frame rate and encodes them with ffmpeg.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FPS, SCALE } from "./config.js";
import { FFMPEG } from "./ffmpeg.js";

export class Recorder {
  constructor(page, workDir, scale = SCALE) {
    this.page = page;
    this.scale = scale;
    this.dir = workDir;
    this.frames = [];
    this.writes = [];
    this.lastFrameAt = 0;
    // Seconds cut from the timeline while frames were rendered one at a time (see pause())
    this.offset = 0;
    this.paused = null;
  }

  saveFrame(buffer, time) {
    const file = path.join(this.dir, `${String(this.frames.length).padStart(6, "0")}.jpg`);
    this.frames.push({ file, time });
    this.writes.push(fs.promises.writeFile(file, buffer));
  }

  async start() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    await this.screencast();
    this.startedAt = Date.now();
  }

  /**
   * Records `page` from now on, e.g. a tab brought to the front; the timeline carries on.
   * Resolves with the time of the page's first frame, when the switch shows in the video.
   */
  async follow(page) {
    if (page === this.page) return this.elapsed();
    this.page = page;
    if (!this.cdp) return this.elapsed();
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    await this.cdp.detach().catch(() => {});
    const first = new Promise((resolve) => (this.onFirstFrame = resolve));
    await this.screencast();
    return Promise.race([first, new Promise((resolve) => setTimeout(() => resolve(this.elapsed()), 2000))]);
  }

  async screencast() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
      this.cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      if (this.paused) return;
      this.saveFrame(Buffer.from(data, "base64"), metadata.timestamp - this.offset);
      this.lastFrameAt = Date.now();
      // When it was captured, on the step log's timeline
      this.onFirstFrame?.(metadata.timestamp - this.offset - this.startedAt / 1000);
      this.onFirstFrame = null;
    });
    const { width, height } = this.page.viewportSize();
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 95,
      maxWidth: Math.round(width * this.scale),
      maxHeight: Math.round(height * this.scale),
    });
  }

  /** Seconds since recording started, on the video's timeline, for the step log. */
  elapsed() {
    return (Date.now() - this.startedAt) / 1000 - this.offset;
  }

  /**
   * Stops taking screencast frames so a sequence can be rendered frame by frame with
   * capture(); resume() then cuts the real time it took from the timeline.
   */
  pause() {
    this.paused = { at: Date.now() / 1000, frames: 0 };
  }

  /** Captures the page as the next frame of a paused sequence, exactly 1/FPS after the last. */
  async capture() {
    const { data } = await this.cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 95 });
    this.paused.frames++;
    this.saveFrame(Buffer.from(data, "base64"), this.paused.at - this.offset + this.paused.frames / FPS);
  }

  resume() {
    const { at, frames } = this.paused;
    this.offset += Date.now() / 1000 - at - frames / FPS;
    this.paused = null;
    this.lastFrameAt = Date.now();
  }

  /** Resolves once no new frame has arrived for `quietMs`: the screen has stopped changing. */
  async settle({ quietMs = 250, maxMs = 3000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (Date.now() - this.lastFrameAt >= quietMs) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

  async stop(outFile) {
    if (this.paused) this.resume();
    const stoppedAt = Date.now() / 1000 - this.offset;
    await this.cdp.send("Page.stopScreencast");
    await Promise.all(this.writes);
    if (this.frames.length === 0) throw new Error("Screencast produced no frames");

    // The video starts when the step log does, not at the first capture, which a slow machine
    // can send a few hundred ms later: every step would show that much early
    const startedAt = this.startedAt / 1000;
    await encode(this.frames, startedAt, stoppedAt, outFile);
    // The captures are in the video now: hundreds of MB a take otherwise (the folder stays,
    // for the take before its dissolves)
    for (const { file } of this.frames) fs.rmSync(file, { force: true });

    const seconds = stoppedAt - startedAt;
    return { frames: this.frames.length, seconds, sourceFps: this.frames.length / seconds };
  }
}

/**
 * Samples the captured frames onto an exact FPS grid (each output frame shows the next
 * capture around its time, so a 120 Hz window's uneven frames still land evenly) and pipes
 * them to
 * ffmpeg. Feeding the JPEGs through ffmpeg's
 * concat demuxer instead rounds their timestamps to 1/25 s and drops most of the motion.
 */
export async function encode(frames, start, stoppedAt, outFile) {
  const proc = spawn(
    FFMPEG,
    [
      "-v", "error", "-y",
      "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
      // Chrome's JPEGs are full-range BT.601; video players expect limited-range BT.709. An odd
      // size (a phone viewport at 1.2×) gets a pixel of edge, as 4:2:0 needs, rather than a resize
      "-vf", "scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
      "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "animation",
      "-movflags", "+faststart", outFile,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  let closed = false;
  const done = new Promise((resolve, reject) =>
    proc.on("close", (code) => {
      closed = true;
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`));
    }),
  );
  // Awaited at the end: an ffmpeg that quits early stops the writing, and its exit code is the
  // error, not the broken pipe
  done.catch(() => {});
  proc.stdin.on("error", () => {});

  // Before the first capture arrives, the video shows it
  const count = Math.round((stoppedAt - start) * FPS);
  let index = 0;
  let file = null;
  let data = null;
  for (let k = 0; k < count && !closed; k++) {
    const t = start + k / FPS;
    // Captures over half a frame old are dropped: a 120 Hz window gives two a frame
    const last = index;
    while (index + 1 < frames.length && frames[index + 1].time <= t - 0.5 / FPS) index++;
    // Otherwise one capture a frame. While they stream in, their times jitter, so the next
    // may come up to a frame and a half early rather than show the same frame twice, a
    // stutter in a scroll. After a gap (the screencast sends none while the screen is still)
    // it waits until due, or a scroll after a pause shows its first step early and stops.
    const next = frames[index + 1];
    const streaming = next && next.time - frames[index].time < 2.5 / FPS;
    if (k > 0 && index === last && next && next.time < t + (streaming ? 1.5 : 0.5) / FPS) index++;
    if (frames[index].file !== file) {
      file = frames[index].file;
      data = fs.readFileSync(file);
    }
    if (!proc.stdin.write(data)) await new Promise((resolve) => (proc.stdin.once("drain", resolve), proc.once("close", resolve)));
  }
  proc.stdin.end();
  await done;
}

/**
 * A copy phones can play, next to the take as `take-phone.mp4`: at most 1600×900 px of
 * picture (1600 wide at the default viewport) at H.264 level 4.2. A 3200×1800 take at 60 fps
 * needs level 6, which iPhones don't decode.
 */
export async function encodePhone(outFile) {
  const phoneFile = outFile.replace(/\.mp4$/, "-phone.mp4");
  const proc = spawn(
    FFMPEG,
    [
      "-v", "error", "-y", "-i", outFile,
      "-vf", "scale='2*trunc(iw*min(1,sqrt(1440000/(iw*ih)))/2)':-2:flags=lanczos",
      "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-tune", "animation",
      "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", phoneFile,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  await new Promise((resolve, reject) =>
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))),
  );
  return phoneFile;
}
