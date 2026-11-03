// npm run demo -- login <url | scenario | adapter>   log in once at a URL, a scenario's page
//                                         or an adapter's login (figma); the profile is kept
//                                         in the cache (config.js), for every workspace
// npm run demo -- <scenario> [--dry]      run scenarios/<scenario>.js and record output/<scenario>/take.mp4
//   --dry        run without recording
//   --debug      log per-move cursor frame rates
//   --keep-open  leave the browser open afterwards (close the window to exit)
//   --out <file> output path
//   --scale <n>  device pixel ratio (default 2: 3200×1800 video at the default viewport; 1.2 gives 1920×1080)
//   --cursors <set>  another cursor set than the scenario's, to compare (see cursor.js)
//   --headless   no browser window (RECITAL_HEADLESS=1; the default on Linux with no display)
//   --inspect <file.js>  after setup, run the file's default export (page, ctx) instead of the steps

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launch } from "./browser.js";
import { dissolveTake, dissolves } from "./dissolve.js";
import { OUTPUT_DIR, SCALE, SCENARIO_DIR, headless, loadEnv } from "./config.js";
import { ADAPTERS, adapterFor } from "./adapters.js";
import { renderCaptions, voiceLines } from "./narration.js";
import { sleep } from "./motion.js";
import { Recorder, encodePhone } from "./recorder.js";
import { createContext, runSteps } from "./runner.js";
import { validate } from "./validate.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith("--") && !["--out", "--inspect", "--scale", "--cursors"].includes(args[i - 1]));
const command = positional[0];

loadEnv();
if (flag("debug")) process.env.DEMO_DEBUG = "1";
if (flag("headless")) process.env.RECITAL_HEADLESS = "1";

if (!command) {
  console.log("Usage: recital demo login | <scenario> [--dry] [--keep-open] [--out file]");
  process.exit(1);
}

if (command === "login") {
  if (headless()) {
    console.error("Logging in needs a browser window: run it where there's a display, without --headless.");
    process.exit(1);
  }
  const name = positional[1];
  if (!name) {
    console.error(`Usage: recital demo login <url | scenario | adapter>; the adapters are ${ADAPTERS.map((a) => a.name).join(", ")}`);
    process.exit(1);
  }
  // An adapter by name, a scenario's (or its page), else a URL
  let adapter = ADAPTERS.find((a) => a.name === name);
  let url = adapter?.login ?? name;
  const file = path.join(SCENARIO_DIR, `${name}.js`);
  if (!adapter && fs.existsSync(file)) {
    const scenario = (await import(pathToFileURL(file))).default;
    adapter = adapterFor(scenario);
    url = adapter?.login ?? adapter?.url?.(scenario) ?? scenario.url;
  }
  const { context, page } = await launch();
  await adapter?.prepare?.(context);
  await page.goto(url);
  console.log("Log in, then close the window.");
  await new Promise((resolve) => context.on("close", resolve));
  process.exit(0);
}

const scenarioFile = path.join(SCENARIO_DIR, `${command}.js`);
if (!fs.existsSync(scenarioFile)) {
  console.error(`No scenario at ${scenarioFile}`);
  process.exit(1);
}
const scenario = (await import(pathToFileURL(scenarioFile))).default;
const problems = validate(scenario);
if (problems.length) {
  console.error(`scenarios/${command}.js:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
const adapter = adapterFor(scenario);
const url = adapter?.url?.(scenario) ?? scenario.url;
if (!url) {
  console.error(`scenarios/${command}.js has no url`);
  process.exit(1);
}
const outFile = path.resolve(option("out") ?? path.join(OUTPUT_DIR, command, "take.mp4"));
// Its steps file, phone copy and partial take are named from it, beside it
if (!outFile.endsWith(".mp4")) {
  console.error(`--out is an .mp4 file, not ${option("out")}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });

const scale = Number(option("scale") ?? scenario.scale ?? SCALE);
const { context, page } = await launch({ viewport: scenario.viewport, scale, cursors: option("cursors") ?? scenario.cursors ?? adapter?.cursors });
await adapter?.prepare?.(context);
const inspect = option("inspect");
let recorder = null;
let ctx = null;
let exitCode = 0;
try {
  await page.emulateMedia({ colorScheme: scenario.theme ?? "light" });
  // `routes`: URLs (globs) answered from local files, e.g. a plugin's data source
  for (const [url, file] of Object.entries(scenario.routes ?? {})) {
    await context.route(url, (route) =>
      route.fulfill({ path: typeof file === "function" ? file(route.request().url()) : file, headers: { "Access-Control-Allow-Origin": "*" } }),
    );
  }
  await page.goto(url, { waitUntil: adapter?.waitUntil ?? "load", timeout: 60_000 });
  await adapter?.open?.(page, scenario);

  recorder = flag("dry") || inspect ? null : new Recorder(page, path.join(path.dirname(outFile), ".frames", path.basename(outFile, ".mp4")), scale);
  // The recorder is the context's only while it records: setup and teardown aren't in the take
  ctx = createContext({ page, scenario, recorder: null, adapter });

  // Voiced before the take, so it can pace the steps to them
  if (scenario.narration && recorder) {
    ctx.narration = await voiceLines(scenario);
    console.log(`Narration: ${ctx.narration.length} lines, ${ctx.narration.reduce((t, l) => t + l.duration, 0).toFixed(1)}s`);
    // narrate burns them in, and runs where Chromium can't start
    await renderCaptions(ctx.narration.map((l) => l.text));
  }

  console.log("Setup");
  await runSteps(ctx, scenario.setup ?? []);

  if (inspect) {
    const fn = (await import(pathToFileURL(path.resolve(inspect)))).default;
    console.log(JSON.stringify(await fn(page, ctx), null, 2));
  } else {
    await record(ctx, recorder);
  }
} catch (error) {
  console.error(`\n${error.message}`);
  // The tab the step was in
  await (ctx?.page ?? page).screenshot({ path: path.join(path.dirname(outFile), "error.png") }).catch(() => {});
  if (recorder?.startedAt) {
    const failed = outFile.replace(/\.mp4$/, "-failed.mp4");
    await recorder.stop(failed).catch(() => {});
    console.error(`Partial take: ${path.relative(process.cwd(), failed)}`);
  }
  exitCode = 1;
}

if (flag("keep-open")) {
  console.log("Browser left open; close the window to exit.");
  await new Promise((resolve) => context.on("close", resolve));
} else {
  await adapter?.close?.(page);
  await context.close();
}
process.exit(exitCode);

async function record(ctx, recorder) {
  console.log(recorder ? "Recording" : "Dry run");
  ctx.log = [];
  ctx.recorder = recorder;
  await recorder?.start();
  await sleep(scenario.leadIn ?? 800);
  await runSteps(ctx, scenario.steps);
  // The last line spoken to the end
  if (ctx.narrationEnd) await sleep(Math.max(0, ctx.narrationEnd - recorder.elapsed()) * 1000);
  await sleep(scenario.tail ?? 1500);

  if (recorder) {
    const stats = await recorder.stop(outFile);
    ctx.recorder = null;
    fs.writeFileSync(outFile.replace(/\.mp4$/, ".steps.json"), JSON.stringify(ctx.log, null, 2));
    dissolveTake(outFile, dissolves(ctx.log));
    console.log(
      `\n${path.relative(process.cwd(), outFile)}: ${stats.seconds.toFixed(1)}s, ` +
        `${stats.frames} frames captured (${stats.sourceFps.toFixed(0)} fps average)`,
    );
    console.log(`${path.relative(process.cwd(), await encodePhone(outFile))}: for phones`);
  }

  if (scenario.teardown) {
    console.log("Teardown");
    await runSteps(ctx, scenario.teardown);
  }
}
