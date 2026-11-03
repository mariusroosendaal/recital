#!/usr/bin/env node
// recital <command> [...] [--workspace <name | path>]: runs a command on a workspace:
// the working directory when it has scenarios/ (and isn't the tool), else the `default` of
// workspaces.json.
// --workspace (or -w) names one from workspaces.json or gives its path; DEMO_WORKSPACE too.
// Each command is a script in src/ that reads its own arguments.
//
// workspaces.json, beside package.json and not in git, lists this machine's workspaces:
//   { "default": "plugins", "plugins": "~/code/plugin-demos", "examples": "examples" }

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const COMMANDS = {
  demo: "cli.js", // record a take, or `demo login`
  record: "cli.js",
  camera: "camera.js",
  narrate: "narrate.js",
  clips: "clips.js",
  frames: "frames.js",
  scripts: "scripts-doc.js",
  doctor: "doctor.js",
  init: "init.js",
  skill: "skill.js",
  validate: "validate.js",
  mcp: "mcp.js", // an MCP server, for agents outside a terminal
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const flag = args.findIndex((a) => a === "--workspace" || a === "-w");
const named = flag === -1 ? undefined : args.splice(flag, 2)[1];
const [command, ...rest] = args;
if (!COMMANDS[command]) {
  console.log(`Usage: recital <${Object.keys(COMMANDS).join(" | ")}> ... [--workspace <name | path>]`);
  process.exit(command ? 1 : 0);
}

/** A workspace from its name in workspaces.json, or a path (~ for home, relative to the tool) */
function workspace(name) {
  const file = path.join(ROOT, "workspaces.json");
  const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  let dir = list[name] ?? name;
  if (list[dir]) dir = list[dir]; // "default" names another entry
  return path.resolve(ROOT, expand(dir));
}

/** ~ and ${HOME} (or any variable) in a path: Claude Desktop passes a setting's default as written */
function expand(dir) {
  dir = dir.replace(/\$\{(\w+)\}/g, (match, name) => (name === "HOME" ? os.homedir() : process.env[name] ?? match));
  return dir.startsWith("~") ? path.join(os.homedir(), dir.slice(1)) : dir;
}

if (named) {
  process.env.DEMO_WORKSPACE = workspace(named);
} else if (!process.env.DEMO_WORKSPACE && command !== "init" && command !== "skill") {
  const here = path.resolve(process.cwd());
  const isWorkspace = here !== ROOT && fs.existsSync(path.join(here, "scenarios"));
  if (!isWorkspace) {
    const fallback = fs.existsSync(path.join(ROOT, "workspaces.json")) ? workspace("default") : null;
    if (fallback) process.env.DEMO_WORKSPACE = fallback;
  }
}
if (process.env.DEMO_WORKSPACE) {
  process.env.DEMO_WORKSPACE = path.resolve(expand(process.env.DEMO_WORKSPACE));
}
if (process.env.DEMO_WORKSPACE && command !== "mcp") {
  if (!fs.existsSync(process.env.DEMO_WORKSPACE)) {
    console.error(`No workspace at ${process.env.DEMO_WORKSPACE}`);
    process.exit(1);
  }
  // Paths in arguments and probes are the workspace's, as if run there. In recital mcp's
  // worker threads, which can't change directory, the server is there already.
  if (fs.realpathSync(process.cwd()) !== fs.realpathSync(process.env.DEMO_WORKSPACE)) process.chdir(process.env.DEMO_WORKSPACE);
}

const script = path.join(ROOT, "src", COMMANDS[command]);
process.argv = [process.argv[0], script, ...rest];
await import(pathToFileURL(script));
