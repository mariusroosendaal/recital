// recital mcp: an MCP server on stdin and stdout, for agents that don't run in a terminal, such
// as Claude Desktop (the extension scripts/mcpb.sh packs), or any MCP client:
//   claude mcp add recital -- npx -y -p recitaljs recital mcp -w <workspace>
// Its tools run the CLI's commands on the workspace (DEMO_WORKSPACE, made if it isn't there)
// and hand back what to look at: the page's screenshots, a contact sheet of the take, the
// videos' paths. A tool still running after RECITAL_MCP_WAIT seconds (45) goes on as a job:
// it says so, and `wait` picks it up, so long takes and downloads outlast a client's timeout.
//
// With RECITAL_MCP_SESSIONS=1, in the environment or the workspace's .env, each session's calls
// go in output/sessions/<started>/session.json, with the images the tools returned.
// Off by default: the images can show sites the person is signed in to.
//
// The commands run in worker threads, not processes: Claude Desktop's built-in Node, which
// runs the extension where there's no Node installed, refuses to start one of itself.

import { execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { PLAYWRIGHT_CLI, chromeInstalled, chromiumInstalled } from "./browser.js";
import { OUTPUT_DIR, ROOT, SCENARIO_DIR, WORKSPACE, loadEnv } from "./config.js";
import { FFMPEG } from "./ffmpeg.js";

// stdout carries the protocol: whatever the modules log goes to stderr
console.log = console.error;

// The workspace's .env, for the server's own settings: the commands' workers read it too, but
// what they set stays in them
loadEnv();

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const WAIT = Number(process.env.RECITAL_MCP_WAIT ?? 45) * 1000;
const BIN = path.join(ROOT, "src/bin.js");
const PROBE = path.join(ROOT, "examples/inspect/page.js");

const INSTRUCTIONS = `recital records narrated demo videos of web apps, websites and Figma plugins. A demo is a scenario, scenarios/<demo>.js in the workspace (${WORKSPACE}): the page to open, the steps to click through, and the lines a voice says. recital drives a browser with a calm cursor, records it, and makes a final video with the voice and captions.

The person asking may not be a developer: talk about the demo, not the code. Show a scenario only if they ask. Never ask for a password: when a site needs a login, use the login tool and let them sign in themselves.

The workflow:
1. Run setup once, at the start of a session. It makes the workspace, gets the browser if it's missing, and reports anything else that is.
2. Plan the demo with the person: a task start to finish, a tour, or one feature, in 3 to 6 narrated steps and 15 to 45 seconds. Draft the narration first: each line becomes a labelled step. guide "narration" has the rules for the lines.
3. Read guide "format" (the scenario's every key, action and option) before writing a scenario. Figma plugins: guide "figma" too.
4. See the page: inspect_page with the url. Look at the screenshots and the list of headings, links and buttons.
5. Write the scenario with write_scenario: an ES module, export default { url, steps, narration, narrator }. Don't import anything. Prefer selectors a person would read, such as role=button[name='Save'] and text=Welcome. Put what the viewer shouldn't see in setup. Label every step a line or camera framing starts at. After a click that loads something, waitFor what appears.
6. record with dry: true to check the steps, then record. Look at the contact sheet every time, one frame at the end of each step: a take that ran without errors can still show the wrong thing. Fix holds, scrolls and order, and record again. frames shows a moment up close.
7. Zoom if small UI is hard to read: camera framings in the scenario, then camera.
8. narrate makes the final video, output/final/<demo>.mp4, with captions. The voice is the scenario's narrator. The default, Kokoro, is local and free: narrator: { voice: "af_heart" } (or bf_emma, am_michael, bm_george and others). ElevenLabs voices are a voice in the person's ElevenLabs account, by name: narrator: { provider: "elevenlabs", voice: "Lily" }; they need ELEVENLABS_API_KEY (in the extension's settings, or the workspace's .env) and cost money, so ask first. The take waits for each line, so after changing the voice, record again before narrate.
9. Tell the person where the final video is and offer to open it. To update it after the product changes: record, camera (if it has framings), narrate.

Tools that take long (record, narrate, setup) may come back saying they're still running: call wait with the job number until they finish.`;

const GUIDES = {
  workflow: () => INSTRUCTIONS,
  format: () => fs.readFileSync(path.join(ROOT, "types.d.ts"), "utf8"),
  narration: () => fs.readFileSync(path.join(ROOT, "docs/narration.md"), "utf8"),
  figma: () => fs.readFileSync(path.join(ROOT, "docs/figma.md"), "utf8"),
  adapters: () => fs.readFileSync(path.join(ROOT, "docs/adapters.md"), "utf8"),
};

const text = (s, isError = false) => ({ content: [{ type: "text", text: s }], ...(isError && { isError }) });
const demoName = { type: "string", description: "The demo's name: scenarios/<demo>.js" };

/** Runs a script with `args` in a worker thread, its output going to the job as it comes */
function run(job, script, args) {
  return new Promise((resolve) => {
    const worker = new Worker(script, { argv: args, env: { ...process.env, DEMO_WORKSPACE: WORKSPACE }, stdout: true, stderr: true });
    let output = "";
    const take = (chunk) => {
      output += chunk;
      job.write(String(chunk));
    };
    worker.stdout.on("data", take);
    worker.stderr.on("data", take);
    worker.on("error", (e) => take(e.stack ?? e.message));
    // Done when it has exited and said everything
    const ended = (stream) => new Promise((done) => stream.on("end", done));
    const exited = new Promise((done) => worker.on("exit", done));
    Promise.all([exited, ended(worker.stdout), ended(worker.stderr)]).then(([code]) => resolve({ ok: code === 0, output: output.trim() }));
  });
}
async function recital(job, ...args) {
  const result = await run(job, BIN, args);
  // The profile is in use: a login window still open, or a sandbox that keeps Chromium from starting
  if (!result.ok && /ProcessSingleton/.test(result.output)) {
    result.output += "\n\nThe browser didn't start: if a recital browser window is still open (from login), close it and try again.";
  }
  return result;
}

/** A picture to look at, at most `width` px wide, with a line above it; fit() encodes it */
const image = (file, width = 1600, label) => ({ type: "image", file, width, label });

/**
 * A picture as a JPEG `scale` of its width at ffmpeg quality `q`, or the file itself if ffmpeg
 * can't. Not waited on in a block, so ping and other calls are answered meanwhile
 */
let encoded = 0;
async function encode({ file, width, label }, scale, q) {
  const out = path.join(os.tmpdir(), `recital-mcp-${process.pid}-${++encoded}.jpg`);
  await new Promise((resolve) =>
    execFile(FFMPEG, ["-v", "error", "-y", "-i", file, "-vf", `scale='min(${Math.round(width * scale)},iw)':-2`, "-q:v", String(q), out], resolve),
  );
  const jpeg = fs.existsSync(out);
  const picture = { type: "image", data: fs.readFileSync(jpeg ? out : file).toString("base64"), mimeType: jpeg ? "image/jpeg" : "image/png" };
  fs.rmSync(out, { force: true });
  return label ? [{ type: "text", text: label }, picture] : [picture];
}

// Claude Desktop refuses a tool result over 1 MB, its pictures' base64 included
const BUDGET = 900_000;
const size = (content) => Buffer.byteLength(JSON.stringify(content));

/**
 * A result with its pictures encoded: smaller and coarser until it fits in BUDGET, and the
 * last ones (with their labels) left out if it still doesn't
 */
async function fit(result) {
  if (!result.content.some((c) => c.type === "image" && c.file)) return result;
  let parts;
  for (const [scale, q] of [[1, 4], [0.75, 6], [0.5, 8]]) {
    parts = await Promise.all(result.content.map((c) => (c.type === "image" && c.file ? encode(c, scale, q) : [c])));
    if (size(parts.flat()) <= BUDGET) return { ...result, content: parts.flat() };
  }
  let dropped = 0;
  while (size(parts.flat()) > BUDGET && parts.some((p) => p.at(-1).type === "image")) {
    parts.splice(parts.findLastIndex((p) => p.at(-1).type === "image"), 1);
    dropped++;
  }
  const note = `${dropped} more picture${dropped > 1 ? "s" : ""} left out: the result can't be over 1 MB. Ask for fewer at a time.`;
  return { ...result, content: [...parts.flat(), { type: "text", text: note }] };
}

const pngs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(dir, f)) : []);

// A name the CLI reads as a demo: not a flag, nor one of `demo`'s commands
function scenarioFile(demo) {
  if (!/^\w[\w-]*$/.test(demo ?? "") || demo === "login") throw new Error(`"${demo}" isn't a demo name: letters, digits, - and _, not starting with -, and not login`);
  return path.join(SCENARIO_DIR, `${demo}.js`);
}

/**
 * A scenario as it is now: imported again once the file has changed, so edits show. Each
 * import stays in memory, so only a changed file is imported again
 */
const load = async (demo) => {
  const file = scenarioFile(demo);
  return (await import(`${pathToFileURL(file).href}?${fs.statSync(file).mtimeMs}`)).default;
};

// Scenarios are ES modules, whatever the workspace's package.json says
function scenariosDir() {
  fs.mkdirSync(SCENARIO_DIR, { recursive: true });
  const pkg = path.join(SCENARIO_DIR, "package.json");
  if (!fs.existsSync(pkg)) fs.writeFileSync(pkg, '{ "type": "module" }\n');
}

/**
 * The contact sheet of a video in output/<demo>/, one frame at the end of each step. The job
 * keeps the frames themselves, for the session's log.
 */
async function sheet(job, demo, video) {
  const frames = await recital(job, "frames", path.join(OUTPUT_DIR, demo, `${video}.mp4`), "--steps");
  if (!frames.ok) return [{ type: "text", text: frames.output }];
  const stills = frames.output.split("\n").filter((l) => /\.png\s{2}/.test(l)).map((l) => l.split(/\s{2}/));
  job.stills = stills.map(([file, label]) => ({ file: path.join(WORKSPACE, file), label }));
  const steps = stills.map(([, label]) => label);
  return [
    { type: "text", text: `Contact sheet, a frame at the end of each step: ${steps.join(", ")}` },
    image(path.join(OUTPUT_DIR, demo, "frames", video, "sheet.png")),
  ];
}

const TOOLS = [
  {
    name: "guide",
    description: "recital's reference: workflow (how to make a demo), format (every scenario key, action and option), narration (writing the spoken lines), figma (Figma plugin demos), adapters (apps whose canvas selectors can't reach).",
    inputSchema: { type: "object", properties: { topic: { type: "string", enum: Object.keys(GUIDES) } }, required: ["topic"] },
    annotations: { readOnlyHint: true },
    run: async ({ topic }) => (GUIDES[topic] ? text(GUIDES[topic]()) : text(`Topics: ${Object.keys(GUIDES).join(", ")}`, true)),
  },
  {
    name: "setup",
    description: "Gets recording ready: makes the workspace (with an example demo), downloads the browser if it's missing, and checks ffmpeg, the voice and keys. Run it once at the start.",
    inputSchema: { type: "object", properties: {} },
    run: async (_, job) => {
      if (!fs.existsSync(SCENARIO_DIR)) await recital(job, "init");
      // Playwright's download needs a Node process of its own, which Claude Desktop's built-in
      // Node can't start; Google Chrome records as well
      if (!chromiumInstalled() && !chromeInstalled()) {
        job.write("Downloading the browser (Chromium)\n");
        const install = await run(job, PLAYWRIGHT_CLI, ["install", "chromium"]);
        if (!install.ok) {
          return text(`The browser didn't download. Ask the person to install Google Chrome (https://www.google.com/chrome/), which recital records with as well, then run setup again.\n\n${install.output}`, true);
        }
      }
      const doctor = await recital(job, "doctor");
      return text(`Workspace: ${WORKSPACE}\n\n${doctor.output}`, !doctor.ok);
    },
  },
  {
    name: "list_demos",
    description: "The workspace's demos, and the videos each has so far.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async () => {
      const names = fs.existsSync(SCENARIO_DIR) ? fs.readdirSync(SCENARIO_DIR).filter((f) => f.endsWith(".js") && !f.startsWith("_")).map((f) => f.slice(0, -3)) : [];
      const lines = await Promise.all(
        names.sort().map(async (demo) => {
          const final = await load(demo).then((s) => s?.final ?? demo, () => demo);
          const videos = [path.join(OUTPUT_DIR, demo, "take.mp4"), path.join(OUTPUT_DIR, demo, "camera.mp4"), path.join(OUTPUT_DIR, "final", `${final}.mp4`)].filter((f) => fs.existsSync(f));
          return `${demo}: ${videos.length ? videos.map((f) => path.relative(WORKSPACE, f)).join(", ") : "not recorded yet"}`;
        }),
      );
      return text(`Workspace: ${WORKSPACE}\n${lines.join("\n") || "No demos yet."}`);
    },
  },
  {
    name: "read_scenario",
    description: "A demo's scenario file.",
    inputSchema: { type: "object", properties: { demo: demoName }, required: ["demo"] },
    annotations: { readOnlyHint: true },
    run: async ({ demo }) => {
      const file = scenarioFile(demo);
      return fs.existsSync(file) ? text(fs.readFileSync(file, "utf8")) : text(`No scenario ${demo}`, true);
    },
  },
  {
    name: "write_scenario",
    description: "Writes a demo's scenario (the whole file, an ES module with export default {...}) and checks it.",
    inputSchema: {
      type: "object",
      properties: { demo: demoName, source: { type: "string", description: "The file's full contents" } },
      required: ["demo", "source"],
    },
    run: async ({ demo, source }, job) => {
      const file = scenarioFile(demo);
      scenariosDir();
      fs.writeFileSync(file, source.endsWith("\n") ? source : `${source}\n`);
      const check = await recital(job, "validate", demo);
      return text(check.ok ? `Saved ${path.relative(WORKSPACE, file)}; it checks out.` : `Saved, but:\n${check.output}`, !check.ok);
    },
  },
  {
    name: "inspect_page",
    description: "Opens a page (a url, or a demo's after its setup) and returns screenshots down it, with its headings, links, buttons and inputs and their boxes in CSS px.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" }, demo: { ...demoName, description: "A demo whose page (and setup) to open instead of a url" } },
    },
    run: async ({ url, demo }, job) => {
      if (!demo) {
        if (!url) return text("Give a url or a demo", true);
        scenariosDir();
        demo = "_inspect";
        fs.writeFileSync(scenarioFile(demo), `export default ${JSON.stringify({ url, steps: [{ hold: 500 }] })};\n`);
      }
      const probe = path.join(WORKSPACE, "output/probe");
      fs.rmSync(probe, { recursive: true, force: true });
      const result = await recital(job, "demo", demo, "--inspect", PROBE);
      const shots = pngs(probe);
      return {
        content: [{ type: "text", text: result.output }, ...shots.slice(0, 6).map((f) => image(f, 1200))],
        ...(!result.ok && { isError: true }),
      };
    },
  },
  {
    name: "record",
    description: "Records a demo's take, output/<demo>/take.mp4, paced to its narration, and returns a contact sheet of how each step ends. dry: true runs the steps without recording, to check them.",
    inputSchema: { type: "object", properties: { demo: demoName, dry: { type: "boolean" } }, required: ["demo"] },
    run: async ({ demo, dry }, job) => {
      const started = Date.now();
      const result = await recital(job, "demo", demo, ...(dry ? ["--dry"] : []));
      if (!result.ok) {
        const shot = path.join(OUTPUT_DIR, demo, "error.png");
        const fresh = fs.existsSync(shot) && fs.statSync(shot).mtimeMs >= started;
        return { content: [{ type: "text", text: result.output }, ...(fresh ? [image(shot, 1600, "The page when it failed:")] : [])], isError: true };
      }
      return { content: [{ type: "text", text: result.output }, ...(dry ? [] : await sheet(job, demo, "take"))] };
    },
  },
  {
    name: "camera",
    description: "Makes the zoomed version of a take, output/<demo>/camera.mp4, from the scenario's camera framings, and returns its contact sheet.",
    inputSchema: { type: "object", properties: { demo: demoName }, required: ["demo"] },
    run: async ({ demo }, job) => {
      const result = await recital(job, "camera", demo);
      if (!result.ok) return text(result.output, true);
      return { content: [{ type: "text", text: result.output }, ...(await sheet(job, demo, "camera"))] };
    },
  },
  {
    name: "frames",
    description: "Frames of a demo's take (or its camera version) at the given seconds, to look at a moment up close.",
    inputSchema: {
      type: "object",
      properties: { demo: demoName, at: { type: "array", items: { type: "number" }, description: "Seconds into the video" }, video: { type: "string", enum: ["take", "camera"] } },
      required: ["demo", "at"],
    },
    annotations: { readOnlyHint: true },
    run: async ({ demo, at, video = "take" }, job) => {
      if (!["take", "camera"].includes(video)) return text(`video is take or camera, not ${video}`, true);
      const result = await recital(job, "frames", path.join(OUTPUT_DIR, demo, `${video}.mp4`), "--at", at.slice(0, 8).join(","));
      if (!result.ok) return text(result.output, true);
      const files = pngs(path.join(OUTPUT_DIR, demo, "frames", video)).filter((f) => !f.endsWith("sheet.png"));
      return { content: files.map((f) => image(f, 1200, path.basename(f, ".png").replace(/^\d+-/, ""))) };
    },
  },
  {
    name: "narrate",
    description: "Voices the narration with the scenario's narrator and makes the final video, output/final/<demo>.mp4, with captions burned in (and a -plain.mp4 with subtitle files beside it). voice and provider try another voice on the take, without making the final video; to change the voice for good, set the scenario's narrator and record again.",
    inputSchema: {
      type: "object",
      properties: {
        demo: demoName,
        voice: { type: "string", description: "Another voice than the scenario's: a Kokoro voice such as bf_emma, or an ElevenLabs voice's name with provider elevenlabs" },
        provider: { type: "string", enum: ["kokoro", "elevenlabs"] },
      },
      required: ["demo"],
    },
    run: async ({ demo, voice, provider }, job) => {
      scenarioFile(demo);
      const result = await recital(job, "narrate", demo, ...(voice ? ["--voice", voice] : []), ...(provider ? ["--provider", provider] : []));
      return text(`${result.output}\n\nPaths are in ${WORKSPACE}`, !result.ok);
    },
  },
  {
    name: "login",
    description: "Opens the browser for the person to sign in to a site (a url, a demo's page, or figma), and returns at once. The login is kept for every later take. Ask them to sign in and close the window, and wait until they say they have.",
    inputSchema: { type: "object", properties: { target: { type: "string", description: "A url, a demo's name, or figma" } }, required: ["target"] },
    run: async ({ target }, job) => {
      const opened = recital(job, "demo", "login", target);
      const quick = await Promise.race([opened, new Promise((resolve) => setTimeout(resolve, 3000))]);
      if (quick && !quick.ok) return text(quick.output, true);
      return text("A browser window is open. Ask the person to sign in there, then close the window.");
    },
  },
  {
    name: "open",
    description: "Opens a demo's video for the person to watch, or its folder: final (the default), take, camera or folder.",
    inputSchema: { type: "object", properties: { demo: demoName, what: { type: "string", enum: ["final", "take", "camera", "folder"] } }, required: ["demo"] },
    run: async ({ demo, what = "final" }) => {
      const final = await load(demo).then((s) => s?.final ?? demo, () => demo);
      const file = {
        final: path.join(OUTPUT_DIR, "final", `${final}.mp4`),
        take: path.join(OUTPUT_DIR, demo, "take.mp4"),
        camera: path.join(OUTPUT_DIR, demo, "camera.mp4"),
        folder: path.join(OUTPUT_DIR, demo),
      }[what];
      if (!fs.existsSync(file)) return text(`There's no ${path.relative(WORKSPACE, file)} yet`, true);
      const [cmd, ...args] = { darwin: ["open"], win32: ["cmd", "/c", "start", ""] }[process.platform] ?? ["xdg-open"];
      spawn(cmd, [...args, file], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
      return text(`Opened ${file}`);
    },
  },
  {
    name: "wait",
    description: "Waits for a tool that is still running, by its job number, and returns its result when it finishes.",
    inputSchema: { type: "object", properties: { job: { type: "number" } }, required: ["job"] },
    annotations: { readOnlyHint: true },
    run: async ({ job }) => (jobs.has(job) ? settle(jobs.get(job)) : text(`No job ${job} is running: its result has been returned`, true)),
  },
];

const jobs = new Map();
let lastJob = 0;

/** A job's result once it has one, or within WAIT a note that it's still going */
async function settle(job, progressToken) {
  let progress = 0;
  const onOutput = (chunk) => {
    const message = chunk.trim().split("\n").at(-1);
    if (progressToken != null && message) send({ method: "notifications/progress", params: { progressToken, progress: ++progress, message } });
  };
  job.listeners.add(onOutput);
  let timer;
  const result = await Promise.race([job.result, new Promise((resolve) => (timer = setTimeout(resolve, WAIT)))]);
  clearTimeout(timer);
  job.listeners.delete(onOutput);
  if (result) {
    jobs.delete(job.id);
    return result;
  }
  return text(`Still running (${job.name}): call wait with job ${job.id}.\n\nSo far:\n${job.log.trim().split("\n").slice(-12).join("\n")}`);
}

async function call({ name, arguments: args = {}, _meta }) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return text(`No tool ${name}`, true);
  // A folder picked in Claude Desktop may not be there yet; one that can't be made is said
  // here, rather than keeping the server from starting
  try {
    fs.mkdirSync(WORKSPACE, { recursive: true });
    process.chdir(WORKSPACE); // for the workers, which can't
  } catch (error) {
    return text(`The demos folder, ${WORKSPACE}, can't be made (${error.code}): choose another (in the extension's settings, or with -w).`, true);
  }
  if (name === "wait") return tool.run(args);
  // Every tool's demo is a name in scenarios/, never a path
  if (args.demo !== undefined) {
    try {
      scenarioFile(args.demo);
    } catch (error) {
      return text(error.message, true);
    }
  }
  const job = {
    id: ++lastJob,
    name,
    log: "",
    listeners: new Set(),
    write(chunk) {
      this.log = (this.log + chunk).slice(-8000);
      for (const listener of this.listeners) listener(chunk);
    },
  };
  const started = Date.now();
  job.result = tool.run(args, job).then(fit).catch((error) => text(error.message, true));
  job.result.then((result) => logCall(name, args, result, started, job.stills));
  jobs.set(job.id, job);
  return settle(job, _meta?.progressToken);
}

// Claude Desktop keeps one server for every chat, and the server isn't told which chat a call
// is from: a new session starts after IDLE without calls, or at a second setup (the workflow's
// first call)
const IDLE = 10 * 60 * 1000;
let session = null;
/** Adds a call to the session's log, with the stills of a take's steps; one that can't be written doesn't fail the tool */
function logCall(tool, args, result, started, stills = []) {
  if (!/^(1|true)$/.test(process.env.RECITAL_MCP_SESSIONS ?? "")) return;
  try {
    const again = tool === "setup" && session?.log.calls.some((c) => c.tool === "setup");
    if (!session || again || started - session.last > IDLE) {
      // Named for when it started, in local time, as the person remembers it
      const id = new Date(started - new Date(started).getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace(/[T:]/g, "-");
      session = { dir: path.join(OUTPUT_DIR, "sessions", id), log: { started: new Date(started).toISOString(), calls: [] } };
      fs.mkdirSync(session.dir, { recursive: true });
    }
    const n = String(session.log.calls.length + 1).padStart(2, "0");
    const images = result.content
      .filter((c) => c.type === "image")
      .map((c, i) => {
        const file = `${n}-${i + 1}.${c.mimeType === "image/png" ? "png" : "jpg"}`;
        fs.writeFileSync(path.join(session.dir, file), Buffer.from(c.data, "base64"));
        return file;
      });
    const kept = stills.map(({ file, label }, i) => {
      const to = `${n}-still-${i + 1}.jpg`;
      spawnSync(FFMPEG, ["-v", "error", "-y", "-i", file, "-vf", "scale='min(800,iw)':-2", "-q:v", "4", path.join(session.dir, to)]);
      return { file: to, label };
    });
    const said = result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n\n");
    // The final video, relative to the session's folder
    const final = tool === "narrate" && !result.isError && said.match(/output\/final\/([^\s:]+\.mp4)/);
    session.log.calls.push({
      tool,
      args,
      at: new Date(started).toISOString(),
      seconds: Math.round((Date.now() - started) / 100) / 10,
      ok: !result.isError,
      text: tool === "guide" ? "" : said, // the reference itself, not the session's
      images,
      ...(kept.length && { stills: kept }),
      ...(final && { video: `../../final/${final[1]}` }),
    });
    session.last = Date.now();
    fs.writeFileSync(path.join(session.dir, "session.json"), `${JSON.stringify(session.log, null, 2)}\n`);
  } catch (error) {
    console.error(`Couldn't log the ${tool} call: ${error.message}`);
  }
}

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

const METHODS = {
  initialize: ({ protocolVersion }) => ({
    protocolVersion: PROTOCOLS.includes(protocolVersion) ? protocolVersion : PROTOCOLS[0],
    capabilities: { tools: {} },
    serverInfo: { name: "recital", version: VERSION },
    instructions: INSTRUCTIONS,
  }),
  ping: () => ({}),
  "tools/list": () => ({ tools: TOOLS.map(({ run, ...tool }) => tool) }),
  "tools/call": call,
};

const input = readline.createInterface({ input: process.stdin });
input.on("close", () => process.exit(0));
input.on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return send({ id: null, error: { code: -32700, message: "Parse error" } });
  }
  // One request an object; batches aren't part of MCP
  if (message === null || typeof message !== "object" || Array.isArray(message)) return send({ id: null, error: { code: -32600, message: "Invalid request" } });
  if (message.id === undefined) return; // a notification
  const method = METHODS[message.method];
  if (!method) return send({ id: message.id, error: { code: -32601, message: `No method ${message.method}` } });
  try {
    send({ id: message.id, result: await method(message.params ?? {}) });
  } catch (error) {
    send({ id: message.id, error: { code: -32603, message: error.message } });
  }
});
