# The offline dashboard demo

A copy of the dashboard that runs in any browser with no Firebase project behind
it, over a **made-up** YBM study. Use it to show the dashboard to people who
have no account, or to try a change to the web app without the emulators.

```sh
pnpm demo:build          # about two minutes; needs Java 21 and Chromium (see below)
```

The result is a static site in `apps/web/dist-demo/`. Open `demo/index.html` from
any web server (for example `python3 -m http.server` in that folder).

## What is in it

- **The data is invented.** `ybm-study.mjs` generates 77 sittings under the real
  r8.0.0 and r9.0.0 releases: invented names and dates of birth, invented
  schools ("Sample School North" and so on), university campuses as addresses.
  Answers follow each release's display rules. A hidden trait per child keeps
  the standard measures consistent with one another. The three sittings the real
  survey app recorded in its own browser test (`packages/core/src/survey/fixtures/r9-scenarios.json`)
  are added unchanged. Nothing is, or comes from, participant data.
- **The answers are the real dashboard's.** `seed.mjs` loads the study into the
  Emulator Suite, where the dashboard's own trigger summarises it. Then
  `record.mjs` walks every page in a browser and records each function's answer.
  It also sweeps the views a visitor might open that the walk did not: every
  session, and every way the Scores page groups.
- **Lists and charts are live.** In the demo build, `apps/web/demo/backend.ts`
  computes the session list, the Overview and the question analysis in the
  browser, using the same core routines the functions use. So every filter
  works. Flags and notes change in memory until the tab is closed. Everything
  else is played back from the recording. Saving settings and exporting are
  switched off.

## How it is put together

| File | Role |
|---|---|
| `firebase.demo.json` | Emulator ports kept apart from the e2e suite's (9109, 8291, 5111) |
| `scripts/demo/build.mjs` | Runs everything below, in order |
| `scripts/demo/ybm-study.mjs` | The made-up study |
| `scripts/demo/seed.mjs` | Loads it into the emulators |
| `scripts/demo/record.mjs` | Walks the dashboard and records it |
| `scripts/demo/pack.mjs` | Splits the recording into small, lazily loaded files |
| `scripts/demo/check.mjs` | Opens the built demo and fails on any error (`DEMO_URL=…`) |
| `apps/web/vite.demo.config.ts` | Builds the web app with the stand-ins below |
| `apps/web/demo/` | Stand-ins for `firebase/*` and the router (addresses go in the `#`), plus the demo's backend |

The product code is untouched: the demo build swaps modules through Vite aliases
only. The one change to `src/` lets the emulator ports be set with
`VITE_*_EMULATOR_PORT`; the defaults are unchanged.

If Playwright cannot find a browser, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to
Chromium's path, as for the e2e suite.
