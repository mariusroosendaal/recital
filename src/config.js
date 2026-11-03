import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The tool itself: its assets (cursors)
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The workspace: the folder with scenarios/, where output/, .narration/ and .env live. The
// working directory, or DEMO_WORKSPACE.
export const WORKSPACE = path.resolve(process.env.DEMO_WORKSPACE ?? process.cwd());
export const OUTPUT_DIR = path.join(WORKSPACE, "output");
export const SCENARIO_DIR = path.join(WORKSPACE, "scenarios");

// Shared by every workspace: the browser profile (logins) and the Kokoro model.
// ~/Library/Caches/recital on macOS, else $XDG_CACHE_HOME or ~/.cache; RECITAL_CACHE
// overrides it.
export const CACHE_DIR =
  process.env.RECITAL_CACHE ??
  (process.platform === "darwin"
    ? path.join(os.homedir(), "Library/Caches/recital")
    : path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"), "recital"));
export const PROFILE_DIR = path.join(CACHE_DIR, "profile");

// Each demo has a folder in output/: take.mp4 (+ .steps.json, -phone.mp4), camera.mp4,
// narration/, clips/, frames/ and error.png when a take fails.

/** The demo a video in output/<demo>/ belongs to */
export const demoOf = (video) => path.basename(path.dirname(path.resolve(video)));

/** The viewport a demo's takes were recorded at: its scenario's `viewport`, or the default */
export async function viewportOf(video) {
  const file = path.join(SCENARIO_DIR, `${demoOf(video)}.js`);
  const scenario = fs.existsSync(file) ? (await import(pathToFileURL(file))).default : {};
  return scenario.viewport ?? VIEWPORT;
}

/** A video argument: a file, or a demo's name (or folder) for the first of `files` in it */
export function videoArg(arg, files = ["take.mp4"]) {
  if (!arg || (fs.existsSync(arg) && fs.statSync(arg).isFile())) return arg;
  const dir = fs.existsSync(arg) ? arg : path.join(OUTPUT_DIR, arg);
  return files.map((f) => path.join(dir, f)).find((f) => fs.existsSync(f)) ?? arg;
}

// The page's size in CSS px unless a scenario sets `viewport`: 1600×900 at 2× → 3200×1800
// video, the same size as the old screen recordings.
export const VIEWPORT = { width: 1600, height: 900 };
export const SCALE = 2;
export const FPS = 60;

// No browser window: --headless (RECITAL_HEADLESS=1), and by itself on Linux with no display
export const headless = () =>
  /^(1|true)$/.test(process.env.RECITAL_HEADLESS ?? "") ||
  (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY);

// The workspace's .env, then .env.local (where the ElevenLabs CLI's `onboard connect` puts
// ELEVENLABS_API_KEY).
export function loadEnv() {
  for (const name of [".env", ".env.local"]) {
    const file = path.join(WORKSPACE, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}
