// The fake cursor lives in the top page as a DOM overlay, so the screencast captures it.
// The page animates it; Node drives the real pointer along the same curve (see motion.js).
//
// Cursor sets, picked with a scenario's `cursors`, else its adapter's, else macos:
//   macos        this Mac's own, made from its cursor PDFs on first use (macos-cursors.js); minimal elsewhere
//   figma        Figma's own cursors, from its UI3 kit: the black arrow, its hands, I-beam and the rest
//                (the Figma adapter's)
//   macos-large  the same, half as big again, as macOS's larger pointer sizes
//   minimal      our own, in macOS's manner: black, a thin white outline, a soft shadow
//   dot          a soft dot, a little larger over something clickable
// A shape a set doesn't have falls back to its arrow.

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";
import { macCursors } from "./macos-cursors.js";

export const DEFAULT_CURSORS = "macos";

// Hotspots, in px of each 32×32 image
const centre = [16, 16];
const SVG_SETS = {
  // Figma's own (the UI3 kit's Cursors page)
  figma: {
    arrow: [3.4, 3.4],
    pointer: [14.8, 7],
    text: centre,
    crosshair: centre,
    move: centre,
    "resize-ew": [16, 15.5],
    "resize-ns": [16.5, 16],
    "hand-open": [16, 16.5],
    "hand-closed": [17, 16.5],
  },
  // Ours (scripts/minimal-cursors.js)
  minimal: {
    arrow: [4.2, 4],
    pointer: [13.9, 7.2],
    text: centre,
    crosshair: centre,
    move: centre,
    "resize-ew": centre,
    "resize-ns": centre,
    "hand-open": [16.5, 17],
    "hand-closed": [16.5, 18],
  },
  dot: { arrow: centre, pointer: centre },
};
// Sets drawn from another's images, larger
const SCALED = { "macos-large": { from: "macos", scale: 1.5 } };
export const CURSOR_SETS = [...Object.keys(SVG_SETS), "macos", ...Object.keys(SCALED)];

/** Maps a CSS `cursor` value to one of ours. */
export function cursorFor(css) {
  if (/pointer/.test(css)) return "pointer";
  if (/text/.test(css)) return "text";
  if (/grabbing/.test(css)) return "hand-closed";
  if (/grab/.test(css)) return "hand-open";
  if (/crosshair/.test(css)) return "crosshair";
  if (/move|all-scroll/.test(css)) return "move";
  if (/(^|\b)(ns|n|s|row)-resize/.test(css)) return "resize-ns";
  if (/resize/.test(css)) return "resize-ew";
  return "arrow";
}

const dataUrl = (file) => `data:image/svg+xml;base64,${fs.readFileSync(file).toString("base64")}`;

/** A set's images, for the page: `{ shape: { src, hotspot, size } }`, in CSS px */
export function cursorAssets(chosen) {
  const set = chosen ?? DEFAULT_CURSORS;
  const { from = set, scale = 1 } = SCALED[set] ?? {};
  let dir = path.join(ROOT, "assets/cursors", from);
  let shapes = SVG_SETS[from];
  if (from === "macos") {
    const mac = macCursors();
    if (mac) {
      dir = mac;
      shapes = JSON.parse(fs.readFileSync(path.join(mac, "hotspots.json"), "utf8"));
    } else {
      // Said only when asked for: by default, minimal is what other systems get
      if (chosen) console.warn(`The ${set} cursors are made from a Mac's own; using minimal instead`);
      [dir, shapes] = [path.join(ROOT, "assets/cursors/minimal"), SVG_SETS.minimal];
    }
  }
  if (!shapes) throw new Error(`No cursor set "${set}"; there are ${CURSOR_SETS.join(", ")}`);
  return Object.fromEntries(
    Object.entries(shapes).map(([name, entry]) => {
      const { file = name, hotspot } = Array.isArray(entry) ? { hotspot: entry } : entry;
      const src = dataUrl(path.join(dir, `${file}.svg`));
      return [name, { src, size: [32 * scale, 32 * scale], hotspot: hotspot.map((v) => v * scale) }];
    }),
  );
}

export function cursorScript(assets) {
  if (window.top !== window) return;

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // Keep in sync with curvePoint() in motion.js
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

  // Carried over from the previous page when a click navigates, so the cursor doesn't jump
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem("__demoCursor"));
    sessionStorage.removeItem("__demoCursor");
  } catch {}
  let pos = saved?.pos ?? { x: window.innerWidth / 2, y: window.innerHeight * 0.6 };
  let type = saved?.type ?? "arrow";
  window.addEventListener("pagehide", () => {
    try {
      sessionStorage.setItem("__demoCursor", JSON.stringify({ pos, type }));
    } catch {}
  });
  let root;
  let pointer;

  function install() {
    if (document.getElementById("__demo-cursor")) return;
    root = document.createElement("div");
    root.id = "__demo-cursor";
    root.innerHTML = `
      <style>
        #__demo-cursor { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
        #__demo-cursor .pointer { position: absolute; left: 0; top: 0; transition: scale 90ms ease-out; }
        #__demo-cursor .pointer.down { scale: 0.9; }
        /* max-width: a site's CSS reset (img { max-width: 100% }) would shrink it to the 0-wide .pointer */
        #__demo-cursor .pointer img { position: absolute; display: none; max-width: none; max-height: none; }
        #__demo-cursor .pointer img.on { display: block; }
        #__demo-cursor .ripple {
          position: absolute; width: 36px; height: 36px; margin: -18px 0 0 -18px;
          border-radius: 50%; background: rgba(13, 153, 255, 0.4);
          border: 1.5px solid rgba(255, 255, 255, 0.7);
          animation: __demo-ripple 520ms cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
        }
        @keyframes __demo-ripple {
          from { transform: scale(0.25); opacity: 1; }
          to { transform: scale(1.3); opacity: 0; }
        }
      </style>
      <div class="pointer"></div>`;
    pointer = root.querySelector(".pointer");
    for (const [name, { src, hotspot, size }] of Object.entries(assets)) {
      const img = document.createElement("img");
      img.src = src;
      img.dataset.name = name;
      img.style.left = `${-hotspot[0]}px`;
      img.style.top = `${-hotspot[1]}px`;
      img.style.width = `${size[0]}px`;
      img.style.height = `${size[1]}px`;
      pointer.appendChild(img);
    }
    document.documentElement.appendChild(root);
    setType(type);
    place();
  }

  function place() {
    if (pointer) pointer.style.translate = `${pos.x}px ${pos.y}px`;
  }

  function setType(name) {
    type = assets[name] ? name : "arrow";
    for (const img of pointer?.children ?? []) img.classList.toggle("on", img.dataset.name === type);
  }

  window.__demoCursor = {
    pos: () => ({ ...pos }),
    set(x, y) {
      install();
      pos = { x, y };
      place();
    },
    type(name) {
      install();
      setType(name);
    },
    show(visible = true) {
      install();
      root.style.display = visible ? "" : "none";
    },
    move(x, y, ms) {
      install();
      const from = { ...pos };
      const to = { x, y };
      const start = performance.now();
      let frames = 0;
      return new Promise((resolve) => {
        function frame(now) {
          frames++;
          const t = Math.min(1, (now - start) / ms);
          pos = curvePoint(from, to, ease(t));
          place();
          if (t < 1) requestAnimationFrame(frame);
          else resolve({ frames, ms: performance.now() - start });
        }
        requestAnimationFrame(frame);
      });
    },
    down() {
      install();
      pointer.classList.add("down");
      const ripple = document.createElement("div");
      ripple.className = "ripple";
      ripple.style.left = `${pos.x}px`;
      ripple.style.top = `${pos.y}px`;
      root.insertBefore(ripple, pointer);
      setTimeout(() => ripple.remove(), 600);
    },
    up() {
      pointer?.classList.remove("down");
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
}
