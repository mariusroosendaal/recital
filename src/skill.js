// recital skill: copies the agent skill (skills/demo) into the working directory's
// .claude/skills/demo/, where Claude Code finds it, and over an older copy, so running it again
// after an update brings the skill up to date. The Claude Code plugin is the other way in:
// /plugin marketplace add mariusroosendaal/recital.

import fs from "node:fs";
import path from "node:path";
import { ROOT, WORKSPACE } from "./config.js";

const to = path.join(WORKSPACE, ".claude/skills/demo");
fs.mkdirSync(to, { recursive: true });
fs.cpSync(path.join(ROOT, "skills/demo"), to, { recursive: true });
console.log(`The demo skill is in ${path.relative(process.cwd(), to) || to}: ask your agent for a demo.`);
