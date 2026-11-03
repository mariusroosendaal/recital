// The `macos` cursors, made on the Mac that records from its own cursors and kept in the cache:
// recital doesn't ship Apple's artwork. Each shape is HIServices' vector PDF, as an SVG with
// its page centred in 32×32 and macOS's shadow from the shape's info.plist.
//
// A PDF is a few overlapping filled paths, drawn in order; the SVG draws them the same way, on
// a white silhouette of them all that carries the shadow. The hands and the pointing hand are
// white with a black outline, as macOS shows them. The arrow isn't among the PDFs: macOS keeps
// it in the window server, as a bitmap (NSCursor.arrow). ARROW is that bitmap traced, a black
// polygon with rounded corners in a white outline.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { CACHE_DIR } from "./config.js";

const BASE =
  "/System/Library/Frameworks/ApplicationServices.framework/Versions/A/Frameworks/HIServices.framework/Versions/A/Resources/cursors";
const SIZE = 32;
// Raised when build() draws them differently, so a cache made by an older one is made again
const BUILD = 2;

const SHAPES = {
  pointer: ["pointinghand", {}],
  "hand-open": ["openhand", {}],
  "hand-closed": ["closedhand", {}],
  crosshair: ["cross", {}],
  move: ["move", {}],
  "resize-ew": ["resizeleftright", {}],
  "resize-ns": ["resizeupdown", {}],
  // The I-beam for vertical text, turned upright
  text: ["ibeamvertical", { rotate: true }],
};

// NSCursor.arrow, traced: its corners in pt of its 28×40 image, whose hotspot is (5, 5), each
// one's radius, and the outline's width. It takes the pointing hand's shadow.
const ARROW = {
  corners: [[4.981, 4.588], [5.01, 17.456], [7.987, 14.747], [10.279, 20.145], [12.133, 19.138], [9.965, 14.018], [14.263, 13.977]],
  radii: [0, 0.682, 0.26, 9, 0.981, 0.01, 0.646],
  outline: 1.003,
  hotspot: [5, 5],
};
const ARROW_HOTSPOT = [4, 4]; // where it goes in the SVG

const n = (v) => +v.toFixed(3);

/** The values of a flat info.plist: numbers and arrays of numbers */
function plist(file) {
  const xml = fs.readFileSync(file, "utf8");
  const out = {};
  for (const [, key, value] of xml.matchAll(/<key>(\w+)<\/key>\s*(<array>[\s\S]*?<\/array>|<(?:real|integer)>[^<]*<\/(?:real|integer)>)/g)) {
    const nums = [...value.matchAll(/<(?:real|integer)>([^<]*)</g)].map((m) => +m[1]);
    out[key] = value.startsWith("<array>") ? nums : nums[0];
  }
  return out;
}

/** The page's content stream and its size */
function content(pdf) {
  const data = fs.readFileSync(pdf).toString("latin1");
  const box = data.match(/\/MediaBox\s*\[([^\]]*)\]/)[1].trim().split(/\s+/).map(Number);
  const ref = data.match(/\/Contents (\d+) 0 R/)[1];
  const obj = data.match(new RegExp(`(?<!\\d)${ref} 0 obj\\s*<<([\\s\\S]*?)>>\\s*stream\\r?\\n([\\s\\S]*?)endstream`));
  const raw = Buffer.from(obj[2], "latin1");
  const stream = obj[1].includes("FlateDecode") ? zlib.inflateSync(raw) : raw;
  return { stream: stream.toString("latin1"), w: box[2] - box[0], h: box[3] - box[1] };
}

const multiply = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

/** The page's filled paths, in drawing order: `{ grey, d, evenodd }`, placed by place(x, y) */
function fills(stream, place, pdf) {
  const tokens = stream.match(/\/[^\s/[\]()<>]+|[-+]?\d*\.?\d+|[A-Za-z*]+/g);
  let ctm = [1, 0, 0, 1, 0, 0], grey = 0, args = [], d = "", current;
  const stack = [], out = [];
  const pt = (x, y) => place(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]).map(n).join(" ");
  for (const t of tokens) {
    if (/^[-+]?\d*\.?\d+$/.test(t) || t.startsWith("/")) {
      args.push(t.startsWith("/") ? t : +t);
      continue;
    }
    const a = args;
    args = [];
    if (t === "q") stack.push([ctm, grey]);
    else if (t === "Q") [ctm, grey] = stack.pop();
    else if (t === "cm") ctm = multiply(a, ctm);
    else if (t === "rg") grey = (a[0] + a[1] + a[2]) / 3;
    else if (t === "g") grey = a[0];
    else if (t === "m") (d += `M${pt(a[0], a[1])}`), (current = a);
    else if (t === "l") (d += `L${pt(a[0], a[1])}`), (current = a);
    else if (t === "c") (d += `C${pt(a[0], a[1])} ${pt(a[2], a[3])} ${pt(a[4], a[5])}`), (current = a.slice(4));
    else if (t === "v") (d += `C${pt(...current)} ${pt(a[0], a[1])} ${pt(a[2], a[3])}`), (current = a.slice(2));
    else if (t === "y") (d += `C${pt(a[0], a[1])} ${pt(a[2], a[3])} ${pt(a[2], a[3])}`), (current = a.slice(2));
    else if (t === "h") d += "Z";
    else if (t === "re") {
      const [x, y, w, h] = a;
      d += `M${pt(x, y)}L${pt(x + w, y)}L${pt(x + w, y + h)}L${pt(x, y + h)}Z`;
    } else if (["f", "F", "f*"].includes(t)) {
      out.push({ grey, d, evenodd: t === "f*" });
      d = "";
    } else if (t === "n") d = "";
    else if (!["W", "W*", "gs", "BDC", "BMC", "EMC"].includes(t)) throw new Error(`${pdf}: no support for the ${t} operator`);
  }
  return out;
}

/** ARROW's black polygon, placed so its hotspot is at ARROW_HOTSPOT */
function arrowPath() {
  const corners = ARROW.corners.map(([x, y]) => [x + ARROW_HOTSPOT[0] - ARROW.hotspot[0], y + ARROW_HOTSPOT[1] - ARROW.hotspot[1]]);
  const count = corners.length;
  let d = "";
  corners.forEach(([cx, cy], i) => {
    const [px, py] = corners[(i + count - 1) % count], [nx, ny] = corners[(i + 1) % count];
    let [ax, ay, bx, by] = [px - cx, py - cy, nx - cx, ny - cy];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    [ax, ay, bx, by] = [ax / la, ay / la, bx / lb, by / lb];
    const half = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by))) / 2;
    // Each rounding stops short of half the edges either side
    const t = Math.min(ARROW.radii[i] / Math.tan(half), 0.49 * la, 0.49 * lb);
    const start = [cx + ax * t, cy + ay * t], end = [cx + bx * t, cy + by * t];
    d += `${i ? "L" : "M"}${n(start[0])} ${n(start[1])}`;
    if (t > 0) {
      // A circular arc, as a cubic: its handles point at the corner
      const k = (4 / 3) * Math.tan((Math.PI - 2 * half) / 4) * t * Math.tan(half);
      d += `C${n(start[0] - ax * k)} ${n(start[1] - ay * k)} ${n(end[0] - bx * k)} ${n(end[1] - by * k)} ${n(end[0])} ${n(end[1])}`;
    }
  });
  return d + "Z";
}

function svg(silhouette, ink, [blur, dy, opacity]) {
  // macOS's shadow: CoreGraphics' blur is about twice the standard deviation, and its y is up
  const filter = `<defs><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">`
    + `<feDropShadow dx="0" dy="${-dy}" stdDeviation="${blur / 2}" flood-color="#000" flood-opacity="${opacity}"/></filter></defs>`;
  return `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" fill="none" xmlns="http://www.w3.org/2000/svg">\n${filter}\n`
    + `<g filter="url(#shadow)">${silhouette}</g>\n${ink}\n</svg>\n`;
}

const shadowOf = (info) => [info.blur ?? 0, info.shadowoffsety ?? 0, (info.shadowcolor ?? [0, 0, 0, 0.45])[3]];

function build(dir) {
  const hotspots = {};
  for (const [name, [cursor, opts]] of Object.entries(SHAPES)) {
    const pdf = path.join(BASE, cursor, "cursor.pdf");
    const info = plist(path.join(BASE, cursor, "info.plist"));
    const { stream, w, h } = content(pdf);
    let place;
    if (opts.rotate) {
      // A quarter turn clockwise: the page is h wide, w high; PDF y is up, turned it runs left to right
      const ox = Math.floor((SIZE - h) / 2), oy = Math.floor((SIZE - w) / 2);
      place = (x, y) => [ox + y, oy + x];
      hotspots[name] = [ox + h - info.hoty, oy + info.hotx];
    } else {
      const ox = Math.floor((SIZE - w) / 2), oy = Math.floor((SIZE - h) / 2);
      place = (x, y) => [ox + x, oy + h - y];
      hotspots[name] = [ox + info.hotx, oy + info.hoty];
    }
    const paths = fills(stream, place, pdf);
    const rule = (p) => (p.evenodd ? ' fill-rule="evenodd"' : "");
    const silhouette = paths.map((p) => `<path d="${p.d}"${rule(p)} fill="white"/>`).join("");
    const ink = paths.map((p) => `<path d="${p.d}"${rule(p)} fill="${p.grey < 0.5 ? "black" : "white"}"/>`).join("");
    fs.writeFileSync(path.join(dir, `${name}.svg`), svg(silhouette, ink, shadowOf(info)));
  }
  const d = arrowPath();
  const outline = `<path d="${d}" fill="white" stroke="white" stroke-width="${2 * ARROW.outline}" stroke-linejoin="round"/>`;
  const shadow = shadowOf(plist(path.join(BASE, "pointinghand", "info.plist")));
  fs.writeFileSync(path.join(dir, "arrow.svg"), svg(outline, `<path d="${d}" fill="black"/>`, shadow));
  hotspots.arrow = ARROW_HOTSPOT;
  fs.writeFileSync(path.join(dir, "hotspots.json"), JSON.stringify(hotspots, null, 2) + "\n");
}

/** The folder of this Mac's cursors as SVGs, with hotspots.json; made on first use. Null off macOS. */
export function macCursors() {
  if (process.platform !== "darwin" || !fs.existsSync(BASE)) return null;
  // Per macOS release, so an update that redraws them is picked up, and per BUILD
  const dir = path.join(CACHE_DIR, "cursors", `macos-${os.release()}-build${BUILD}`);
  if (!fs.existsSync(path.join(dir, "hotspots.json"))) {
    fs.mkdirSync(dir, { recursive: true });
    // Cursors a macOS update draws in a way this can't read: the take uses the minimal set
    try {
      build(dir);
    } catch (error) {
      console.warn(`Couldn't make this Mac's cursors (${error.message}): using the minimal ones`);
      fs.rmSync(dir, { recursive: true, force: true });
      return null;
    }
  }
  return dir;
}
