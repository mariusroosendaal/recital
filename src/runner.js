// Runs scenario steps. A step is `{ <action>: <target or value>, ...options }`.
//
// Targets:
//   { ui: "[aria-label='Width']" }              a page element
//   { point: [x, y] }                           CSS px, escape hatch
// An adapter adds its own (src/adapters.js), such as Figma's `plugin` (an element in the
// plugin iframe) and `canvas` (a layer under the stage, by name path).
// `at` is a fraction of the target's box (default centre); `offset` adds CSS px;
// `cursor` overrides the cursor shape, which otherwise follows the element's CSS cursor;
// `frame` is an iframe's selector, and the target is looked up in that iframe.
//
// Options on any step: hold (ms after the screen settles), speed, ms (move time),
// waitFor (a target that must be visible before the hold), cut (with waitFor: ms of the
// wait to keep in the video), when / unless (a target that must / must not be visible for
// the step to run at all), label.

import { cursorFor } from "./cursor.js";
import { clickAt, cursorPos, moveCursor, sleep } from "./motion.js";
import { closest } from "./similar.js";

// ms to hold after each kind of step, once the screen has settled; an adapter adds its own
const HOLD = { tab: 300, wheel: 500, drag: 0, chooseFiles: 500, click: 350, check: 350, type: 500, paste: 500, press: 400, scroll: 500, move: 0 };

// Seconds between one narration line and the next
const NARRATION_GAP = 0.4;

/**
 * `adapter` (src/adapters.js) adds its targets, actions and context, such as Figma's
 * `ctx.plugin()` and `ctx.layer()`.
 */
export function createContext({ page, scenario, recorder, adapter = null }) {
  // `tabs`: the scenario's other tabs once opened, by name; "main" is the one it starts in
  const ctx = { page, tabs: { main: page }, scenario, recorder, adapter, log: [] };
  ctx.keepOnly = (cut, wait) => keepOnly(ctx, cut, wait);
  adapter?.extend?.(ctx);
  return ctx;
}

/**
 * The frame a target's selector is looked up in, and the selector: `ui` in the page, or an
 * adapter's in its frame; with `frame`, in that iframe of either.
 */
async function scope(ctx, target) {
  const key = Object.keys(ctx.adapter?.frames ?? {}).find((k) => k in target);
  let root = key ? await ctx.adapter.frames[key](ctx) : ctx.page;
  if (target.frame) {
    const iframe = await root.locator(target.frame).first().elementHandle({ timeout: 10_000 });
    root = await iframe.contentFrame();
    if (!root) throw new Error(`Not an iframe: ${target.frame}`);
  }
  return { root, selector: key ? target[key] : target.ui };
}

async function locate(ctx, target) {
  const { root, selector } = await scope(ctx, target);
  if (!selector) throw new Error(`Not a locatable target: ${JSON.stringify(target)}`);
  return root.locator(selector).first();
}

/**
 * The element, or for a visually hidden one (a styled checkbox input) its label, else its
 * nearest visible ancestor. `root` is the frame the element lives in.
 */
async function visible(locator, root) {
  await locator.waitFor({ state: "attached", timeout: 10_000 });
  if (await locator.isVisible()) return locator;
  const id = await locator.evaluate((el) => (el.labels?.length ? el.id : null));
  if (id) {
    const label = root.locator(`label[for="${id.replace(/["\\]/g, "\\$&")}"]`).first();
    if (await label.isVisible()) return label;
    const wrapping = locator.locator("xpath=ancestor::label[1]");
    if (await wrapping.isVisible().catch(() => false)) return wrapping;
  }
  let current = locator;
  for (let i = 0; i < 4; i++) {
    if (await current.isVisible()) return current;
    current = current.locator("xpath=..");
  }
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  return locator;
}

async function resolvePoint(ctx, target) {
  const [fx, fy] = target.at ?? [0.5, 0.5];
  const [ox, oy] = target.offset ?? [0, 0];
  if (target.point) return { x: target.point[0] + ox, y: target.point[1] + oy };

  let box;
  let cursor = "arrow";
  // An adapter's target with a box of its own, such as a Figma layer on the canvas
  const boxed = Object.keys(ctx.adapter?.boxes ?? {}).find((k) => k in target);
  if (boxed) {
    box = await ctx.adapter.boxes[boxed](ctx, target);
  } else {
    const { root } = await scope(ctx, target);
    const locator = await visible(await locate(ctx, target), root);
    box = await locator.boundingBox();
    cursor = cursorFor(await locator.evaluate((el) => getComputedStyle(el).cursor));
  }
  return {
    x: box.x + box.width * fx + ox,
    y: box.y + box.height * fy + oy,
    box,
    cursor: target.cursor ?? cursor,
  };
}

const actions = {
  async move(ctx, target, step) {
    await moveCursor(ctx.page, await resolvePoint(ctx, target), step);
  },

  async click(ctx, target, step) {
    await clickAt(ctx.page, await resolvePoint(ctx, target), step);
  },

  /** `{ drag: target, to: target }` or `{ drag: target, by: [dx, dy] }` */
  async drag(ctx, target, step) {
    const from = await resolvePoint(ctx, target);
    await moveCursor(ctx.page, from, step);
    await sleep(120);
    await ctx.page.evaluate(() => window.__demoCursor.down());
    await ctx.page.mouse.down();
    const to = step.to
      ? await resolvePoint(ctx, step.to)
      : { x: from.x + step.by[0], y: from.y + step.by[1], cursor: from.cursor };
    await moveCursor(ctx.page, { ...to, cursor: from.cursor }, step);
    await sleep(80);
    await ctx.page.mouse.up();
    await ctx.page.evaluate(() => window.__demoCursor.up());
  },

  /** Click a checkbox only if it isn't already in the wanted state (`value`, default true). */
  async check(ctx, target, step) {
    const wanted = step.value ?? true;
    if ((await (await locate(ctx, target)).isChecked()) === wanted) return false;
    await clickAt(ctx.page, await resolvePoint(ctx, target), step);
  },

  /** `{ chooseFiles: target, files: [paths] }` clicks a file picker and answers its dialog. */
  async chooseFiles(ctx, target, step) {
    const chooser = ctx.page.waitForEvent("filechooser");
    await clickAt(ctx.page, await resolvePoint(ctx, target), step);
    await (await chooser).setFiles(step.files);
  },

  /**
   * `{ wheel: target, by: px }` scrolls whatever is under the target, as a trackpad does:
   * an inner scroll area, where `scroll` moves the page. `scrollMs` is how long it takes.
   */
  async wheel(ctx, target, step) {
    const to = await resolvePoint(ctx, target);
    await moveCursor(ctx.page, to, step);
    await ctx.page.mouse.move(to.x, to.y);
    const by = step.by ?? 600;
    const ms = (step.scrollMs ?? 1500) / (step.speed ?? 1);
    // A wheel event a frame, eased in and out, so the scroll glides rather than jumps
    const frames = Math.max(1, Math.round(ms / 16));
    const ease = (t) => (1 - Math.cos(Math.PI * t)) / 2;
    const startedAt = Date.now();
    let done = 0;
    for (let i = 1; i <= frames; i++) {
      const next = Math.round(by * ease(i / frames));
      if (next !== done) await ctx.page.mouse.wheel(0, next - done);
      done = next;
      await sleep(Math.max(0, startedAt + (ms * i) / frames - Date.now()));
    }
  },

  /**
   * `{ tab: "huetone" }` brings a tab to the front and carries on there: one of the
   * scenario's `tabs` (name: URL, opened the first time) or "main", the one it starts in.
   * The recording follows.
   */
  async tab(ctx, name) {
    let page = ctx.tabs[name];
    if (!page) {
      page = await ctx.page.context().newPage();
      await page.emulateMedia({ colorScheme: ctx.scenario.theme ?? "light" });
      await page.goto(ctx.scenario.tabs[name], { waitUntil: "load", timeout: 60_000 });
      ctx.tabs[name] = page;
    }
    // The cursor stays where it was, not where it last was in this tab
    const { x, y } = await cursorPos(ctx.page);
    await page.evaluate(([cx, cy]) => window.__demoCursor.set(cx, cy), [x, y]);
    await page.bringToFront();
    // A tab brought to the front lays itself out again for a frame or two; the video stays on
    // the last tab until it has
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await sleep(250);
    ctx.page = page;
    // The step starts when the tab shows, for the camera's cut
    if (ctx.recorder) return { start: await ctx.recorder.follow(page) };
  },

  /** `{ paste: text, into: target }` puts the text in at once, as pasting does. */
  async paste(ctx, text, step) {
    if (step.into) await clickAt(ctx.page, await resolvePoint(ctx, step.into), step);
    await ctx.page.keyboard.insertText(text);
  },

  async type(ctx, text, step) {
    if (step.into) await clickAt(ctx.page, await resolvePoint(ctx, step.into), step);
    if (step.clear) {
      await ctx.page.keyboard.press("ControlOrMeta+A");
      await ctx.page.keyboard.press("Backspace");
    }
    await ctx.page.keyboard.type(text, { delay: step.delay ?? 75 });
  },

  /** `in` names a place the adapter focuses first, e.g. Figma's `"editor"` (its canvas). */
  async press(ctx, keys, step) {
    if (step.in) {
      const focus = ctx.adapter?.focus?.[step.in];
      if (!focus) throw new Error(`No place "${step.in}" to send keys to`);
      await focus(ctx);
    }
    for (const key of [keys].flat()) {
      await ctx.page.keyboard.press(key);
      await sleep(60);
    }
  },

  async hold(ctx, ms) {
    await sleep(ms);
  },

  /** `state: "hidden"` waits for the target to go instead, e.g. a toast */
  async waitFor(ctx, target, step) {
    await (await locate(ctx, target)).waitFor({ state: step?.state ?? "visible", timeout: step?.timeout ?? 30_000 });
  },

  /**
   * `{ scroll: { ui: "a.cta" }, to: 0.6 }` scrolls until the target's centre is 60% of the way
   * down the viewport (default 0.5); `{ scroll: 800 }` scrolls by CSS px and
   * `{ scroll: { top: 7000 } }` to that scroll position (for pinned, scroll-driven sections
   * where the element only shows at some point). `top` can list stops to pass through in one
   * continuous scroll. It goes like a person on a trackpad: flicks of about `flick` px
   * (default 1100), or exactly `flicks` of them (per stop, when a list), that coast to a stop,
   * with `pause` ms between (default 400).
   */
  async scroll(ctx, target, step) {
    const from = await ctx.page.evaluate(() => scrollY);
    let stops;
    if (target.top != null) {
      stops = [target.top].flat();
    } else if (typeof target === "number") {
      stops = [from + target];
    } else {
      const box = await (await visible(await locate(ctx, target), ctx.page)).boundingBox();
      stops = [from + box.y + box.height / 2 - ctx.page.viewportSize().height * (step.to ?? 0.5)];
    }
    const counts = [step.flicks].flat();
    let at = from;
    const flicks = stops.flatMap((stop, i) => {
      const leg = planFlicks(at, stop, { ...step, flicks: counts[i] ?? counts.at(-1) });
      at = stop;
      return leg;
    });
    await ctx.page.evaluate(scrollFlicks, flicks);
  },

  /** Run a function in the page (in Figma, its plugin API is there as `figma`). */
  async eval(ctx, fn, step) {
    return ctx.page.evaluate(fn, step.arg);
  },

  async cursor(ctx, [x, y]) {
    await ctx.page.evaluate(([cx, cy]) => window.__demoCursor.set(cx, cy), [x, y]);
    await ctx.page.mouse.move(x, y);
  },
};

/**
 * Splits a scroll from `from` to `to` into flicks: `{ to, ms, pause }`. Sizes vary but the
 * same distance always gives the same plan, so takes are repeatable.
 */
function planFlicks(from, to, { flick = 1100, flicks, pause = 400, speed = 1 } = {}) {
  const distance = Math.abs(to - from);
  let seed = Math.round(distance) || 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const count = flicks ?? Math.max(1, Math.round(distance / flick));
  const weights = Array.from({ length: count }, () => 0.75 + random() * 0.5);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let done = 0;
  return weights.map((w, i) => {
    done += w;
    const px = (distance * w) / total;
    return {
      to: i === count - 1 ? to : from + ((to - from) * done) / total,
      ms: Math.round((900 + 0.55 * px) / speed),
      pause: Math.round(pause / speed),
    };
  });
}

/** In the page: plays the flicks; each starts fast and coasts out slowly, like trackpad momentum. */
function scrollFlicks(flicks) {
  const coast = (t) => 1 - Math.pow(1 - t, 5);
  const max = document.documentElement.scrollHeight - innerHeight;
  const flick = (to, ms) =>
    new Promise((resolve) => {
      const from = scrollY;
      to = Math.max(0, Math.min(to, max));
      // From the first frame's time: performance.now() can be later than it, and a negative t
      // would scroll back first
      let start;
      function frame(now) {
        start ??= now;
        const t = Math.min(1, (now - start) / ms);
        scrollTo(scrollX, from + (to - from) * coast(t));
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  return flicks.reduce(
    (done, { to, ms, pause }, i) =>
      done.then(() => flick(to, ms)).then(() => i < flicks.length - 1 && new Promise((r) => setTimeout(r, pause))),
    Promise.resolve(),
  );
}

/** Runs a wait; with `cut` (ms) only its first `cut` ms stay in the recording. */
async function keepOnly(ctx, cut, wait) {
  if (cut == null || !ctx.recorder) return wait();
  await sleep(cut);
  ctx.recorder.pause();
  try {
    await wait();
    await sleep(150);
  } finally {
    ctx.recorder.resume();
  }
}

/**
 * A step at the scenario's `speed`: moves, camera moves and holds that much faster; and its
 * `pauses`, which scales the holds alone (0.5 halves them).
 */
function paced(step, action, pace, pauses, holds) {
  if (pace === 1 && pauses === 1) return step;
  const faster = (ms) => (typeof ms === "number" ? ms / pace : ms);
  const hold = faster(step.hold ?? (action === "hold" ? undefined : holds[action]));
  return {
    ...step,
    speed: (step.speed ?? 1) * pace,
    ms: faster(step.ms),
    animate: faster(step.animate),
    hold: typeof hold === "number" ? hold * pauses : hold,
  };
}

/** A step's label: its own, else the action and its value. */
export const stepLabel = (step, action) => step.label ?? `${action} ${describe(step[action])}`;

/** The step actions a scenario can use, with its adapter's. */
export const actionNames = (adapter) => [...Object.keys(actions), ...Object.keys(adapter?.actions ?? {})];

export async function runSteps(ctx, steps) {
  const pace = ctx.scenario.speed ?? 1;
  const pauses = ctx.scenario.pauses ?? 1;
  const all = { ...actions, ...ctx.adapter?.actions };
  const holds = { ...HOLD, ...ctx.adapter?.holds };
  for (const [index, original] of steps.entries()) {
    const action = Object.keys(original).find((key) => key in all);
    const step = action ? paced(original, action, pace, pauses, holds) : original;
    if (!action) throw new Error(`Step ${index + 1} has no known action: ${JSON.stringify(step)}`);
    // A step with a narration line starts once the line before has been spoken
    const line = ctx.narration?.find((l) => l.at === original.label);
    if (line && ctx.recorder) await sleep(Math.max(0, (ctx.narrationEnd ?? 0) - ctx.recorder.elapsed()) * 1000);
    const startedAt = ctx.recorder?.elapsed();
    const label = stepLabel(step, action);

    // A step that doesn't run is logged where it was passed, so a camera framing on it still
    // has a time; its line isn't spoken (narrate leaves it out) and nothing waits for it
    const absent =
      (step.when && !(await (await locate(ctx, step.when)).isVisible()) && `${describe(step.when)} not visible`) ||
      (step.unless && (await (await locate(ctx, step.unless)).isVisible()) && `${describe(step.unless)} visible`);
    if (absent) {
      ctx.log.push({ step: index + 1, label, start: startedAt, end: startedAt, skipped: true, absent: true });
      console.log(`  ${String(index + 1).padStart(2)}. ${label} (skipped: ${absent})`);
      continue;
    }
    if (line && ctx.recorder) ctx.narrationEnd = startedAt + line.duration + NARRATION_GAP + (line.pause ?? 0);

    let result;
    try {
      result = await all[action](ctx, step[action], step);
    } catch (error) {
      error.message = `Step ${index + 1} (${label}): ${error.message}`;
      if (error.name === "TimeoutError") error.message += await nearMatches(ctx, step, action).catch(() => "");
      throw error;
    }

    const skipped = result === false;
    // An action that waits itself (`waited`, as openPlugin does) has used `waitFor` and `cut`
    if (!skipped && step.waitFor && !result?.waited) {
      // `cut: ms` keeps that much of the wait in the video and drops the rest
      await keepOnly(ctx, step.cut, () => actions.waitFor(ctx, step.waitFor, step));
    }
    if (!skipped && action in holds) {
      if (ctx.recorder && step.settle !== false) await ctx.recorder.settle();
      await sleep(step.hold ?? holds[action]);
    }

    ctx.log.push({ step: index + 1, label, start: result?.start ?? startedAt, end: ctx.recorder?.elapsed(), skipped, ...(step.dissolve && { dissolve: step.dissolve, through: step.through }) });
    console.log(`  ${String(index + 1).padStart(2)}. ${label}${skipped ? " (already set)" : ""}`);
  }
}

/**
 * For a step that timed out finding its target: the elements on screen whose names are close
 * to the one in its selector, e.g. a label the plugin renamed.
 */
async function nearMatches(ctx, step, action) {
  const target = [step[action], step.into, step.waitFor].find((t) => t && typeof t === "object" && !Array.isArray(t));
  if (!target) return "";
  const { root, selector } = await scope(ctx, target);
  const wanted = [...(selector ?? "").matchAll(/['"]([^'"]{2,})['"]/g)].map((m) => m[1]);
  if (!wanted.length) return "";
  const names = await root.evaluate(() =>
    [...document.querySelectorAll("button, a, input, select, textarea, label, [role], [aria-label], [data-tooltip]")]
      .filter((el) => el.getClientRects().length)
      .map((el) => el.getAttribute("aria-label") ?? el.getAttribute("data-tooltip") ?? el.innerText?.trim().split("\n")[0] ?? "")
      .filter((name) => name && name.length < 80),
  );
  const near = wanted.flatMap((w) => closest(w, new Set(names), { limit: 5, slack: 3 }));
  return near.length ? `\n  On screen, close to ${wanted.map((w) => `"${w}"`).join(", ")}: ${near.map((n) => `"${n}"`).join(", ")}` : "";
}

function describe(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ");
  }
  return typeof value === "function" ? "fn" : JSON.stringify(value);
}
