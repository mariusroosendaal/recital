# recital in Claude, ChatGPT and Codex

recital lets your AI agent make demo videos. Ask it for a demo of a website, a web app or a
Figma plugin, and it opens the page, writes the steps, records them with a calm cursor, checks
how each step ends, and adds a voice and captions. There's no code to write.

It runs on your own computer, so it works in the desktop apps and Codex, not in a browser or the mobile
apps. That's also why it can record sites you're signed in to, and apps that only run on your
machine. Any other agent that runs MCP servers can use it too: see [For developers](#for-developers).

## Install

### Claude Desktop

You need a Mac with Apple silicon. Nothing else: the extension brings ffmpeg and the voice,
and gets the browser it records with.

1. Download [`recital-darwin-arm64.mcpb`](https://github.com/mariusroosendaal/recital/releases/latest/download/recital-darwin-arm64.mcpb), from the
   [latest release](https://github.com/mariusroosendaal/recital/releases/latest).
2. Open it, or drag it onto Claude Desktop's **Settings → Extensions**, and install it.
3. Choose the **Demos folder**, where the demos and their videos go (`~/Documents/Demos` unless
   you pick another).
4. Leave **ElevenLabs API key** empty unless you want ElevenLabs voices (see [Voices](#voices)).
5. Leave **Log sessions** off unless you want a log of each session, its steps and
   screenshots, in the folder's `output/sessions/`. The screenshots can show sites you're
   signed in to.

If your organization manages Claude, an owner may have to allow the extension.

### ChatGPT and Codex

You need [Node](https://nodejs.org) 20 or later and [ffmpeg](https://ffmpeg.org/download.html)
(on a Mac, `brew install node ffmpeg`). The plugin runs recital from npm, and gets the voice and
the browser the first time.

- **ChatGPT desktop app:** in its plugins, **Add a marketplace** with
  `https://github.com/mariusroosendaal/recital`, or **Upload plugin archive** with
  [`recital-plugin.zip`](https://github.com/mariusroosendaal/recital/releases/latest/download/recital-plugin.zip) from the latest release.
- **Codex:** `codex plugin marketplace add mariusroosendaal/recital`, then install recital
  from `/plugins`.

The Demos folder, where the demos and their videos go, is `~/Documents/Demos`.

## Ask for a demo

Start a chat and ask, in your own words:

- "Make a narrated demo of searching the Rijksmuseum collection for the Night Watch."
- "Record a demo of signing up on our staging site, staging.example.com."
- "Show how to filter the orders table on localhost:3000, in about 30 seconds."
- "Demo my Figma plugin Data Mapper in this file: figma.com/design/…" (it signs in to Figma
  first, as below)

The agent takes it from there. The first time, it gets the browser, which takes a minute. Then it:

1. Looks at the page, and plans the demo with you: what to show, in 3 to 6 steps, and the line
   said at each.
2. Writes the steps, and records them. A browser window opens and plays the demo: leave it
   alone until it closes.
3. Looks at the last frame of every step, fixes what's off (a step too quick to follow, a popup
   in the way), and records again.
4. Adds the voice and captions, and opens the final video.

Some steps take a while. The agent may say one is still running and wait for it: that's normal.

## Where the videos go

In the Demos folder:

| | |
|---|---|
| `output/final/<demo>.mp4` | The final video, captions burned in. For anywhere a video goes. |
| `output/final/<demo>-plain.mp4` | The same without captions, with `.vtt` and `.srt` subtitle files beside it, for players that show their own. |
| `output/<demo>/` | The take without a voice, and its stills. |
| `scenarios/<demo>.js` | The demo's script: the steps and the lines. |

To bring a demo up to date after the product changes, ask: "Record the sign-up demo again."
The script stays, so it plays the same steps on the new version.

## Sites you sign in to

When a demo needs a login, the agent opens a browser window for you. Sign in there yourself,
close the window, and tell the agent you're done. The login is kept for every later demo.
recital never sees your password.

## Voices

The built-in voice, Kokoro, runs on your computer, free and offline. It has 28 English voices,
such as `af_heart` (the default), `bf_emma`, `am_michael` and `bm_george`; ask the agent to try
one.

For an ElevenLabs voice, add your API key: in Claude Desktop, in the extension's settings;
elsewhere, as `ELEVENLABS_API_KEY=…` in a `.env` file in the Demos folder. Then ask for a voice
by its name in your ElevenLabs account, such as "Lily". ElevenLabs charges for each line, so the
agent asks before using it.

## If something goes wrong

- **"The browser didn't start."** A recital browser window is still open, probably from
  signing in. Close it and ask the agent to try again.
- **"The browser didn't download."** Install [Google Chrome](https://www.google.com/chrome/):
  recital records with it as well.
- **recital doesn't start.** In Claude Desktop, check that the Demos folder in its settings is
  one you can write to, or choose another; **Settings → Extensions → recital** has its logs. In
  ChatGPT and Codex, check that Node 20 or later is installed.
- **A step fails.** The agent says which, with a picture of the page at that moment, and usually
  fixes the script itself. A site that changes a lot between visits (banners, pop-ups, A/B
  tests) may need a step to dismiss them first: ask for it.

## For developers

recital is `recital mcp`, an MCP server any client can run on a folder of demos:
`claude mcp add recital -- npx -y -p recitaljs recital mcp -w ~/demos` (`codex mcp add` and
others take the same command). `scripts/mcpb.sh` packs the Claude Desktop extension.

Its tools are the CLI's commands, returning screenshots and contact sheets for the agent to
look at; one that runs past 45 s (`RECITAL_MCP_WAIT`) goes on in the background and `wait`
picks it up. `RECITAL_MCP_SESSIONS=1` (in the environment or the workspace's `.env`; **Log
sessions** in the extension's settings) logs a session's calls and screenshots to
`output/sessions/`.
