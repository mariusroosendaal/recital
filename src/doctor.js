// recital doctor: checks what recording and narrating need, and says how to get what's
// missing. Exits 1 when something required is missing.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromeInstalled, chromiumInstalled } from "./browser.js";
import { CACHE_DIR, PROFILE_DIR, SCENARIO_DIR, WORKSPACE, loadEnv } from "./config.js";
import { FFMPEG, FFPROBE } from "./ffmpeg.js";

loadEnv();
let failed = false;
const report = (ok, what, detail, fix) => {
  if (!ok && fix) failed = true;
  console.log(`${ok ? "✓" : fix ? "✗" : "·"} ${what}${detail ? `: ${detail}` : ""}`);
  if (!ok && fix) console.log(`    ${fix}`);
};
const version = (cmd, flag = "-version") => {
  const run = spawnSync(cmd, [flag], { encoding: "utf8" });
  return run.error ? null : (run.stdout || run.stderr).split("\n")[0];
};

const node = Number(process.versions.node.split(".")[0]);
report(node >= 20, "Node", process.versions.node, "Node 20 or later: https://nodejs.org");

for (const [tool, file] of [["ffmpeg", FFMPEG], ["ffprobe", FFPROBE]]) {
  const v = version(file);
  report(Boolean(v), tool, v?.replace(/ Copyright.*/, ""), "brew install ffmpeg (macOS), apt install ffmpeg (Linux)");
}

const browser = chromiumInstalled() ? "installed" : chromeInstalled() ? "not installed: Google Chrome records instead" : null;
report(Boolean(browser), "Chromium", browser, "npx playwright install chromium, or install Google Chrome");

report(true, "Cache", CACHE_DIR);
report(fs.existsSync(PROFILE_DIR), "Browser profile", fs.existsSync(PROFILE_DIR) ? "logins kept" : "none yet; made on the first take, or with demo login");
const model = path.join(CACHE_DIR, "models/onnx-community/Kokoro-82M-v1.0-ONNX");
report(fs.existsSync(model), "Kokoro voice", fs.existsSync(model) ? "local copy" : "downloads from Hugging Face on first use");
report(Boolean(version("pango-view", "--version")), "pango-view", "optional: stands in for captions a take didn't render");

// The workspace, and the keys its scenarios need
console.log(`\nWorkspace ${WORKSPACE}`);
const scenarios = fs.existsSync(SCENARIO_DIR) ? fs.readdirSync(SCENARIO_DIR).filter((f) => f.endsWith(".js") && !f.startsWith("_")) : [];
report(scenarios.length > 0, "Scenarios", scenarios.length ? `${scenarios.length} in scenarios/` : null, "recital init makes an example");
const needs = { elevenlabs: [], figma: [] };
for (const file of scenarios) {
  const scenario = (await import(pathToFileURL(path.join(SCENARIO_DIR, file)))).default;
  if (scenario?.narrator?.provider === "elevenlabs") needs.elevenlabs.push(file);
  if (scenario?.file) needs.figma.push(file);
}
if (needs.elevenlabs.length) {
  report(Boolean(process.env.ELEVENLABS_API_KEY), "ELEVENLABS_API_KEY", `for ${needs.elevenlabs.length} scenarios`, "add it to .env or .env.local");
}
if (needs.figma.length) {
  report(Boolean(process.env.FIGMA_TOKEN), "FIGMA_TOKEN", `optional: the REST fallback for ${needs.figma.length} Figma scenarios`);
  report(fs.existsSync(PROFILE_DIR), "Figma login", null, "recital demo login figma");
}
process.exit(failed ? 1 : 0);
