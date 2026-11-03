# Recording in CI

A scenario is code, so CI can record it again whenever the product changes: the videos stay
current, and a step that no longer works (a renamed button, a moved page) fails the job
instead of leaving an old video up.

On Linux with no display, `demo` records headless by itself; `--headless` asks for it anywhere.
Headless takes match headed ones: the same frames and 60 fps moves.

## The workflow

In the workspace's repository, `.github/workflows/demos.yml`. It records after each
successful deployment, or when run by hand, and keeps the finals as an artifact:

```yaml
name: Demos

on:
  deployment_status:
  workflow_dispatch:

jobs:
  record:
    # Only deployments that succeeded, of production (the environment's name may differ)
    if: github.event_name == 'workflow_dispatch' || (github.event.deployment_status.state == 'success' && github.event.deployment.environment == 'production')
    runs-on: ubuntu-latest
    env:
      # The deployed site, for the scenarios' url (see below)
      DEMO_URL: ${{ github.event.deployment_status.environment_url || 'https://example.com' }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg
      - run: npx playwright install --with-deps chromium

      # The Kokoro voice (about 90 MB) and the voiced lines: unchanged lines aren't voiced again
      - uses: actions/cache@v4
        with:
          path: |
            ~/.cache/recital/models
            .narration
          key: recital-${{ hashFiles('scenarios/**') }}
          restore-keys: recital-

      - run: npx recital validate
      - run: |
          for demo in signup checkout; do
            npx recital demo $demo
            # camera only for demos with camera framings
            if grep -q "camera:" scenarios/$demo.js; then npx recital camera $demo; fi
            npx recital narrate $demo
          done

      - uses: actions/upload-artifact@v4
        with:
          name: demos
          path: output/final/
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: failed
          path: |
            output/*/error.png
            output/*/take-failed.mp4
```

When a step fails, `error.png` shows the page at that moment and `take-failed.mp4` the take up
to it.

## The scenario

Scenarios are JavaScript, so they can read the environment:

```js
export default {
  url: process.env.DEMO_URL ?? "http://localhost:3000",
  setup: [
    // Not recorded: sign in with a test account, from the repository's secrets
    { type: process.env.DEMO_EMAIL, into: { ui: "[name=email]" } },
    { type: process.env.DEMO_PASSWORD, into: { ui: "[name=password]" } },
    { click: { ui: "role=button[name='Sign in']" }, waitFor: { ui: "text=Dashboard" } },
  ],
  steps: [ /* … */ ],
};
```

Add `DEMO_EMAIL` and `DEMO_PASSWORD` as repository secrets and pass them in the job's `env`.
Use an account made for demos, with data that looks real and stays the same.

## Voices

Kokoro runs on the runner, free. ElevenLabs needs `ELEVENLABS_API_KEY` as a secret in the
job's `env`; cache `.narration` as above, so a run voices only the lines that changed.

## What to expect

- **Fonts:** the runner has Linux's fonts. A page that relies on system fonts (`system-ui`,
  `-apple-system`) looks different from a Mac take, and so do the burned-in captions. Install
  the fonts you want with `apt-get`, or record where the demos were first made.
- **Figma plugins** need a logged-in profile and a published plugin: record them where you can
  log in.
- **Where the videos go:** the workflow keeps them as an artifact. To publish them, add a step
  that uploads `output/final/` where your site or docs read it.
