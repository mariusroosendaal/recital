// Makes assets/cursors/minimal: our own cursors, drawn here, in the manner of macOS's (black,
// a thin white outline, a soft shadow, rounded corners) but not traced from them.
//
// A shape is a list of parts on a 32×32 grid: `line` (a stroke of width `w`, round caps), `path`
// (the same, along an SVG path) or `poly` (a filled polygon, its corners rounded by `r`). Every
// part is drawn in white, one outline width larger, before any is drawn in black, so parts that
// touch merge without a seam.
//
//   node scripts/minimal-cursors.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "cursors", "minimal");
const OUTLINE = 1.1;
const INK = "#111";

/** A closed path through `points`, each corner rounded by `r` (one radius, or one per point) */
function rounded(points, r) {
  const n = points.length;
  const radius = (i) => (Array.isArray(r) ? r[i] : r);
  const toward = ([x, y], [tx, ty], d) => {
    const len = Math.hypot(tx - x, ty - y);
    return [x + ((tx - x) * d) / len, y + ((ty - y) * d) / len];
  };
  const f = (p) => p.map((v) => +v.toFixed(3)).join(" ");
  let d = "";
  points.forEach((p, i) => {
    const a = toward(p, points[(i + n - 1) % n], radius(i));
    const b = toward(p, points[(i + 1) % n], radius(i));
    d += `${i ? "L" : "M"}${f(a)} Q${f(p)} ${f(b)} `;
  });
  return d + "Z";
}

const rect = (x1, y1, x2, y2, [tl, tr, br, bl]) =>
  ({ poly: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], r: [tl, tr, br, bl] });
// A filled arrowhead pointing at (x, y) along `angle` degrees: `len` long, `width` across
function head(x, y, angle, len = 3.6, width = 6.4) {
  const a = (angle * Math.PI) / 180;
  const [dx, dy, nx, ny] = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)];
  const bx = x - dx * len, by = y - dy * len;
  return { poly: [[x, y], [bx + (nx * width) / 2, by + (ny * width) / 2], [bx - (nx * width) / 2, by - (ny * width) / 2]], r: 0.6 };
}
const arrows = (heads, shaft) => [{ path: shaft, w: 1.6 }, ...heads.map((h) => head(...h))];

const SHAPES = {
  arrow: [{
    poly: [[4, 3.6], [4, 16.2], [7.3, 13.4], [9.6, 18.7], [11.7, 17.8], [9.5, 12.7], [13.4, 12.6]],
    r: [0.9, 1, 0.5, 1, 1, 0.4, 0.9],
  }],
  pointer: [
    rect(12.4, 15.6, 23, 25, [1.5, 2, 4.8, 4.2]),
    { line: [13.9, 8.5, 13.9, 17], w: 3 },
    { line: [16.9, 13.6, 16.9, 17], w: 2.8 },
    { line: [19.5, 14.4, 19.5, 17.5], w: 2.6 },
    { line: [21.8, 15.6, 21.8, 18.5], w: 2.3 },
    { line: [9.6, 15.6, 12.6, 20.4], w: 2.8 },
  ],
  "hand-open": [
    rect(11.2, 15.5, 22.6, 25.5, [2, 2, 4.8, 4.5]),
    { line: [12.8, 16.5, 12.2, 8.8], w: 2.7 },
    { line: [15.6, 16, 15.6, 6.8], w: 2.8 },
    { line: [18.4, 16, 18.9, 7.8], w: 2.7 },
    { line: [21.1, 17, 22.1, 10.6], w: 2.4 },
    { line: [11.6, 20.5, 8, 15.6], w: 2.8 },
  ],
  "hand-closed": [
    rect(11, 14.5, 22.6, 24.5, [2, 2, 4.8, 4.5]),
    { line: [12.7, 13.6, 12.7, 15.5], w: 2.6 },
    { line: [15.6, 12.9, 15.6, 15.5], w: 2.7 },
    { line: [18.5, 13.1, 18.5, 15.5], w: 2.7 },
    { line: [21.1, 14.2, 21.1, 16], w: 2.4 },
    { line: [9.6, 17.2, 12, 19.6], w: 2.6 },
  ],
  text: [{ path: "M12.8 7.5 Q16 7.2 16 9.8 Q16 7.2 19.2 7.5 M16 9.8 V22.2 M12.8 24.5 Q16 24.8 16 22.2 Q16 24.8 19.2 24.5", w: 1.3 }],
  crosshair: [{ path: "M16 8 V24 M8 16 H24", w: 1.4 }],
  move: arrows([[16, 6.2, -90], [16, 25.8, 90], [6.2, 16, 180], [25.8, 16, 0]], "M16 9 V23 M9 16 H23"),
  "resize-ew": arrows([[6, 16, 180], [26, 16, 0]], "M9 16 H23"),
  "resize-ns": arrows([[16, 6, -90], [16, 26, 90]], "M16 9 V23"),
};

function svg(parts) {
  const draw = (colour, extra) =>
    parts.map((p) => {
      if (p.poly) {
        const stroke = extra ? ` stroke="${colour}" stroke-width="${extra}" stroke-linejoin="round"` : "";
        return `<path d="${rounded(p.poly, p.r)}" fill="${colour}"${stroke}/>`;
      }
      const d = p.path ?? `M${p.line.slice(0, 2).join(" ")} L${p.line.slice(2).join(" ")}`;
      return `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${+(p.w + extra).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join("");
  return `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">`
    + `<defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.4"/></filter></defs>`
    + `<g filter="url(#s)">${draw("#fff", OUTLINE * 2)}</g>${draw(INK, 0)}</svg>\n`;
}

for (const [name, parts] of Object.entries(SHAPES)) fs.writeFileSync(path.join(OUT, `${name}.svg`), svg(parts));
console.log(`Wrote ${Object.keys(SHAPES).length} cursors to ${path.relative(process.cwd(), OUT)}`);
