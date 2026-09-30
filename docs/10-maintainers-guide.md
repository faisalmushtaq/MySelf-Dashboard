# 10. Maintainers' guide

For whoever looks after this code next: where things are, how data moves
through them, and the recipes for the changes that come up again and again.
The why is in [02-architecture.md](02-architecture.md); running and deploying
the live system is in [06-handover.md](06-handover.md). Every path and command
below was checked against the repository on 2026-09-30.

---

## 10.1 Repository map

| Path | What it is |
|---|---|
| `packages/core/` | All domain logic, no Firebase: release manifests and their index (`manifest.ts`), log replay and the completeness engine (`replay.ts`, `completeness.ts`, `summary.ts`, `status.ts`), filters, sorting and paging (`filters.ts`, `query.ts`), analytics and question statistics, exports, roles (`roles.ts`), and **the API contract** (`api.ts`). Sub-folders: `figures/` (publication figures), `scoring/` (schemes, engine, benchmarks, school reports), `codebook/` (readable names), `quality/` (the automated quality review), `survey/` (BIDS and participant linkage on the survey's own data layer; server only), `node/` (hashing and the synthetic demo data; Node only), `vendor/` (copied verbatim from the survey — never edit by hand). Built to `dist/`, which the web app and functions import. |
| `apps/functions/` | The backend, Firebase Functions codebase `dashboard` in europe-west2. `src/index.ts` lists everything deployed; `src/api/*.ts` are the callables; `summaries.ts` is the trigger that summarises each sitting; `store.ts` the in-memory mirror behind lists and metrics; `authz.ts` access decisions; `audit.ts` the audit log; `exporters/` Excel and PDF; `test/` integration tests against the emulators; `build-deploy.mjs` bundles everything into `functions-bundle/` for deployment. |
| `apps/web/` | The React + Vite single-page app. `src/App.tsx` (sign-in gate and routes), `src/app/` (shell and navigation, auth, study data, filters), `src/pages/` (one file per page; a page too big for one file keeps its parts in a sibling folder named after it, e.g. `pages/scoring-settings/`), `src/components/`, `src/charts/`, `src/lib/` (Firebase client, typed API client, hooks, formatting, figure files), `src/styles.css` (all styles). |
| `firestore/` | `dashboard.rules` (security rules for the `dashboard` database), `dashboard.indexes.json`, `storage.emulator.rules`, and `test/rules.test.ts`. |
| `scripts/` | `emulator-setup.mjs` (seed the emulators with synthetic data), `sync-releases.mjs` (register release manifests), `vendor-survey.mjs` and `check-vendored.mjs` (copy the survey's code and check it has not drifted), `check-privacy.mjs` (no console logging or analytics in the web app), `bootstrap-admin.mjs` (first administrator, by hand), `firebase-ops.mjs` (first-time setup, run by the setup workflow). |
| `releases/` | The survey's published release manifests, copied from the survey repository with their content hashes; `releases/README.md` says from which commit. Never edit a manifest. |
| `e2e/` | Playwright tests against the full emulator suite: `research-journey`, `roles-and-states` (with axe accessibility checks), `figures`, `scores`, `codebook`; `support.ts` signs in as each role. |
| `.github/` | `workflows/ci.yml` (every push), `deploy.yml` (manual), `firebase-setup.yml` (first-time setup), `preview.yml` (preview channel); `firebase-setup/request.env` and `preview/functions.env` are the files whose changes trigger those runs (§10.6). |
| `firebase.json`, `.firebaserc`, `firebase.emulators.json` | Deploy config — only the `dashboard` database, the `dashboard` functions codebase and the `dashboard` Hosting target — and the local emulator ports. |
| `docs/` | 01–09: audit, architecture, completeness, risks, plan, handover, figures, scoring, data quality; this guide; `screenshots/` from synthetic data only. |

## 10.2 How data flows

```
 survey device ──saveSitting (survey repo)──► Firestore (default)
                                                studies/{study}/sessions/{id}   (+ chunks/ for long logs)
                                                          │
                          onSessionWritten (apps/functions/src/summaries.ts)
                          assembleSitting (sittings.ts) → releaseIndex (releases.ts)
                          → buildSummary (packages/core/src/summary.ts)
                                                          ▼
                                             Firestore "dashboard"
                                                studies/{study}/sessionSummaries/{id}, meta/freshness
                                                          │
            callables in apps/functions/src/api/*.ts ◄────┘  (store.ts mirrors summaries and reviews in memory)
            requireActor (authz.ts) on every call, audit (audit.ts) for every view, change and export
                                                          │
            apps/web/src/lib/api.ts (typed with packages/core/src/api.ts) ──► pages
```

1. **Sittings** arrive in the survey's own database, `(default)`, written by the
   survey's `saveSitting`. The dashboard only reads that database, and only on
   the server.
2. **Summaries.** `onSessionWritten` runs on every write to a sitting,
   reassembles its log, finds the release it was collected under (by content
   hash) and writes one de-identified summary — statuses, completeness, section
   progress, data-quality signals — to the dashboard's own database. A deleted
   sitting leaves a tombstone. `rebuildSummaries` (Settings → Data maintenance)
   does the same for every sitting.
3. **Callables.** Every browser request is a callable: `requireActor` checks the
   allowlist (`config/access`) and the role claim, the handler reads the
   in-memory mirror (`store.ts`) and computes with `packages/core`, and the
   response is one of the shapes in `packages/core/src/api.ts`. Participants,
   scores and exports need the survey's own linkage (codes, waves,
   corrections), so `studyData.ts` reads raw sittings server-side through the
   vendored data layer in `packages/core/src/survey/`.
4. **Direct reads.** The web app also reads a few collections of the
   `dashboard` database directly, under `firestore/dashboard.rules`: the
   release list and `meta/freshness` (`app/data.tsx`), the person's own
   `exportJobs`, `savedViews` (their own, which they may change, and shared
   ones) and `auditLog` (their own; everyone's for administrators). Nothing in
   the browser reads `(default)`.
5. **Exports** are built by the `createExport` callable into Storage
   (`dashboard-exports/`), downloaded through the authenticated
   `downloadExport` endpoint, audited, and deleted after 24 hours.

## 10.3 Working locally

Node 22, pnpm 10, and Java 21 for the emulators.

```bash
pnpm install
pnpm --filter @myself-dashboard/core build     # the web app and functions import core's dist/
pnpm dev:emulators                             # Auth, Firestore, Functions, Storage
pnpm seed:emulators                            # second terminal: synthetic data and one account per role
pnpm --filter @myself-dashboard/web dev:emulators   # http://127.0.0.1:5173
```

**Rebuild core after changing it** (`pnpm --filter @myself-dashboard/core build`):
the web app and the functions compile against `packages/core/dist`, so a
change to core is invisible to them — and to `pnpm -r typecheck` — until then.

The emulator ports are fixed in `firebase.emulators.json` and in the web app's
emulator build (`apps/web/src/lib/firebase.ts`): Auth 9099, Firestore 8181,
Functions 5001, Storage 9199. Only one checkout can run the emulator suites at
a time.

## 10.4 Recipes

### Add a page

1. Create `apps/web/src/pages/MyPage.tsx` with a default export. Follow the
   other pages: `<div className="page">`, `PageHeader` from
   `components/Metric.tsx`, `FilterBar` and `useFilters()` if the global
   filters apply, data through `useLoad(() => api.something(…), deps)` from
   `lib/hooks.ts`, and `ErrorState` / `Skeleton` / `EmptyState` from
   `components/States.tsx`.
2. Route it in `apps/web/src/App.tsx`: a `lazy(() => import("./pages/MyPage"))`
   and a `<Route path="/my-page" …>` inside the `Shell` route.
3. Add it to `NAV` in `apps/web/src/app/Shell.tsx`: `to`, `label`, an `icon`
   from `components/Icon.tsx`, `filtered: true` if it follows the global
   filters (the date and version controls then show and the filter query string
   carries over), and `capability` to hide the link from roles that cannot use
   it. Hiding a link is not security: the callables enforce the role.
4. Styles go in `apps/web/src/styles.css` under their own section header.
5. Add the page to the axe check in `e2e/roles-and-states.spec.ts`.

### Add a callable

1. **Contract.** Add the request and response types to
   `packages/core/src/api.ts` (exported through `packages/core/src/index.ts`)
   and rebuild core.
2. **Handler.** In `apps/functions/src/api/<area>.ts`:
   `export const myCall = onCall({ ...callableOptions }, async (request): Promise<MyResponse> => { … })`.
   Start with `const actor = await requireActor(request, "<capability>")`
   (capabilities and which role has them: `packages/core/src/roles.ts`),
   validate every input (helpers in `api/common.ts`), and record anything a
   person viewed, changed or exported with `audit()` — add the action to
   `AuditAction` in `apps/functions/src/audit.ts`. Audit details carry ids and
   counts, never answers or names.
3. **Export** it from `apps/functions/src/index.ts`: only what `index.ts`
   exports is deployed.
4. **Client.** Add it to `api` in `apps/web/src/lib/api.ts`:
   `myCall: call<MyRequest, MyResponse>("myCall")` (a second argument raises
   the timeout for slow calls).
5. **Test** it in `apps/functions/test/api.integration.test.ts`, which calls
   each handler exactly as the Functions runtime does (`run(handler, person, data)`),
   with real ID tokens from the Auth emulator.
6. **Deploy the functions** before the web app that uses them (§10.6).

### Name a new survey question in the codebook

Every question in every registered release must have a readable name and
label in `DEFAULT_CODEBOOK` (`packages/core/src/codebook/names.ts`), keyed
`"<instrument>.<item>"` as in the manifest. The test
`packages/core/src/codebook/codebook.test.ts` ("names and labels every question
in every published survey version") reads every manifest in `releases/` and
fails until each has one.

- Name: lower case, letters, digits and `_`, starting with a letter, at most
  32 characters (`NAME_PATTERN` in `codebook/index.ts`); items of a published
  scale as `<scale>_<nn>_<gist>` (the `scaleItems` helper); other questions say
  what they are (`age_first_smartphone`). Unique, and never another question's
  survey variable.
- Label: at most 80 characters, the construct rather than the wording.
- **Names never change once data have been exported under them.** A new
  question gets a new entry.
- The synthetic demo survey's names are in `codebook/demo.ts`.

To list what a new manifest still needs (after building core):

```bash
node --input-type=module -e 'import { readFileSync } from "node:fs"; import { indexRelease, codebookProblems } from "@myself-dashboard/core"; const r = indexRelease(JSON.parse(readFileSync(process.argv[1], "utf8"))); console.log(codebookProblems(r.questions));' releases/<new>.manifest.json
pnpm --filter @myself-dashboard/core exec vitest run src/codebook
```

### Register a new survey release

A sitting is tied to its release by the manifest's content hash; until that
release is registered its sittings show "unknown version" and no completeness.

1. Copy the survey's `releases/<key>.manifest.json` into `releases/` unchanged
   and add its source commit to `releases/README.md`.
2. Name any new questions (above) and run `pnpm -r test`: the codebook,
   scoring (`scoring/scoring.test.ts`) and quality tests all read every
   manifest in `releases/`.
3. Check the hash and what would be registered:
   `node scripts/sync-releases.mjs --from releases --project myself-research --dry-run`
   (refuses any file whose content does not match its stated hash).
4. Register it, in any one of these ways:
   - in the app: **Settings → Survey versions → Register a release manifest
     (JSON)** (administrators);
   - by hand, with application-default credentials:
     `node scripts/sync-releases.mjs --from releases --project myself-research`;
   - by the setup workflow on `main`, which runs the same script (§10.6).
5. **Settings → Data maintenance → Re-summarise sessions with unknown
   versions** for sittings that arrived before it was registered.
6. Until an administrator sets the active version (Settings → Study
   settings), the newest registered release counts as the one the survey is
   serving — register a release once the survey serves it.

### Re-vendor the survey

The dashboard judges "would this question have been shown?" and builds its
BIDS export with the survey's own code, copied verbatim into
`packages/core/src/vendor/`:

- `vendor/myself/{schema,scoring,store}/*.ts` — the data layer, written by
  `node scripts/vendor-survey.mjs ../MySelf` (path to a survey checkout;
  run from the repository root). `vendor/myself/index.ts` is the dashboard's
  own list of what it uses.
- `vendor/engine.ts` — the display-condition evaluator, copied by hand from
  the survey's `packages/engine/src/answers.ts` and `evaluate.ts` (its header
  says which parts).

`pnpm check:vendored ../MySelf` (or `node scripts/check-vendored.mjs <path>`)
fails when either has drifted from the survey. CI runs it on every push with a
checkout of the survey made with the `SURVEY_REPO_TOKEN` secret; without that
secret the check finds no checkout and skips. After
re-vendoring, run every suite: the BIDS, participant and completeness tests
exercise the copied code.

### Add a scoring scheme

- **For one study, no code:** Settings → Scoring → edit as JSON (format:
  `packages/core/src/scoring/scheme.ts`), preview, save as a new version with
  a reason ([08-scoring.md §8.6](08-scoring.md)).
- **As a dashboard default:** add a `ScoringSchemeInput` in
  `packages/core/src/scoring/schemes.ts` (the KSS scheme there is the smallest
  example: `key`, `version`, `instrument`, `status`, `method` with its source,
  and `outputs` with their calculation, range, direction, threshold bands and
  benchmarks, every one `verified: false`) and append it to
  `DEFAULT_SCHEME_INPUTS`. Then:
  - `scoring/scoring.test.ts` checks every default against every release in
    `releases/` (items exist, reversals fit the codes) and counts the
    defaults — update the count;
  - if the instrument has a published scoring key, add it to
    `PUBLISHED_KEYS` in `packages/core/src/quality/expectations.ts` so the
    quality review checks the scheme against it;
  - document it in [08-scoring.md §8.2](08-scoring.md).

## 10.5 Tests

| Suite | Command | Needs | Now |
|---|---|---|---|
| Unit | `pnpm -r test` | core built | 309: core 274, functions 27, web 8 |
| Typecheck | `pnpm -r typecheck` | core built | all packages |
| Rules | `pnpm test:rules` | Java (Firestore emulator) | 29 |
| Functions integration | `pnpm test:integration` | Java, core built | 37 |
| End to end | `pnpm e2e:build` then `pnpm test:e2e` | Java, a Chromium | 10 |
| Privacy lint | `pnpm lint:privacy` | — | no console logging or analytics in `apps/web` |
| Vendored drift | `pnpm check:vendored ../MySelf` | a survey checkout | engine and data layer match |

The emulator suites start and stop their own emulators (`firebase
emulators:exec`); stop any `pnpm dev:emulators` first.

**End to end.** `pnpm e2e:build` builds core, functions and the web app's
emulator build (`apps/web/dist-emulators`); `pnpm test:e2e` starts the
emulators, seeds them (`scripts/emulator-setup.mjs`) and runs Playwright,
which serves the app with `vite preview` on 127.0.0.1:4173.

- Browsers installed somewhere Playwright does not look (and `playwright
  install` not allowed): `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome`.
  Only the `chromium` project is configured.
- **Port 4173 clash.** The survey's own `vite preview` uses 4173 too. With
  `reuseExistingServer: true`, Playwright then quietly tests whatever is
  already on 4173 — the survey — and the first test fails waiting for the
  dashboard's "Sign in" heading. Run on a free port instead:
  `E2E_PORT=4183 pnpm test:e2e` (`playwright.config.ts`). This works because
  the Functions emulator relaxes the callables' CORS allow-list (the
  firebase-functions `enableCors` debug feature it turns on); production keeps
  the list in `apps/functions/src/env.ts`.
- On failure, traces are kept in `test-results/`
  (`pnpm exec playwright show-trace test-results/<test>/trace.zip`).

## 10.6 Deploying

Everything deploys into the survey's Firebase project `myself-research`, and
only into the dashboard's own resources: the `dashboard` database, the
`dashboard` functions codebase and the `myself-research-dashboard` Hosting site.

| Route | How it is started | What it does |
|---|---|---|
| **First-time setup** (`.github/workflows/firebase-setup.yml`) | Merge a change to `.github/firebase-setup/request.env` into `main` — set `MODE` (`preflight` = read-only check, `setup` = full setup) and bump `REQUEST` — or run it from the Actions tab. A change on any other branch runs nothing. | Preflight; creates the database, site, web app and sign-in domains (`scripts/firebase-ops.mjs prepare`); deploys rules, functions and the web app; registers every manifest in `releases/` (`scripts/sync-releases.mjs`); makes the first administrator, backfills summaries through an `ops/` request, smoke-tests (`firebase-ops.mjs finish`). |
| **Deploy** (`.github/workflows/deploy.yml`) | Manual only (Actions → Deploy dashboard), choosing `all`, `rules`, `functions` or `hosting`. | Runs the unit tests, then `firebase deploy` of the chosen part. |
| **Preview** (`.github/workflows/preview.yml`) | Every push to the working branch `claude/laughing-lovelace-9qt0j6`, or manually. | Publishes the web app to the Hosting preview channel `dashboard-preview` (its own URL, 30 days) against the **live** functions and data, and prints the URL in the run summary. The live functions are deployed too only when the same push changes `.github/preview/functions.env` (bump `REQUEST` and say why in the comment). |
| **By hand** | `pnpm deploy:rules`, `pnpm deploy:functions`, `pnpm deploy:hosting` (package.json), with credentials for the project. | The same three parts. `firebase.json` predeploys build core, then the functions bundle (`functions-bundle/`) or the web app (`apps/web/dist`). |

- All three workflows use the GitHub environment `production`: the secret
  `FIREBASE_SERVICE_ACCOUNT` (a service-account JSON key) and the variable
  `DASHBOARD_FIREBASE_CONFIG` (the public web-app config, built into the web
  app as `VITE_FIREBASE_CONFIG`).
- Functions configuration is `apps/functions/.env.myself-research` (committed;
  nothing in it is secret): study, database, allowed origins, and
  `DASHBOARD_PREVIEW_SITE`, which lets the site's preview channels call the
  functions (`previewOrigins()` in `apps/functions/src/env.ts`).
- The first line of `request.env` still says "the dashboard branch" — it runs
  from `main`. Editing the file starts a run, so it is corrected with the next
  real request, not on its own.
- Deploy the functions before a web app that needs a new or changed callable.
  Rolling back: [06-handover.md §12](06-handover.md).

## 10.7 Rules of the road

- **Behaviour lives in `packages/core`**, where it can be unit-tested without
  Firebase; functions and pages stay thin.
- **The API contract is `packages/core/src/api.ts`.** Change a shape there and
  both sides must compile against it.
- **Never write to `(default)`** — the survey's database. Nothing in this
  repository does; the dashboard reads it only on the server, and its rules
  belong to the survey repository.
- **`packages/core/src/vendor/` and `releases/` are copies.** Re-vendor or
  re-copy; never edit.
- **Privacy:** no `console.log`/`info`/`debug` and no analytics in the web app
  (`pnpm lint:privacy`); identifying answers never leave the server; audit
  details carry ids and counts, never answers, free text or names.
- **Status is never colour alone** — shape, words and colour together
  (`components/Status.tsx`); every chart has a table twin (`charts/ChartCard.tsx`).
  The visual basis is described at the top of `apps/web/src/styles.css`.
- **Screenshots and fixtures are synthetic.** `docs/screenshots/` come from the
  emulator seed; `packages/core/src/survey/fixtures/` from the survey's own
  scenario runs.
