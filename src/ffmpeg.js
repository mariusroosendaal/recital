// The ffmpeg and ffprobe recital runs: RECITAL_FFMPEG and RECITAL_FFPROBE, else the ones on the
// PATH or where Homebrew puts them (an app started from the Dock, like Claude Desktop, doesn't
// get the shell's PATH), else ffmpeg-static and @ffprobe-installer/ffprobe when they're
// installed, as they are in the Claude Desktop extension (scripts/mcpb.sh).

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const exe = process.platform === "win32" ? ".exe" : "";
const DIRS = [...(process.env.PATH ?? "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

function find(name, env, bundled) {
  if (process.env[env]) return process.env[env];
  for (const dir of DIRS) {
    const file = path.join(dir, name + exe);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {}
  }
  try {
    return bundled() ?? name;
  } catch {
    return name; // not found: running it says so
  }
}

export const FFMPEG = find("ffmpeg", "RECITAL_FFMPEG", () => require("ffmpeg-static"));
export const FFPROBE = find("ffprobe", "RECITAL_FFPROBE", () => require("@ffprobe-installer/ffprobe").path);
