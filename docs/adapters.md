# Adapters

Most web apps need nothing beyond `ui` targets and the built-in actions, with `frame` for an
element in an iframe. An adapter is for an app that needs more: a canvas whose shapes aren't
elements, a window of its own, a way to know it's ready, steps of its own. It teaches the
recorder how to open the app, its targets and its actions.

Figma's is built in ([figma.md](figma.md)): a scenario with `file` uses it. You can write
your own for any other app.

## Your own

An adapter is an object; keep it beside the scenarios, outside `scenarios/` (which holds
only scenarios), and pass it as `adapter`. Say a whiteboard app shows its board on a
canvas and has a script API on `window.board`:

```js
// adapters/whiteboard.js
/** @type {import("recitaljs").Adapter} */
export default {
  name: "whiteboard",
  // npx recital demo login <scenario> opens this
  login: "https://board.example.com/login",
  // A scenario key of its own, and the page it opens
  keys: ["board"],
  url: (scenario) => `https://board.example.com/b/${scenario.board}`,

  // The page has loaded; wait for the app too
  async open(page) {
    await page.waitForFunction(() => window.board?.ready);
  },

  // { shape: "Launch" }: a shape on the canvas by its text, in CSS px of the viewport
  boxes: {
    shape: (ctx, target) => ctx.page.evaluate((text) => window.board.screenBounds(text), target.shape),
  },

  // { fit: true }: zooms to the whole board, then holds 600 ms
  holds: { fit: 600 },
  actions: {
    async fit(ctx) {
      await ctx.page.evaluate(() => window.board.zoomToFit());
    },
  },
};
```

```js
// scenarios/launch.js
import whiteboard from "../adapters/whiteboard.js";

export default {
  adapter: whiteboard,
  board: "q3-plan",
  steps: [
    { fit: true },
    { click: { shape: "Launch" }, label: "pick" },
    { press: "Delete", label: "remove" },
  ],
};
```

`validate`, `demo` and the rest take the adapter's keys, targets, actions and options as
their own.

## What an adapter can have

All but `name` are optional; `Adapter` in [types.d.ts](../types.d.ts) has each one's shape.

| Member | |
|---|---|
| `name` | For messages, and `adapter: "<name>"` for a built-in one. |
| `keys`, `options` | Scenario keys and step options it reads. |
| `url`, `login` | The page the take starts on, when it isn't `url`; where `demo login` opens. |
| `waitUntil`, `prepare`, `open`, `close` | When the first page counts as loaded; before it (routes, permissions); after it, until the app is ready; before the browser closes. |
| `cursors` | The cursor set, when the scenario doesn't choose one. |
| `frames` | Targets looked up in a frame of the app's own: `{ plugin: (ctx) => frame }` makes `{ plugin: "<selector>" }`. |
| `boxes` | Targets with a box of their own, like the `shape` above. |
| `focus` | Places `press` sends keys to with `in`. |
| `actions`, `holds` | Its steps, and ms to hold after each. An action returns `false` when it skipped itself. |
| `extend` | Adds to `ctx`, the run's state, for its targets and actions to share. |

An action that moves the cursor itself uses recitaljs's own motion, so it glides like the
rest: `import { moveCursor, clickAt, cursorPos } from "recitaljs/motion.js"`. Steps with an
adapter's actions or targets aren't in the scenario types, so under `// @ts-check` they're
underlined; type such a step `/** @type {any} */` or leave the check out.

[src/figma.js](../src/figma.js) is a full one: a plugin's iframe as a target, layers on the
canvas by name, camera moves and staging the file.
