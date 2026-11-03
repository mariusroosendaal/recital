// Checks that need no browser: scenario validation and near matches. npm test.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { connect } from "./mcp-client.js";
import { closest, distance, suggest } from "../src/similar.js";
import { validate } from "../src/validate.js";
import rijksmuseum from "../examples/scenarios/rijksmuseum.js";
import selftest from "../examples/scenarios/selftest.js";

test("the example scenarios are valid", () => {
  assert.deepEqual(validate(selftest), []);
  assert.deepEqual(validate(rijksmuseum), []);
});

test("validation catches typos, with hints", () => {
  const problems = validate({
    file: "https://www.figma.com/design/abc/x?node-id=1-2",
    plugin: { name: "X", ready: "#app" },
    voise: "Lily",
    steps: [
      { clik: { ui: "#a" } },
      { click: { plugn: "#b" }, label: "open" },
      { click: { ui: "#c" }, hodl: 300, label: "go" },
      { type: "hi", into: { ui: "#d", ofset: [0, 2] } },
    ],
    narration: [{ at: "opne", text: "Open it." }],
    camera: [{ at: "go", zoom: 1.5 }],
  });
  for (const hint of ['"voice"', '"click"', '"plugin"', '"hold"', '"offset"', '"open"']) {
    assert.ok(problems.some((p) => p.includes(`did you mean ${hint}`)), `no hint for ${hint} in:\n${problems.join("\n")}`);
  }
  assert.ok(!problems.some((p) => p.startsWith("camera")), "camera's label is a step");
});

test("a scenario without url or file is caught", () => {
  assert.ok(validate({ steps: [] }).some((p) => p.startsWith("no url")));
});

test("Figma-only actions and keys need the Figma adapter", () => {
  assert.ok(validate({ url: "https://example.com", steps: [{ openPlugin: true }] }).some((p) => p.includes("no known action")));
  assert.ok(validate({ url: "https://example.com", plugin: { name: "X", ready: "#a" }, steps: [] }).some((p) => p.includes('"plugin"')));
  assert.deepEqual(validate({ file: "https://www.figma.com/design/abc/x", plugin: { name: "X", ready: "#a" }, steps: [{ openPlugin: true }] }), []);
});

test("a scenario's own adapter brings its keys, targets, actions and options", () => {
  const adapter = {
    name: "board",
    keys: ["board"],
    options: ["smooth"],
    url: (scenario) => `https://board.example.com/b/${scenario.board}`,
    boxes: { shape: async () => ({ x: 0, y: 0, width: 10, height: 10 }) },
    actions: { fit: async () => {} },
  };
  assert.deepEqual(validate({ adapter, board: "q3", steps: [{ fit: true, smooth: true }, { click: { shape: "Launch" } }] }), []);
  assert.ok(validate({ adapter, board: "q3", steps: [{ fit: true, smoth: true }] }).some((p) => p.includes('did you mean "smooth"')));
});

test("a target can be in an iframe", () => {
  assert.deepEqual(validate({ url: "https://example.com", steps: [{ click: { ui: "button", frame: "iframe#pay" } }] }), []);
});

test("near matches", () => {
  assert.equal(distance("Frist", "First"), 2);
  assert.deepEqual(closest("Generte", ["Generate", "Cancel", "Generated"], { limit: 2 }), ["Generate", "Generated"]);
  assert.equal(suggest("zzzzzz", ["click", "move"]), "");
});

test("the MCP server lists its tools, and writes and checks scenarios", async () => {
  const workspace = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "recital-mcp-")), "demos");
  const mcp = await connect(workspace);
  try {
    assert.equal(mcp.init.serverInfo.name, "recital");
    assert.match(mcp.init.instructions, /write_scenario/);
    const { tools } = (await mcp.request("tools/list")).result;
    for (const name of ["setup", "inspect_page", "write_scenario", "record", "narrate", "wait"]) assert.ok(tools.some((t) => t.name === name), `no ${name} tool`);

    const good = await mcp.call("write_scenario", { demo: "signup", source: 'export default { url: "https://example.com", steps: [{ hold: 500, label: "open" }] };' });
    assert.ok(!good.isError, good.content[0].text);
    const bad = await mcp.call("write_scenario", { demo: "typo", source: 'export default { url: "https://example.com", steps: [{ clik: { ui: "#a" } }] };' });
    assert.ok(bad.isError);
    assert.match(bad.content[0].text, /did you mean "click"/);
    assert.match((await mcp.call("list_demos")).content[0].text, /signup: not recorded yet/);
    assert.ok((await mcp.call("read_scenario", { demo: "../x" })).isError);
    assert.match((await mcp.call("guide", { topic: "format" })).content[0].text, /interface Scenario/);
  } finally {
    mcp.close();
    fs.rmSync(path.dirname(workspace), { recursive: true, force: true });
  }
});
