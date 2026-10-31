# recital

Records narrated demo videos of web apps and Figma plugins from scenario files. This repo is
the tool; demos live in workspaces that depend on it and run its `recital` bin.
README.md has the commands and the scenario format.

- A workspace is the working directory (or `DEMO_WORKSPACE`): `scenarios/`, `output/`,
  `.narration/`, `.env`. The browser profile and the Kokoro model are shared, in
  `~/Library/Caches/recital` (`RECITAL_CACHE`). See `src/config.js`.
- Keep new code generic; Figma-only logic goes in `src/figma.js`. Nothing here should know
  about any one project that uses it.
- The npm scripts here run on a workspace too: the `default` in `workspaces.json` (this
  machine's workspaces by name, not in git), or `-w <name | path>`. `npm run narrate`,
  `camera` and the rest work the same.
- `examples/scenarios/selftest.js` exercises cursor, clicks, typing and recording on a local
  page: `npm run demo -- selftest -w examples`.

- `skills/demo/SKILL.md` is the agent skill (a Claude Code plugin through `.claude-plugin/`,
  and `recital skill`). Keep it in step with the CLI, `types.d.ts` and docs/narration.md.
- `site/index.html` is the one-page website, deployed to GitHub Pages with `docs/media/`.
  Its scenario excerpts and step times follow `examples/scenarios/rijksmuseum.js` and its take,
  and the Data Mapper scenario and its narrated take (`docs/media/figma-plugin.mp4`, burned-in
  captions for the README; the site plays `figma-plugin-plain.mp4` with `figma-plugin.vtt`).
  Phones get `*-small.mp4` copies; remake them when a take changes:
  `ffmpeg -i X.mp4 -vf scale=1280:800:flags=lanczos,fps=30 -c:v libx264 -preset slow -crf 25 -level 4.0 -c:a copy -movflags +faststart X-small.mp4`.

Recording runs Chromium: run it bare, with no pipe and no `cd … &&`, outside the sandbox.

Releases publish to npm from `.github/workflows/publish.yml` through trusted publishing: set
`version` in package.json, push, and create a GitHub release tagged `v<version>`. Nothing is
published from this machine.

Never add a Co-Authored-By line (or any AI attribution) to commit messages or PR bodies.

## Writing a scenario

1. **See the page**: `demo <demo> --inspect examples/inspect/page.js` lists the headings,
   links and buttons with their boxes, and screenshots the page top to bottom.
2. **Check**: `validate` and `demo --dry`. A missing target names the closest ones on screen.
3. **Record and look**: `demo`, then `frames <demo> --steps` for a contact sheet of how each
   step ends. Adjust holds, scroll positions and order, and record again.
4. **Zoom**: add `camera` framings and run `camera`; check stills with `frames`.
5. **Narrate**: follow docs/narration.md. The take waits for the voice, so lines need no timing.

## Sandbox

Chromium can't start in Claude Code's sandbox; the user excludes the commands that run it in
`.claude/settings.local.json` (`npm run demo:*` matches `npm run demo` with arguments, bare):

```json
{ "sandbox": { "excludedCommands": ["npm run demo", "npm run demo:*", "npm run narrate:*"] } }
```

`narrate` needs Chromium only for captions no take has rendered. In the sandbox Node can't
download the Kokoro model either; put a copy in the cache's `models/`:

```sh
M=~/Library/Caches/recital/models/onnx-community/Kokoro-82M-v1.0-ONNX; B=https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main
mkdir -p $M/onnx && for f in config.json tokenizer.json tokenizer_config.json onnx/model_quantized.onnx; do curl -sfL -o $M/$f $B/$f; done
```
