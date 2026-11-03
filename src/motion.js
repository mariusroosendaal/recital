// Cursor movement and clicks. Timing comes from distance, not from the scenario.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Where the drawn cursor is. */
export const cursorPos = (page) => page.evaluate(() => window.__demoCursor.pos());

/** Just past the edge of the `viewport` ({ width, height }) nearest to `p`. */
export function nearestExit(p, { width, height }, overshoot = 40) {
  const exits = [
    { d: p.x, to: [-overshoot, p.y] },
    { d: width - p.x, to: [width + overshoot, p.y] },
    { d: p.y, to: [p.x, -overshoot] },
    { d: height - p.y, to: [p.x, height + overshoot] },
  ];
  return exits.sort((a, b) => a.d - b.d)[0].to;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// Keep in sync with curvePoint() in cursor.js
function curvePoint(a, b, t) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const bend = 0.08;
  const c = { x: (a.x + b.x) / 2 - dy * bend, y: (a.y + b.y) / 2 + dx * bend };
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

/** Fitts-like: long moves take longer, but not proportionally. */
export function moveDuration(distance, speed = 1) {
  const ms = 280 + 170 * Math.log2(1 + distance / 50);
  return Math.round(Math.min(1250, ms) / speed);
}

const inside = (box, p) =>
  box && p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;

// The element the cursor is over, so its shape changes on the way out and in
let current = { box: null, cursor: "arrow" };

const setCursor = (page, name) => page.evaluate((n) => window.__demoCursor.type(n), name);

/** `to` may carry `box` and `cursor`: the target's bounds and the cursor shape over it. */
export async function moveCursor(page, to, { ms, speed } = {}) {
  const from = await page.evaluate(() => window.__demoCursor.pos());
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const target = { box: to.box ?? null, cursor: to.cursor ?? "arrow" };
  if (distance < 1) {
    if (target.cursor !== current.cursor) await setCursor(page, target.cursor);
    current = target;
    return;
  }
  const duration = ms ?? moveDuration(distance, speed);

  const animation = page.evaluate(
    ([x, y, d]) => window.__demoCursor.move(x, y, d),
    [to.x, to.y, duration],
  );
  // Drive the real pointer along the same curve so hover states follow the fake one
  let shape = current.cursor;
  const start = Date.now();
  for (;;) {
    const t = Math.min(1, (Date.now() - start) / duration);
    const p = curvePoint(from, to, ease(t));
    await page.mouse.move(p.x, p.y);
    const over = inside(target.box, p) || t >= 1 ? target : inside(current.box, p) ? current : { box: null, cursor: "arrow" };
    if (over.cursor !== shape) await setCursor(page, (shape = over.cursor));
    if (t >= 1) break;
    await sleep(20);
  }
  const stats = await animation;
  if (process.env.DEMO_DEBUG) {
    console.log(`      move ${Math.round(distance)}px ${duration}ms: ${Math.round((stats.frames / stats.ms) * 1000)} fps`);
  }
  current = target;
}

export async function clickAt(page, to, options = {}) {
  await moveCursor(page, to, options);
  await sleep(options.pause ?? 90);
  // `modifiers: ["Shift"]` holds keys through the click, e.g. to add to a selection
  for (const key of options.modifiers ?? []) await page.keyboard.down(key);
  await page.evaluate(() => window.__demoCursor.down());
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  for (const key of options.modifiers ?? []) await page.keyboard.up(key);
  // A link click may have navigated away already; the new page's cursor isn't pressed
  await page.evaluate(() => window.__demoCursor.up()).catch(() => {});
}
