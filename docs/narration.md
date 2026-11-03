# Writing the narration

A demo's narration is its spoken lines, each starting at a step of the take. They are also
its subtitles. Keep them plain and short, and use the product's own words.

In the scenario, each line names the `label` of the step it starts at:

```js
narration: [
  { at: "search", text: "Start by searching the collection for a painting." },
  { at: "open", text: "Each painting has its own page, with its story." },
],
steps: [
  { type: "Night Watch", into: { ui: "#search-input" }, label: "search" },
  // …
  { click: { ui: "role=link[name^='The Night Watch']" }, label: "open" },
],
```

Record the take again, then `npx recital narrate <demo>` voices it, with Kokoro unless the
scenario's `narrator` names another voice ([README](../README.md#narration)).

## Pick a shape

Three shapes to start from. Draft the lines first: they are the plan, and each one becomes
a labelled step.

**A task**: one job, start to finish, building to the action that does it.

```
Start by <what the product needs from you>.
Next, <the choice you make>.
Then <a further step>.                       (only if there is one)
Finally, click <Button>, and <what happens>.
<What you end up with, or what to do next time.>
```

**A tour**: what a site or app is for, one stop at a time.

```
<Product> is <what it's for, for whom>.
<One line per area: what you find or do there.>
<Where to go next, or where to start.>
```

**A feature**: what's new, shown once.

```
<What you can do now that you couldn't before>.
<The steps, as in a task, kept to one or two>.
<The gain: the time saved, the step gone>.
```

## The lines

- **Sequence the steps** with "Start by", "Next", "Then" and "Finally". With only one step
  before the action, use "Then" rather than "Finally". A line that only describes what the
  screen shows needs no connector: "Each painting has its own page, with its story."
- **Start with what's needed**: "Start by signing in with your work email." Leave out what
  the viewer can't act on.
- **Name the choice, not the value picked.** "Next, choose how to sort the results.", not
  "sort by date", since the viewer may choose differently. Use "like" for an example: "a
  field, like the title".
- **Action, then result**, in one sentence: "Finally, click Publish, and the page is live."
- **Close on the gain**: what the viewer ends up with, or how to keep it up to date.
- **Say labels as the screen shows them**, and drop counts that change: "Export", not
  "Export 12 rows".
- **Each line is a whole sentence**, ending on a full stop.
- **In a longer demo**, give each part a line that says what it's for before its steps, so a
  viewer who skips ahead still knows where they are.

## Fitting the take

- **A line describes what happens from its step on.** If the step presses Enter, the line
  can't say "click"; change one or the other.
- **About 2.5 words a second.** A line should fit before the next narrated step. Shorten the
  line rather than speed up the voice.
- **The take waits for the voice**: a narrated step starts only when the line before it has
  finished, so a new take always fits its lines. After changing the lines, record again.
- **Not every step needs a line.** Typing, scrolling and waiting can run under the line
  before them; a tour can leave a stop unspoken and let the picture carry it.
- `say` fixes a mispronunciation without changing the subtitle:
  `{ text: "Copy them from Huetone.", say: "Copy them from Hue-tone." }`.
- `pause: 1` leaves a second more before the next line.

## Review

`npx recital scripts` writes `NARRATION.md`, every demo's lines in one place, to read
before they're voiced. `narrate` prints each line's start and length and warns when one runs
into the next. To pick a voice, try a few on the same take (`--voice A,B --variant steady,warm`)
and compare them in `output/<demo>/narration/`.

## Longer demos as clips

Some places take only short videos: social posts, an app store's preview, the Figma
Community's 30 seconds. Plan a longer take as parts: give the steps of each part labels that
start with its name, `search · type`, and `clips` cuts a clip per part. Open each part on a
line that says what it's for, and end no line past the end of its clip.
