// Adapters teach the runner an app: how to open it, its own targets and actions. A scenario
// names a built-in one with `adapter`, or passes its own (an object, imported from the
// workspace); else the first built-in one whose `matches` takes it is used. A plain website
// needs none. docs/adapters.md has the shape of one.

import { adapter as figma } from "./figma.js";

export const ADAPTERS = [figma];

export function adapterFor(scenario) {
  if (scenario.adapter && typeof scenario.adapter === "object") return scenario.adapter;
  if (scenario.adapter) {
    const named = ADAPTERS.find((a) => a.name === scenario.adapter);
    if (!named) throw new Error(`No adapter "${scenario.adapter}"; there are ${ADAPTERS.map((a) => a.name).join(", ")}`);
    return named;
  }
  return ADAPTERS.find((a) => a.matches?.(scenario)) ?? null;
}
