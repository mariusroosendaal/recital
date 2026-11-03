// Exercises cursor, clicks (one in an iframe), typing and recording on a local page, without Figma.
const html = `
  <style>button{cursor:pointer}</style><body style="margin:0;background:#2c2c2c;font:14px system-ui;color:#eee;display:grid;place-items:center;height:100vh">
    <div style="display:flex;gap:24px;align-items:center">
      <button id="a" onclick="this.textContent='Clicked'" style="padding:10px 18px">First</button>
      <input id="b" aria-label="Name" style="padding:8px" />
      <label><input type="checkbox" id="c" /> Option</label>
      <button id="d" onclick="document.body.style.background='#1d3b5a'">Change background</button>
      <iframe srcdoc="<body style='margin:0;display:grid;place-items:center;height:100vh'><button id='e' onclick='this.textContent=&quot;Clicked&quot;'>In a frame</button>" style="width:140px;height:48px;border:1px solid #555"></iframe>
    </div>
  </body>`;

/** @type {import("recitaljs").Scenario} */
export default {
  url: `data:text/html,${encodeURIComponent(html)}`,
  setup: [{ cursor: [1200, 700] }],
  steps: [
    { click: { ui: "#a" } },
    { type: "Breakpoints", into: { ui: "[aria-label=Name]" } },
    { check: { ui: "#c" } },
    { check: { ui: "#c" }, label: "check again (no-op)" },
    { click: { ui: "#d" }, hold: 800 },
    { click: { ui: "#e", frame: "iframe" }, waitFor: { ui: "#e:has-text('Clicked')", frame: "iframe" } },
    { move: { point: [300, 200] } },
  ],
};
