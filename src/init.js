// recital init: makes the working directory a workspace, with an example scenario that
// records a page of its own, so the first take needs no app, login or API key. Leaves files
// that are already there alone.

import fs from "node:fs";
import path from "node:path";
import { ROOT, WORKSPACE } from "./config.js";

const write = (file, content) => {
  const to = path.join(WORKSPACE, file);
  if (fs.existsSync(to)) return console.log(`  ${file} is already there`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, content);
  console.log(`  ${file}`);
};

write("scenarios/example.js", fs.readFileSync(path.join(ROOT, "examples/scenarios/selftest.js"), "utf8"));
// Scenarios are ES modules, even where the workspace's package.json says "commonjs" (npm init's
// default since npm 11)
write("scenarios/package.json", '{ "type": "module" }\n');
write(".gitignore", "node_modules/\noutput/\n.narration/\n.env\n.env.local\n");
// An existing .gitignore gets the lines it lacks
const gitignore = path.join(WORKSPACE, ".gitignore");
const ignored = fs.readFileSync(gitignore, "utf8");
const missing = ["output/", ".narration/", ".env"].filter((line) => !ignored.split("\n").includes(line));
if (missing.length) fs.appendFileSync(gitignore, `${ignored.endsWith("\n") ? "" : "\n"}${missing.join("\n")}\n`);
console.log("\nThen: npx recital doctor, and npx recital demo example. npx recital skill adds the agent skill.");
