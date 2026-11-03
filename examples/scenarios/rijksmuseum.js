// @ts-check
// Rijksmuseum: search the collection for the Night Watch, look over the results, open the
// painting and zoom in on it with the page's own controls, back out a step, then scroll down
// past what the museum says about it to its stories. The README's website
// demo, recorded with --headless: the Rijksmuseum's images of its public-domain artworks are
// free to use (CC0).
/** @type {import("recitaljs").Scenario} */
export default {
  url: "https://www.rijksmuseum.nl/en/collection",
  // 8:5, a little taller than 16:9
  viewport: { width: 1600, height: 1000 },
  speed: 1.25,
  pauses: 0.6,
  cursors: "macos",
  // npm run camera: in on the search, out for the rest
  camera: [
    { at: "search", center: [600, 720], zoom: 1.5 },
    { at: "results", zoom: 1, ms: 1000 },
  ],

  setup: [
    // A fresh browser profile asks about cookies; the answer is kept
    { click: { ui: "button:has-text('No, rather not')" }, when: { ui: "button:has-text('No, rather not')" } },
    { cursor: [1100, 420] },
    { hold: 1000 },
  ],

  steps: [
    { type: "Night Watch", into: { ui: "#search-input" }, delay: 70, waitFor: { ui: ".search-panel-suggestions" }, hold: 800, label: "search" },
    { press: "Enter", waitFor: { ui: ".art-grid-item-link >> nth=0" }, hold: 1500, label: "results" },
    // The object page takes a while to load from the results; keep a moment of it
    { click: { ui: ".art-grid-item-link >> nth=0" }, waitFor: { ui: "h1.object-title" }, cut: 600, hold: 1500, label: "open" },
    // The painting's own zoom controls, at its bottom right
    { click: { ui: "button[aria-label='Zoom in']" }, speed: 1.5, hold: 400, label: "zoom" },
    { click: { ui: "button[aria-label='Zoom in']" }, speed: 1.5, hold: 1500 },
    { click: { ui: "button[aria-label='Zoom out']" }, speed: 1.5, hold: 1000, label: "back" },
    { scroll: { ui: "h3:has-text('Stories')" }, to: 0.1, flicks: 2, hold: 2500, label: "stories" },
  ],
};
