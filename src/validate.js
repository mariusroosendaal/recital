// Checks a scenario before the browser opens: every step has a known action and only options
// some action reads, targets name what they find, and `narration` and `camera` lines start at
// steps that exist. `recital validate [demo ...]` checks the workspace's scenarios (all
// of them by default); `demo` checks its scenario first.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ADAPTERS, adapterFor } from "./adapters.js";
import { CURSOR_SETS } from "./cursor.js";
import { SCENARIO_DIR } from "./config.js";
import { actionNames, stepLabel } from "./runner.js";
import { suggest } from "./similar.js";

// An adapter adds its own, such as Figma's `file` and `plugin`
const SCENARIO_KEYS = [
  "url", "adapter", "setup", "steps", "teardown", "theme", "viewport", "scale", "speed", "pauses",
  "routes", "tabs", "leadIn", "tail", "narration", "narrator", "voice", "camera", "final", "cursors",
];
// Options any step may have, and those some action reads; an adapter adds its actions' own
const OPTIONS = [
  "label", "hold", "speed", "ms", "waitFor", "timeout", "cut", "when", "unless", "settle", "dissolve", "through",
  "pause", "modifiers", "to", "by", "value", "files", "into", "clear", "delay", "in", "state", "scrollMs",
  "flick", "flicks", "animate", "arg",
];
const TARGET_OPTIONS = ["at", "offset", "cursor", "frame"];
// Actions whose value is a target (scroll's may also be px or { top })
const TARGETED = ["move", "click", "drag", "check", "chooseFiles", "wheel", "waitFor"];

/** The problems with `scenario`, as lines; none when it's fine. */
export function validate(scenario) {
  const problems = [];
  let adapter = null;
  try {
    adapter = adapterFor(scenario);
  } catch (error) {
    return [error.message];
  }
  const keys = [...SCENARIO_KEYS, ...(adapter?.keys ?? [])];
  // Hints come from every built-in adapter's keys too, for a typo in the one that picks it
  const hints = [...new Set([...keys, ...ADAPTERS.flatMap((a) => a.keys ?? [])])];
  for (const key of Object.keys(scenario)) if (!keys.includes(key)) problems.push(`unknown scenario key "${key}"${suggest(key, hints)}`);
  if (!scenario.url && !adapter?.url?.(scenario)) problems.push(`no url${adapter ? `, or what the ${adapter.name ?? "scenario's"} adapter opens` : ""}`);
  const { viewport } = scenario;
  if (viewport && !(viewport.width > 0 && viewport.height > 0)) problems.push("viewport needs a width and a height in CSS px, like { width: 390, height: 844 }");
  if (scenario.cursors && !CURSOR_SETS.includes(scenario.cursors)) problems.push(`no cursor set "${scenario.cursors}"${suggest(scenario.cursors, CURSOR_SETS)}; there are ${CURSOR_SETS.join(", ")}`);

  const actions = actionNames(adapter);
  const options = [...OPTIONS, ...(adapter?.options ?? [])];
  const targetKeys = ["ui", "point", ...Object.keys(adapter?.frames ?? {}), ...Object.keys(adapter?.boxes ?? {})];
  const checkTarget = (where, target) => {
    if (!target || typeof target !== "object" || Array.isArray(target)) return problems.push(`${where}: not a target: ${JSON.stringify(target)}`);
    const kinds = Object.keys(target).filter((k) => targetKeys.includes(k));
    if (kinds.length !== 1) problems.push(`${where}: a target needs one of ${targetKeys.join(", ")}: ${JSON.stringify(target)}`);
    for (const key of Object.keys(target)) {
      if (!targetKeys.includes(key) && !TARGET_OPTIONS.includes(key)) {
        problems.push(`${where}: unknown target key "${key}"${suggest(key, [...targetKeys, ...TARGET_OPTIONS])}`);
      }
    }
  };

  if (!Array.isArray(scenario.steps)) problems.push("steps: missing, the take's steps as an array");
  const labels = new Set();
  for (const part of ["setup", "steps", "teardown"]) {
    for (const [i, step] of (scenario[part] ?? []).entries()) {
      const where = `${part} ${i + 1}`;
      const action = Object.keys(step).find((key) => actions.includes(key));
      if (!action) {
        const first = Object.keys(step)[0] ?? "";
        problems.push(`${where}: no known action in ${JSON.stringify(step)}${suggest(first, actions)}`);
        continue;
      }
      if (part === "steps") labels.add(stepLabel(step, action));
      for (const key of Object.keys(step)) {
        if (key !== action && !options.includes(key)) problems.push(`${where} (${action}): unknown option "${key}"${suggest(key, options)}`);
      }
      const value = step[action];
      if (TARGETED.includes(action)) checkTarget(where, value);
      if (action === "scroll" && typeof value === "object" && value.top == null) checkTarget(where, value);
      if (action === "drag" && step.to) checkTarget(`${where} to`, step.to);
      if (action === "drag" && !step.to && !step.by) problems.push(`${where} (drag): no \`to\` target or \`by\` [x, y]`);
      if (action === "tab" && value !== "main" && !scenario.tabs?.[value]) problems.push(`${where} (tab): no tab "${value}" in tabs${suggest(String(value), Object.keys(scenario.tabs ?? {}))}`);
      for (const key of ["into", "when", "unless"]) if (step[key]) checkTarget(`${where} ${key}`, step[key]);
      if (step.waitFor && action !== "waitFor") checkTarget(`${where} waitFor`, step.waitFor);
    }
  }

  for (const kind of ["narration", "camera"]) {
    for (const line of scenario[kind] ?? []) {
      if (!labels.has(line.at)) problems.push(`${kind}: no step labelled "${line.at}"${suggest(line.at, labels)}`);
    }
  }
  return problems;
}

// recital validate [demo ...]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const files = names.length
    ? names.map((n) => `${n}.js`)
    : fs.readdirSync(SCENARIO_DIR).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
  let failed = 0;
  for (const file of files.sort()) {
    const scenario = (await import(pathToFileURL(path.join(SCENARIO_DIR, file)))).default;
    const problems = validate(scenario);
    console.log(`${problems.length ? "✗" : "✓"} ${file.replace(/\.js$/, "")}`);
    for (const p of problems) console.log(`    ${p}`);
    if (problems.length) failed++;
  }
  process.exit(failed ? 1 : 0);
}
