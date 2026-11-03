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
  a ChatGPT and Codex plugin with the MCP server through `plugin.json`, `mcp.json`,
  `.agents/plugins/` and `scripts/plugin.sh`, and `recital skill`). Keep it in step with the CLI, `types.d.ts` and docs/narration.md.
- `src/mcp.js` is the MCP server (`recital mcp`), the Claude Desktop extension through
  `mcpb/manifest.json` and `scripts/mcpb.sh`. Its `INSTRUCTIONS` are the skill's workflow for
  its tools: keep them in step with the skill. `scripts/mcpb.sh` fails when the manifest's tool
  names aren't the server's.
- ffmpeg and ffprobe come from `src/ffmpeg.js` (`FFMPEG`, `FFPROBE`), never by bare name.

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
