# recital

Narrated demo videos of anything in a browser, from a script. A scenario says what to
click and what to say; the recorder drives Chromium with a calm cursor and records at
3200×1800, 60 fps, paced to the voice. When the product changes, record it again.

Website: [recital.video](https://recital.video/)

| [![Data Mapper, a Figma plugin: adding a data source, mapping it to a card and making a copy per record](docs/media/figma-plugin.jpg)](docs/media/figma-plugin.mp4) | [![Rijksmuseum: searching the collection for the Night Watch, zooming in on the painting, and down to its stories](docs/media/website.jpg)](docs/media/website.mp4) |
|---|---|
| A Figma plugin, narrated: [Data Mapper](docs/media/figma-plugin.mp4) | A website: [Rijksmuseum](docs/media/website.mp4) ([scenario](examples/scenarios/rijksmuseum.js); artworks in the public domain) |

Apps that need more than selectors, like a canvas or a plugin's window, get an adapter:
Figma's is built in ([docs/figma.md](docs/figma.md)), and you can write your own
([docs/adapters.md](docs/adapters.md)).

## Install

Node 20+, ffmpeg and Playwright's Chromium:

```sh
git clone https://github.com/mariusroosendaal/recital
cd recital && npm install && npx playwright install chromium
brew install ffmpeg          # or apt install ffmpeg
```

Demos live in a workspace of their own:

```sh
mkdir my-demos && cd my-demos && npm init -y
npm install --save-dev file:../recital
npx recital init            # scenarios/example.js and a .gitignore
npx recital doctor          # checks ffmpeg, Chromium, the voice and keys
npx recital demo example    # records output/example/take.mp4
```

## A scenario

`scenarios/signup.js`:

```js
// @ts-check
/** @type {import("recitaljs").Scenario} */
export default {
  url: "http://localhost:3000",
  steps: [
    { click: { ui: "role=link[name='Sign up']" }, label: "open" },
    { type: "Ada Lovelace", into: { ui: "[name=name]" }, label: "name" },
    { click: { ui: "role=button[name='Create account']" }, waitFor: { ui: "text=Welcome" }, label: "create" },
  ],
  narrator: { voice: "bf_emma" },
  narration: [
    { at: "open", text: "Start by opening the sign-up page." },
    { at: "create", text: "Finally, click Create account, and you're in." },
  ],
};
```

```sh
npx recital demo signup     # the take, paced to the lines
npx recital narrate signup  # with the voice: output/signup/narration/bf_emma.mp4
```

The two comment lines give editor autocomplete and typo checks.

## With an agent

recital comes with an agent skill: it plans the demo, writes the scenario, records it,
looks at the frames, fixes what's off, and writes the narration. In Claude Code:

```
/plugin install recital --marketplace mariusroosendaal/recital
```

Or `npx recital skill` copies it into the workspace's `.claude/skills/`. Then ask for a demo:
"Record a narrated demo of signing up on localhost:3000."

## Commands

| Command | Does |
|---|---|
| `demo <demo>` | Records `output/<demo>/take.mp4`, with `take.steps.json` and a 1600 px `take-phone.mp4`. `--dry` runs without recording, `--headless` without a window (the default on Linux with no display), `--keep-open`, `--scale`, `--cursors <set>`, `--inspect <probe>` runs a script on the page after setup. |
| `demo login <url \| demo \| adapter>` | Opens the browser to log in once, at a URL, a scenario's page or an adapter's login (`figma`); the profile is kept. |
| `validate [<demo> ...]` | Checks scenarios without a browser. |
| `camera <demo>` | A version that zooms in, from the scenario's `camera`: 1.2× the viewport, 1920×1080 by default. |
| `narrate <demo>` | Mixes in the narration, with subtitles. |
| `clips <demo>` | A clip per part (labels sharing a word before ` · `). `--gif`, `--crop`, `--speed`, `--width`. |
| `frames <demo>` | PNG frames and a contact sheet: `--every 1`, `--at 1.5,3.2`, `--steps`. |
| `scripts` | `NARRATION.md`: every scenario's lines, for review. |
| `doctor`, `init` | As above. |
| `skill` | Copies the agent skill into `.claude/skills/demo/`. |

Any command takes `-w <path>` to work on a workspace from elsewhere.

## Scenarios

| Key | |
|---|---|
| `url` | The page the take starts on. |
| `setup`, `steps`, `teardown` | Before the take (not recorded), the take, after it. |
| `theme` | `"light"` (default) or `"dark"`. |
| `viewport` | The page's size in CSS px: `{ width: 1600, height: 900 }` (default). `{ width: 390, height: 844 }` records a phone-sized page, in portrait. |
| `scale` | Pixel ratio: 2 (default) is 3200×1800 at the default viewport, 1.2 is 1920×1080. |
| `speed`, `pauses` | `speed: 1.25` speeds up moves and holds; `pauses: 0.5` halves only the holds. |
| `leadIn`, `tail` | ms before the first step and after the last (800, 1500). |
| `routes` | `{ "<url glob>": "<file>" }`: requests answered from local files. |
| `tabs` | `{ name: url }`, for the `tab` step. |
| `cursors` | `macos` (default), `macos-large`, `minimal`, `dot` or `figma`. `macos` is made from your Mac's own cursors on first use (`minimal` elsewhere); `figma` is Figma's own, the Figma adapter's default. |
| `narration`, `narrator`, `voice`, `final` | See [Narration](#narration). |
| `camera` | See [Camera](#camera). |
| `adapter` | A built-in adapter by name, or your own: see [docs/adapters.md](docs/adapters.md). |
| `file`, `plugin` | The Figma adapter's: see [docs/figma.md](docs/figma.md). |

A step is `{ <action>: <target or value>, ...options }`, with a `label` for narration, the
camera and clips to refer to.

### Targets

| Target | Finds |
|---|---|
| `{ ui: "<selector>" }` | A Playwright selector, such as `role=button[name='Save']`. |
| `{ point: [x, y] }` | A point in the viewport, in CSS px. |

`at: [0.5, 0.1]` picks a point in the target's box, `offset: [x, y]` adds px, `cursor` sets
the cursor's shape, and `frame: "<iframe selector>"` looks the target up in that iframe. An
adapter adds targets of its own, such as Figma's `plugin` and `canvas`.

### Actions

| Action | |
|---|---|
| `move`, `click` | `click` takes `modifiers: ["Shift"]`. |
| `drag` | To a target (`to`) or by px (`by`). |
| `check` | Clicks a checkbox only if it isn't already `value` (true). |
| `type`, `paste` | Text `into` a target; `type` has `clear` and `delay`. |
| `press` | A key or keys, such as `"Meta+A"`. |
| `chooseFiles` | Clicks a file picker and gives it `files`. |
| `scroll` | To a target, by px, or to `{ top }`, in trackpad-like flicks (`flicks`, `pause`). |
| `wheel` | Scrolls whatever is under a target. |
| `tab` | Switches to a tab from `tabs`; `dissolve: ms` cross-fades. |
| `waitFor` | Until a target shows, or with `state: "hidden"` goes. |
| `hold` | ms. |
| `cursor` | Places the cursor without moving it. |
| `eval` | A function run in the page, with `arg`. |

Options on any step: `hold`, `speed`, `ms`, `waitFor` (with `timeout`, and `cut` to trim the
wait), `when` / `unless` (run only if a target is or isn't visible), `settle: false`.

### Camera

Each framing starts at a step and eases from the last:

```js
camera: [
  { at: "open", center: [1400, 470], zoom: 1.5 },   // viewport px
  { at: "create", zoom: 1, ms: 1200 },              // back out over 1.2 s
],
```

Zooms up to 1.67× stay sharp.

## Narration

Each line starts at a step: `{ at: "<label>", text: "…" }`, with `say` to fix a
pronunciation and `pause` for seconds more after it. Lines are voiced before the take, and
each narrated step waits for the line before it.

- **Kokoro**, local and free: `narrator: { voice: "af_heart" }`.
- **ElevenLabs**: `{ provider: "elevenlabs", voice: "Lily" }`, with `ELEVENLABS_API_KEY` in
  `.env`. Also `stability`, `style`, `seed`, `model`, `tag`.

`narrate --voice A,B --variant steady,warm` compares voices on one take. The scenario's
`voice` makes the final video, `output/final/<demo>.mp4` with burned-in captions, plus a
`-plain.mp4` with `.vtt` and `.srt`. [docs/narration.md](docs/narration.md) is on writing
the lines.

## In CI

On Linux with no display, takes record headless, so CI can record the demos again after
each deployment and fail when a step stops working: see [docs/ci.md](docs/ci.md).

## Output

Everything goes in `output/<demo>/`, finals in `output/final/`. The browser profile and the
Kokoro model are shared, in `~/Library/Caches/recital` (`~/.cache` on Linux;
`RECITAL_CACHE` moves it).

## Developing

`npm test` runs the checks; `npm run test:smoke` records the self-test in `examples/`. Built-in
adapters are listed in `src/adapters.js`; `src/figma.js` is the Figma one.
`site/` is the project's one-page website, deployed to GitHub Pages with the videos in
`docs/media/`.

MIT license.
