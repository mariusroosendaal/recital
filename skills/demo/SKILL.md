---
name: demo
description: Write, record and narrate a product demo video with recital, a scenario file that clicks through a web app or Figma plugin with a calm cursor, spoken lines and captions. Use when asked to make, script, record, re-record or narrate a demo, walkthrough or screencast of an app or Figma plugin, or to fix or update a recital scenario.
---

# Making a demo with recital

A demo is a scenario, `scenarios/<demo>.js` in a workspace (a folder with `scenarios/`): the
page to open, the steps to take, and the lines to say. recital records it in Chromium at
3200×1800 (a 1600×900 page at 2×; `viewport` and `scale` change it) and 60 fps, waits for
each line before the step it belongs to, and makes the final video with burned-in captions.

## References

Read these before writing a scenario; they're in the installed package:

- `node_modules/recitaljs/types.d.ts`: every scenario key, action, target and option, with what
  each does. The source of truth for the format.
- `node_modules/recitaljs/README.md`: the commands and an example.
- `node_modules/recitaljs/docs/narration.md`: the full guide to the spoken lines.
- `node_modules/recitaljs/docs/figma.md`: Figma plugins, through the built-in Figma adapter
  (`file`, `plugin`, `canvas` targets).
- `node_modules/recitaljs/docs/adapters.md`: an adapter of your own, for an app whose canvas or
  windows `ui` and `frame` targets can't reach.
- `node_modules/recitaljs/docs/ci.md`: recording again in CI after each deployment.

## Setup

In the folder the user wants the demos in (not inside the app's source, unless they ask):

```sh
npm init -y                        # if there's no package.json
npm i -D recitaljs
npx playwright install chromium
npx recital init                  # scenarios/example.js and a .gitignore
npx recital doctor                # ffmpeg, Chromium, the voice, keys
```

Apps behind a login: ask the user to run `npx recital demo login <url>` (or
`npx recital demo login figma`) and sign in themselves. The login is kept, so it's needed only once. Never ask for their password.

## Running the browser

`demo` opens Chromium. Run each `npx recital demo …` as the whole command, with no pipe and
no `cd … &&`. If Chromium exits straight away (code 21, "ProcessSingleton", a sandbox error),
the agent's sandbox is blocking it: tell the user, and suggest they allow the command outside
the sandbox (in Claude Code, `sandbox.excludedCommands`, such as `"npx recital demo:*"`). Don't
work around the sandbox.

## The workflow

1. **Plan the demo.** A task start to finish, a tour of a site or app, or one new feature, in
   3 to 6 narrated steps and 15 to 45 seconds. Settle what the viewer should see and in what
   state the app starts. Draft the narration now, by
   the rules below: it is the plan, and each line becomes a labelled step.

2. **See the page.** Write the scenario with its `url` and one step, `{ hold: 500 }`, then:
   `npx recital demo <demo> --inspect node_modules/recitaljs/examples/inspect/page.js`.
   It lists the headings, links and buttons with their boxes, and screenshots the page top to
   bottom into `output/probe/`. Look at the screenshots.

3. **Write the steps.** Start the file with `// @ts-check` and
   `/** @type {import("recitaljs").Scenario} */`.
   - Prefer selectors a person would read: `role=button[name='Save']`, `text=Welcome`,
     `[name=email]`. Avoid `nth=` and generated class names.
   - Put what the viewer shouldn't see (dismissing a banner, resetting data) in `setup`.
   - Give a `label` to every step a line or a camera framing starts at.
   - After a click that loads something, `waitFor` what appears, so the take doesn't run ahead.
   - Don't click what is already right: guard with `unless`, or use `check` for checkboxes.

4. **Check.** `npx recital validate <demo>`, then `npx recital demo <demo> --dry`, which
   runs the steps without recording. A target it can't find names the closest ones on screen.

5. **Record and look.** `npx recital demo <demo>` records `output/<demo>/take.mp4`. Then
   `npx recital frames <demo> --steps` and look at `output/<demo>/frames/take/sheet.png`,
   one frame at the end of each step. Fix what's off (a step ending mid-scroll, a hold too
   short to read, a popup in the way) and record again. Look at the sheet every time: a take
   that ran without errors can still show the wrong thing.

6. **Zoom, if it helps.** Small UI reads better closer. Add `camera` framings
   (`{ at: "<label>", center: [x, y], zoom: 1.5 }`, CSS px of the viewport, 1600×900 by default, and
   `{ at: "<label>", zoom: 1 }` to ease back out), run `npx recital camera <demo>`, and check
   `npx recital frames output/<demo>/camera.mp4 --steps`. Up to 1.67× stays sharp.

7. **Narrate.** Add the `narration` lines and record the take again: each narrated step waits
   for its line, so the new take fits. Then `npx recital narrate <demo>` makes
   `output/final/<demo>.mp4` with burned-in captions. The default voice is Kokoro, local and
   free. ElevenLabs needs `ELEVENLABS_API_KEY` in `.env`: ask before using a paid voice.

Report the final video's path, and how to record it again: `npx recital demo <demo>`, then
`camera` if it has framings, then `narrate`. Where there's no display, add `--headless`. If
the user wants the demos kept current, offer the CI workflow in `docs/ci.md`.

## The narration

The lines are also the subtitles. Plain, short, in the product's own words. A task has this
shape; narration.md has the shapes of a tour and a feature:

```
Start by <what the product needs from you>.
Next, <the choice you make>.
Then <a further step>.                       (only if there is one)
Finally, click <Button>, and <what happens>.
<What you end up with, or what to do next time.>
```

- Sequence with "Start by", "Next", "Then", "Finally". A line that only describes what the
  screen shows needs no connector.
- Name the choice, not the value picked: "Next, choose how to sort them.", not "sort by name".
- Action, then result, in one sentence. Close on what the viewer gains.
- Say labels exactly as the screen shows them; drop counts that change.
- Each line is a whole sentence. About 2.5 words a second; shorten a line rather than speed up
  the voice.
- A line describes what happens from its step on: if the step presses Enter, don't say "click".
- `say` fixes a mispronunciation without changing the caption; `pause: 1` adds a second after.

## Style

The look is restrained, so the product is what people watch. Keep the defaults (the cursor,
no effects) unless the user asks. Keep cursor trips short: place windows and order steps so
the cursor doesn't cross the screen. Hold a result long enough to read (1 to 2 s). A
`speed: 1.25` often feels better than the default for UI that's quick to read.
