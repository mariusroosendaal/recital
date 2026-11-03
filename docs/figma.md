# Figma plugin demos

The recorder drives Figma in the browser: it opens a file, sets the stage, runs a plugin
through Quick actions and works its UI, then frames the result on the canvas. A scenario
with `file`, a Figma URL, uses the Figma adapter (`src/figma.js`; [adapters.md](adapters.md)
has what an adapter is). Its takes use Figma's own cursors unless the scenario sets `cursors`.

## Before the first take

- **Log in** once: `npx recital demo login figma`, log in to Figma in the window that opens,
  and close it. The login is kept in the recorder's browser profile.
- **The plugin must be published.** The browser runs plugins from the Community; development
  plugins only run in the desktop app. A plugin the profile hasn't run before is found
  through Quick actions' Community search the first time.
- **A file for the demo.** A take changes the file, so record in a file, or a page, made for
  it. The scenario's `setup` puts the stage back the way the take starts, every time.
- `FIGMA_TOKEN` in the workspace's `.env` (a personal access token) lets the recorder read
  layer positions from the REST API when the editor can't give them. It's optional.

While a Figma take runs, requests to localhost are blocked, so Figma doesn't hand the file
to the desktop app.

## A scenario

```js
const plugin = (selector) => ({ plugin: selector });

export default {
  // node-id is the stage: a frame, or the page when the plugin works on the page itself
  file: "https://www.figma.com/design/<key>/<name>?node-id=0-1",
  // name: what Quick actions finds; ready: a selector that exists once its UI has loaded
  plugin: { name: "Grid Variables", ready: "role=button[name='Generate']" },
  speed: 1.25,

  setup: [
    // Empty the page, with the plugin API
    { eval: () => { for (const node of [...figma.currentPage.children]) node.remove(); } },
    { openPlugin: true },
    // The plugin window by its title bar, just above its iframe, to where it's out of the way
    { drag: { plugin: ":root", at: [0.3, 0], offset: [0, -20] }, to: { point: [1120, 230] }, ms: 300 },
    { press: "Meta+Period", in: "editor" },   // hide Figma's UI
    { cursor: [700, 650] },
  ],

  steps: [
    { type: "1280", into: plugin("#input-max-width"), clear: true, label: "max width" },
    { check: plugin("role=checkbox[name='Generate preview frame']"), label: "preview frame" },
    { click: plugin("role=button[name='Generate']"), waitFor: { ui: "text=/Created/" }, label: "generate" },
    { press: "Escape", in: "editor", label: "deselect" },
  ],
};
```

## Targets

| Target | Finds |
|---|---|
| `{ plugin: "<selector>" }` | An element in the plugin's window, such as `role=button[name='Generate']`. `":root"` is the window itself. |
| `{ canvas: "xl/header" }` | A layer under the stage, by its path of layer names. Found live in the editor, so it can be a layer the take just made. |
| `{ ui: "<selector>" }` | Figma's own UI, such as `role=button[name='Variables']` or `[data-testid=properties-panel]`. |

## Actions

| Action | |
|---|---|
| `openPlugin: true` | Runs the scenario's `plugin` through Quick actions and waits for `ready`. `cut: ms` keeps only that much of the loading in the video. |
| `stage` | `{ keep: ["xl"] }` empties the stage frame but for these layers; `{ remove: ["matrix"] }` deletes these layers from a stage page. |
| `view` | Frames the canvas: `{ layer: "xl", zoom: 0.3, anchor: [0.5, 0], to: [0.7, 0.08] }` puts the layer's top centre 70% across and 8% down. `layer` can be a list, or `"*"` for everything on the stage; `fit: "width"` picks the zoom; `{ center: [x, y], zoom }` sets it directly. `animate: ms` on the step eases there, after moving the cursor out of the shot (`park: [x, y]` elsewhere, `park: false` to leave it). |
| `deselect: true` | Clears the selection with a click on empty canvas; skipped when nothing is selected. |
| `waitForImages: true` | Waits until the page's image fills are downloaded and drawn. |
| `press` with `in: "editor"` | Sends keys to the canvas even when the plugin had focus: `Escape`, `Meta+Period` (hide or show the UI), `Meta+Backslash`. |
| `eval` | A function run in the editor, where the plugin API is `figma`, with `arg`. |

## What makes a good take

- **Reset in `setup`**: empty the stage (`stage`, or `eval` with the plugin API), put Figma's
  UI the way the take needs it, and check the plugin's remembered settings back to where
  they start. Guard each with `when` / `unless`, so it only runs when it needs to:
  `{ press: "Meta+Backslash", in: "editor", unless: { ui: "[data-testid=properties-panel]" } }`.
- **Put the plugin window next to what it works on**, so the cursor's trips are short.
- **Hide Figma's UI** (`Meta+Period` or `Meta+Backslash`) once the panels have done their
  part, so the canvas and the plugin fill the frame.
- **Don't click what's already right.** `check` skips a checkbox already in the wanted state;
  guard other steps with `unless`.
- **Wait for the result, not for time**: `waitFor` the plugin's notification or a layer, and
  `cut` the wait if it's long.
- `speed: 1.25` suits most takes; the default pace reads as slow.
- A plugin that selects what it made does so a moment after its notification; give the step
  after it a `hold`, or the deselect can land before the selection does.

## Finding selectors

`--inspect <file>` runs the scenario's setup, then a probe of your own instead of the steps,
and prints what it returns. A probe is a module whose default export gets `(page, ctx)`;
`ctx.plugin()` is the plugin's frame, and `ctx.layer(path)` a layer's box:

```js
export default async function (page, ctx) {
  const frame = await ctx.plugin();
  return frame.locator("button, input, [role]").evaluateAll((els) =>
    els.map((el) => `${el.getAttribute("role") ?? el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? el.textContent.trim()}`),
  );
}
```

```sh
npx recital demo grid-variables --inspect inspect/controls.js
```

Probes can import the recorder's modules, such as `recitaljs/runner.js` to run steps.
