// Figma specifics: the file's layer tree from the REST API, the canvas viewport,
// the plugin iframe, and launching a plugin. `adapter` at the end puts them in a scenario's
// reach: a scenario with `file` (a Figma URL) uses it.

import { FPS } from "./config.js";
import { clickAt, cursorPos, moveCursor, nearestExit, sleep } from "./motion.js";

export function parseFileUrl(url) {
  const key = url.match(/figma\.com\/(?:design|file|board)\/([A-Za-z0-9]+)/)?.[1];
  const nodeId = new URL(url).searchParams.get("node-id")?.replace("-", ":");
  if (!key) throw new Error(`Not a Figma file URL: ${url}`);
  return { key, nodeId };
}

/** The stage node and everything under it, as last saved. */
export async function fetchNode(fileKey, nodeId) {
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new Error("FIGMA_TOKEN missing from .env");
  const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=4`;
  const res = await fetch(url, { headers: { "X-Figma-Token": token } });
  if (!res.ok) throw new Error(`Figma API ${res.status}: ${await res.text()}`);
  const node = (await res.json()).nodes[nodeId]?.document;
  if (!node) throw new Error(`Node ${nodeId} not found in ${fileKey}`);
  return node;
}

/**
 * `"xl"` or `"xl/page hero"`: each segment is the nearest descendant with that name. A slash
 * with spaces round it is part of a name ("color / light"), as Figma writes them.
 */
export function findLayer(root, layerPath) {
  let node = root;
  for (const name of layerPath.split(/(?<! )\/(?! )/)) {
    const queue = [...(node.children ?? [])];
    let found = null;
    while (queue.length && !found) {
      const next = queue.shift();
      if (next.name === name) found = next;
      else queue.push(...(next.children ?? []));
    }
    if (!found) throw new Error(`Layer "${layerPath}" not found under "${root.name}"`);
    node = found;
  }
  return node;
}

/**
 * Live bounds of layers under the stage, from the editor's plugin API, so layers created
 * during the take are found too. Several paths give the box around all of them.
 */
export async function layerBox(page, stageId, paths) {
  return page.evaluate(
    async ([id, list]) => {
      if (!window.figma) return null;
      const stage = await figma.getNodeByIdAsync(id);
      const find = (path) => {
        let node = stage;
        // A layer that's gone, such as an instance's sublayer after a swap, throws on read
        const named = (n, name) => {
          try {
            return n.name === name;
          } catch {
            return false;
          }
        };
        for (const name of path.split(/(?<! )\/(?! )/)) {
          const queue = [...node.children];
          let found = node.children.find((n) => named(n, name)) ?? null;
          while (queue.length && !found) {
            const next = queue.shift();
            if (named(next, name)) found = next;
            else if ("children" in next) queue.push(...next.children);
          }
          if (!found) throw new Error(`Layer "${path}" not found under "${stage.name}"`);
          node = found;
        }
        return node.absoluteBoundingBox;
      };
      // "*": every layer at the stage's top level
      const boxes = list.flatMap((path) =>
        path === "*" ? stage.children.filter((n) => n.visible).map((n) => n.absoluteBoundingBox) : [find(path)],
      );
      const x = Math.min(...boxes.map((b) => b.x));
      const y = Math.min(...boxes.map((b) => b.y));
      const right = Math.max(...boxes.map((b) => b.x + b.width));
      const bottom = Math.max(...boxes.map((b) => b.y + b.height));
      return { x, y, width: right - x, height: bottom - y };
    },
    [stageId, paths],
  );
}

export async function waitForEditor(page) {
  const stayHere = page.getByText("Open here instead");
  const canvas = page.locator("canvas");
  // A large file can take a couple of minutes to load
  const timeout = 150_000;
  await Promise.race([stayHere.waitFor({ timeout }), canvas.first().waitFor({ timeout })]);
  if (await stayHere.isVisible()) {
    console.log("  (Figma tried to open the desktop app; staying in the browser)");
    await stayHere.click();
  }
  await page.waitForFunction(
    () => {
      const canvas = [...document.querySelectorAll("canvas")].find((c) => c.clientWidth > 400);
      return canvas && canvas.clientHeight > 300;
    },
    null,
    { timeout },
  );
  await page.waitForFunction(() => window.figma?.currentPage?.name, null, { timeout: 30_000 });
  await sleep(1500);
  await dismissDialogs(page);
}

/**
 * Throws unless the editor opened on the page of the URL's node-id. A node-id the file
 * no longer has opens the first page instead, where a setup that clears the page would
 * clear the wrong one.
 */
export async function checkPage(page, url) {
  const id = new URL(url).searchParams.get("node-id")?.replace("-", ":");
  if (!id) return;
  const opened = await page.evaluate(async (id) => {
    const node = await figma.getNodeByIdAsync(id);
    let p = node;
    while (p && p.type !== "PAGE") p = p.parent;
    return p ? p.id === figma.currentPage.id : null;
  }, id);
  if (opened === null) throw new Error(`node-id ${id} isn't in the file; Figma opened "${await page.evaluate(() => figma.currentPage.name)}" instead`);
  if (!opened) throw new Error(`Figma didn't open the page of node-id ${id}`);
}

// Prompts Figma shows on load in a fresh browser profile
const DIALOGS = ["Need to use the desktop app or installed fonts?"];

export async function dismissDialogs(page) {
  for (const title of DIALOGS) {
    const close = page.getByRole("button", { name: "Close" });
    const dialog = page.locator("div").filter({ has: page.getByText(title) }).filter({ has: close }).last();
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.locator(close).first().click();
      await sleep(500);
    }
  }
}

/** Screen position of the canvas and what part of the document it shows. */
export async function canvasViewport(page) {
  return page.evaluate(() => {
    const canvas = [...document.querySelectorAll("canvas")].sort(
      (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
    )[0];
    const rect = canvas.getBoundingClientRect();
    const { bounds, zoom } = window.figma.viewport;
    return { left: rect.left, top: rect.top, zoom, x: bounds.x, y: bounds.y };
  });
}

export function toScreen(viewport, point) {
  return {
    x: viewport.left + (point.x - viewport.x) * viewport.zoom,
    y: viewport.top + (point.y - viewport.y) * viewport.zoom,
  };
}

/**
 * Goes to the stage's page and clears what earlier takes left there, then the selection.
 * The stage is the `node-id` of the scenario's file: a frame, where `keep` names the
 * children to keep and everything else goes, or a page, where `remove` names the top-level
 * layers a plugin creates (a page is never emptied wholesale).
 */
export async function prepareStage(page, stageId, { keep, remove }) {
  return page.evaluate(
    async ([id, keepNames, removeNames]) => {
      const stage = await figma.getNodeByIdAsync(id);
      if (!stage) throw new Error(`Stage ${id} not found; was it deleted?`);
      let pageNode = stage;
      while (pageNode.type !== "PAGE") pageNode = pageNode.parent;
      await figma.setCurrentPageAsync(pageNode);
      if (stage.type === "PAGE" && !removeNames) throw new Error("A page stage needs `remove`, not `keep`");
      const removed = [];
      for (const child of [...stage.children]) {
        const goes = removeNames ? removeNames.includes(child.name) : !keepNames.includes(child.name);
        if (!goes) continue;
        removed.push(child.name);
        child.remove();
      }
      figma.currentPage.selection = [];
      return removed;
    },
    [stageId, keep ?? null, remove ?? null],
  );
}

/**
 * The nearest point to `from` (screen px) where a click lands on empty canvas: inside the
 * visible canvas, `margin` px clear of anything a click there would select. Null if none.
 */
export async function emptyCanvasPoint(page, from, { margin = 16, edge = 40, after } = {}) {
  const viewport = await canvasViewport(page);
  const { canvas, visible } = await canvasArea(page);
  // `after`: a viewport the point must also be empty in, e.g. where a camera move ends
  const viewports = [viewport];
  if (after) {
    viewports.push({
      left: canvas.x,
      top: canvas.y,
      zoom: after.zoom,
      x: after.center.x - canvas.width / 2 / after.zoom,
      y: after.center.y - canvas.height / 2 / after.zoom,
    });
  }
  // What a click would select: children of top-level frames and sections (their own
  // background selects nothing, like an artboard), other top-level layers themselves
  const { boxes, frames, windows } = await page.evaluate(() => {
    const top = figma.currentPage.children.filter((n) => n.visible && n.absoluteBoundingBox);
    const containers = top.filter((n) => ["FRAME", "SECTION"].includes(n.type) && n.children.length);
    return {
      boxes: top
        .flatMap((n) => (containers.includes(n) ? n.children.filter((c) => c.visible) : [n]))
        .map((n) => n.absoluteBoundingBox)
        .filter(Boolean),
      frames: top.filter((n) => n.type === "FRAME").map((n) => n.absoluteBoundingBox),
      // Plugin windows float over the canvas: their iframes, with the title bar above
      windows: [...document.querySelectorAll("iframe")]
        .map((f) => f.getBoundingClientRect())
        .filter((r) => r.width && r.height)
        .map((r) => ({ x: r.left, y: r.top - 48, right: r.right, bottom: r.bottom })),
    };
  });
  const screenBoxes = [
    ...windows.map((w) => ({ x: w.x - margin, y: w.y - margin, right: w.right + margin, bottom: w.bottom + margin })),
    ...viewports.flatMap((vp) => [
      ...boxes.map((b) => {
        const p = toScreen(vp, b);
        return { x: p.x - margin, y: p.y - margin, right: p.x + b.width * vp.zoom + margin, bottom: p.y + b.height * vp.zoom + margin };
      }),
      // A top-level frame's name label, drawn just above it, selects the frame too
      ...frames.map((b) => {
        const p = toScreen(vp, b);
        return { x: p.x - margin, y: p.y - 24 - margin, right: p.x + b.width * vp.zoom + margin, bottom: p.y };
      }),
    ]),
  ];
  const free = (p) =>
    p.x >= visible.x + edge &&
    p.x <= visible.x + visible.width - edge &&
    p.y >= visible.y + edge &&
    p.y <= visible.y + visible.height - edge &&
    !screenBoxes.some((b) => p.x >= b.x && p.x <= b.right && p.y >= b.y && p.y <= b.bottom);

  // Rings around the cursor, nearest first
  for (let r = 0; r <= 2000; r += 20) {
    const steps = Math.max(1, Math.round((2 * Math.PI * r) / 20));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      const p = { x: from.x + r * Math.cos(a), y: from.y + r * Math.sin(a) };
      if (free(p)) return p;
    }
  }
  return null;
}

/** The canvas element, and the part of it not covered by the properties panel. */
async function canvasArea(page) {
  return page.evaluate(() => {
    const canvas = [...document.querySelectorAll("canvas")].sort(
      (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
    )[0];
    const c = canvas.getBoundingClientRect();
    const panel = document.querySelector("[data-testid=properties-panel]")?.getBoundingClientRect();
    const right = panel?.width ? Math.min(c.right, panel.left) : c.right;
    return {
      canvas: { x: c.left, y: c.top, width: c.width, height: c.height },
      visible: { x: c.left, y: c.top, width: right - c.left, height: c.height },
    };
  });
}

/**
 * The viewport that puts `anchor` (a fraction of the box) at `to` (a fraction of the visible
 * canvas area). `zoom` is a number, or `fit: "width" | "height"` with a `margin` in px.
 */
export async function viewFor(page, box, { zoom, fit, margin = 40, anchor = [0.5, 0.5], to = [0.5, 0.5] }) {
  const { canvas, visible } = await canvasArea(page);
  if (fit === "width") zoom = (visible.width - 2 * margin) / box.width;
  if (fit === "height") zoom = (visible.height - 2 * margin) / box.height;
  const point = { x: box.x + box.width * anchor[0], y: box.y + box.height * anchor[1] };
  const screen = { x: visible.x + visible.width * to[0], y: visible.y + visible.height * to[1] };
  // The viewport centre sits at the centre of the canvas element
  const center = {
    x: point.x - (screen.x - canvas.x - canvas.width / 2) / zoom,
    y: point.y - (screen.y - canvas.y - canvas.height / 2) / zoom,
  };
  return { center, zoom };
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Camera between two viewports at `t` (0–1): zoom on a log scale, like Figma's own, and the
 * centre moving in step with the visible area's size so the pan doesn't overshoot.
 */
function cameraAt(from, to, t) {
  const e = ease(t);
  const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e);
  const span = 1 / to.zoom - 1 / from.zoom;
  const f = Math.abs(span) < 1e-9 ? e : (1 / zoom - 1 / from.zoom) / span;
  return {
    zoom,
    center: { x: from.center.x + (to.center.x - from.center.x) * f, y: from.center.y + (to.center.y - from.center.y) * f },
  };
}

const applyView = (page, view) =>
  page.evaluate(([c, z]) => {
    window.figma.viewport.zoom = z;
    window.figma.viewport.center = c;
  }, [view.center, view.zoom]);

/**
 * Sets the viewport, or eases to it over `animate` ms. While recording, the move is rendered
 * frame by frame: Figma redraws a busy canvas slower than 60 fps, which makes a live camera
 * move judder, so each frame is set, left to finish drawing, and captured at its exact time.
 */
export async function setView(page, target, animate = 0, recorder = null) {
  if (!animate) {
    await applyView(page, target);
    await sleep(300);
    return;
  }
  const from = await page.evaluate(() => ({ center: figma.viewport.center, zoom: figma.viewport.zoom }));
  const count = Math.max(1, Math.round((animate / 1000) * FPS));

  if (recorder) {
    recorder.pause();
    for (let k = 1; k <= count; k++) {
      await applyView(page, cameraAt(from, target, k / count));
      // Two animation frames for Figma to draw, then a moment for tiles to fill in
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await sleep(30);
      await recorder.capture();
    }
    recorder.resume();
  } else {
    const start = Date.now();
    for (;;) {
      const t = Math.min(1, (Date.now() - start) / animate);
      await applyView(page, cameraAt(from, target, t));
      if (t >= 1) break;
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    }
  }
  await sleep(300);
}

/** Runs a plugin through Quick actions; wait for its UI with pluginFrame(). */
export async function launchPlugin(page, name) {
  await page.evaluate(() => document.querySelector("input[role=application]")?.focus());
  await page.keyboard.press("ControlOrMeta+/");
  await sleep(500);
  await page.keyboard.type(name, { delay: 30 });
  await sleep(1200);
  // A plugin this browser hasn't run yet isn't among the results; its community search is
  const result = page.getByText(name, { exact: true }).first();
  if (!(await result.isVisible())) {
    await page.getByText("in plugins & widgets").first().click();
    await result.waitFor({ timeout: 10_000 });
    await sleep(300);
    // Enter opens its community page; Run there starts it
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: /^Run/ }).waitFor({ timeout: 10_000 });
    await sleep(300);
  }
  await page.keyboard.press("Enter");
}

/** Plugin UIs sit in nested iframes; the right one is whichever contains `ready`. */
export async function pluginFrame(page, ready, timeout = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const count = await frame.locator(ready).count().catch(() => 0);
      if (count > 0) return frame;
    }
    await sleep(250);
  }
  throw new Error(`No plugin frame with ${ready}`);
}

const focusEditor = (page) => page.evaluate(() => document.querySelector("input[role=application]")?.focus());

/**
 * The Figma adapter. A scenario gives `file`, a Figma URL whose `node-id` is the stage (a
 * frame, or a page when the plugin works on the page itself), and `plugin`: `name` for Quick
 * actions and `ready`, a selector that exists once its UI has loaded.
 *
 * Targets: `{ plugin: selector }` in the plugin iframe, `{ canvas: "xl/header" }` a layer under
 * the stage by name path (live from the editor, else the REST API). `press` takes
 * `in: "editor"` for the canvas. Actions: deselect, waitForImages, view, stage, openPlugin.
 */
export const adapter = {
  name: "figma",
  matches: (scenario) => Boolean(scenario.file),
  keys: ["file", "plugin"],
  options: ["park"],
  cursors: "figma",
  login: "https://www.figma.com/login",
  url: (scenario) => scenario.file,
  waitUntil: "domcontentloaded",

  /** Figma's local agent hands files to the desktop app; keep everything in this window */
  async prepare(context) {
    await context.route(
      (url) => ["127.0.0.1", "localhost"].includes(url.hostname),
      (route) => route.abort(),
    );
  },

  async open(page, scenario) {
    await waitForEditor(page);
    await checkPage(page, scenario.file);
  },

  /** Figma saves edits a moment after they're made; closing straight away can lose them */
  async close(page) {
    await page.waitForTimeout(4000).catch(() => {});
  },

  extend(ctx) {
    ctx.stage = null;
    ctx.frame = null;
    ctx.plugin = async () => {
      if (ctx.frame && !ctx.frame.isDetached()) return ctx.frame;
      ctx.frame = await pluginFrame(ctx.tabs.main, ctx.scenario.plugin.ready);
      return ctx.frame;
    };
    // Live bounds from the editor; the REST API (the file as last saved) when that isn't there
    ctx.layer = async (paths) => {
      const list = [paths].flat();
      const { key, nodeId } = parseFileUrl(ctx.scenario.file);
      const live = await layerBox(ctx.tabs.main, nodeId, list);
      if (live) return live;
      ctx.stage ??= await fetchNode(key, nodeId);
      const boxes = list.flatMap((p) =>
        p === "*" ? ctx.stage.children.map((n) => n.absoluteBoundingBox) : [findLayer(ctx.stage, p).absoluteBoundingBox],
      );
      const x = Math.min(...boxes.map((b) => b.x));
      const y = Math.min(...boxes.map((b) => b.y));
      return {
        x,
        y,
        width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
        height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
      };
    };
  },

  frames: { plugin: (ctx) => ctx.plugin() },

  boxes: {
    async canvas(ctx, target) {
      const b = await ctx.layer(target.canvas);
      const viewport = await canvasViewport(ctx.page);
      const topLeft = toScreen(viewport, b);
      return { x: topLeft.x, y: topLeft.y, width: b.width * viewport.zoom, height: b.height * viewport.zoom };
    },
  },

  /** `press` with `in: "editor"` sends the keys to the canvas even when the plugin had focus */
  focus: { editor: (ctx) => focusEditor(ctx.page) },

  holds: { deselect: 300, view: 600, openPlugin: 400 },

  actions: {
    /**
     * `{ deselect: true }` clears the selection with a click on empty canvas: where the cursor
     * is if nothing is under it, else the nearest empty spot. Skipped when nothing is selected.
     */
    async deselect(ctx, _, step) {
      const selected = await ctx.page.evaluate(() => figma.currentPage.selection.length);
      if (!selected) return false;
      const point = await emptyCanvasPoint(ctx.page, await cursorPos(ctx.page));
      if (point) {
        await clickAt(ctx.page, point, step);
      } else {
        await focusEditor(ctx.page);
        await ctx.page.keyboard.press("Escape");
        await sleep(60);
      }
    },

    /**
     * `{ waitForImages: true }` waits until the image fills on the current page are downloaded,
     * then until the screen stops changing as the canvas draws them.
     */
    async waitForImages(ctx, _, step) {
      await ctx.page.evaluate(async () => {
        const hashes = new Set();
        for (const node of figma.currentPage.findAll((n) => "fills" in n && Array.isArray(n.fills)))
          for (const fill of node.fills) if (fill.type === "IMAGE" && fill.imageHash) hashes.add(fill.imageHash);
        await Promise.all([...hashes].map((hash) => figma.getImageByHash(hash)?.getBytesAsync()));
      });
      const deadline = Date.now() + (step.timeout ?? 30_000);
      let last = null;
      while (Date.now() < deadline) {
        await sleep(400);
        const shot = (await ctx.page.screenshot({ scale: "css" })).toString("base64");
        if (shot === last) return;
        last = shot;
      }
    },

    /**
     * `{ view: { layer: "xl", zoom: 0.3, anchor: [0.5, 0], to: [0.65, 0.1] } }` puts the layer's
     * top centre 65% across and 10% down the canvas; `layer` can list several layers, and
     * `fit: "width"` picks the zoom. `{ view: { center: [x, y], zoom } }` sets it directly.
     * `animate` (ms on the step) eases the camera there, after moving the cursor off the
     * nearest screen edge (`park: [x, y]` elsewhere, or `park: false` to leave it).
     */
    async view(ctx, view, step) {
      const target = view.layer
        ? await viewFor(ctx.page, await ctx.layer(view.layer), view)
        : { center: { x: view.center[0], y: view.center[1] }, zoom: view.zoom };

      // Get the cursor out of the shot first, so nothing under it highlights while zooming
      if (step.animate && step.park !== false) {
        const viewport = ctx.page.viewportSize();
        const exit = step.park ?? nearestExit(await cursorPos(ctx.page), viewport);
        await moveCursor(ctx.page, { x: exit[0], y: exit[1] }, step);
        // The page only sees pointer positions inside it, so Figma keeps hit-testing at the last
        // one as the camera moves. Leave the (invisible) real pointer where nothing is before or
        // after the move.
        const inside = {
          x: Math.min(Math.max(exit[0], 0), viewport.width),
          y: Math.min(Math.max(exit[1], 0), viewport.height),
        };
        const rest = await emptyCanvasPoint(ctx.page, inside, { after: target, edge: 4 });
        if (rest) await ctx.page.mouse.move(rest.x, rest.y);
      }
      await setView(ctx.page, target, step.animate, ctx.recorder);
    },

    /**
     * `{ stage: { keep: ["xl"] } }` empties a stage frame but for `keep`;
     * `{ stage: { remove: ["matrix"] } }` removes those layers from a stage page.
     */
    async stage(ctx, options) {
      const removed = await prepareStage(ctx.page, parseFileUrl(ctx.scenario.file).nodeId, options);
      if (removed.length) console.log(`      removed ${removed.join(", ")}`);
    },

    /** `cut: ms` keeps that much of the plugin's loading in the video and drops the rest. */
    async openPlugin(ctx, _, step) {
      const { name, ready } = ctx.scenario.plugin;
      await launchPlugin(ctx.page, name);
      await ctx.keepOnly(step.cut, async () => {
        ctx.frame = await pluginFrame(ctx.page, ready, 30_000);
      });
      return { waited: true };
    },
  },
};
