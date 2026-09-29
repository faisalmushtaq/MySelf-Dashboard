# 6. Handover

Everything needed to run, deploy, operate and roll back the MySelf Research
Dashboard. Read [02-architecture.md](02-architecture.md) and
[03-completeness.md](03-completeness.md) first for the why.

**Status at handover (2026-09-28).** Built and tested end to end against the
Firebase Emulator Suite with synthetic data. **Not yet deployed**: this work had
no credentials for `myself-research`, and deploying into the survey's project is a
decision for its owners. §5 is the deployment procedure.

---

## 1. Architecture in one picture

```
 Browser (React SPA, Hosting site "myself-research-dashboard")
   │  Google sign-in (Firebase Auth) — ID token on every call
   │
   ├── callables (europe-west2, codebase "dashboard") ─────────────┐
   │     whoAmI · querySessions · getSessionDetail · getAnalytics  │ role + allowlist
   │     getQuestionAnalytics · getQuestionHistory · updateReview  │ checked on EVERY
   │     addNote · previewExport · createExport · getSettings ·    │ call; audited
   │     updateAccessPolicy · updatePolicy · setDashboardRole ·    │
   │     rebuildSummaries · registerReleaseManifest · logChartDownload
   ├── GET downloadExport?job=… (Bearer ID token) ─────────────────┘
   └── direct Firestore reads, "dashboard" DB (rules-enforced):
         releases · meta/freshness · reviews(+notes) · own savedViews (r/w)
         · own exportJobs · own auditLog (admins: all)

 Firestore (default)  ← survey devices via saveSitting (survey repo)
   studies/{study}/sessions/{id}  ──trigger onSessionWritten──►  Firestore "dashboard"
                                                                  studies/{study}/sessionSummaries/{id}
 Storage: dashboard-exports/{jobId}/… (no client access; 24 h; hourly cleanup)
```

## 2. Repository structure

```
packages/core/        domain logic, no Firebase: manifest index, replay, completeness@1,
                      statuses, filters/query, analytics, questions & versions, CSV,
                      export shaping, API contract, roles. src/node: hashing and the
                      synthetic data generator. src/vendor/engine.ts: the survey's
                      evaluate(), copied verbatim. test-fixtures/ybm: real manifests.
apps/functions/       Firebase Functions (codebase "dashboard"): src/api/* callables,
                      summaries.ts (trigger + rebuild), store.ts (in-memory mirror),
                      authz.ts, audit.ts, exporters/ (XLSX, PDF), build-deploy.mjs.
                      test/: integration tests against the emulators.
apps/web/             React + Vite SPA: app/ (auth, shell, filters), pages/,
                      components/, charts/, lib/ (Firebase client, API, hooks).
firestore/            dashboard.rules, dashboard.indexes.json, rules tests.
e2e/                  Playwright end-to-end tests.
scripts/              emulator-setup, sync-releases, bootstrap-admin, check-privacy,
                      check-vendored.
docs/                 01 audit · 02 architecture · 03 completeness · 04 risks · 05 plan · 06 this
firebase.json         deploy config: ONLY the dashboard DB, codebase and Hosting site
firebase.emulators.json  local emulator config
```

## 3. Local setup

Requirements: Node 22, pnpm 10, Java 17+ (for the emulators).

```bash
pnpm install
pnpm --filter @myself-dashboard/core build     # other packages import its dist
pnpm -r test                                   # unit tests (core, functions, web)
```

Run the whole stack locally with synthetic data:

```bash
pnpm e2e:build                                 # core, functions, emulator web build
pnpm dev:emulators                             # terminal 1: Auth, Firestore, Functions, Storage
pnpm seed:emulators                            # terminal 2: rules, policy, versions, people, 64 sittings
pnpm --filter @myself-dashboard/web dev:emulators   # terminal 2: http://127.0.0.1:5173
```

The emulator build's sign-in page has an extra "Emulated Google account" form
(removed at compile time from production builds). Seeded accounts:

| Account | Role |
|---|---|
| `brainpopresearch@gmail.com` | Administrator |
| `researcher@brainpop.example` | Researcher |
| `reviewer@brainpop.example` | Read-only reviewer |
| `stranger@gmail.com` | has an `owner` claim but is **not** on the access list → denied |

## 4. Configuration

### 4.1 Environment variables

| Where | Variable | Meaning |
|---|---|---|
| Web (build time) | `VITE_FIREBASE_CONFIG` | Web-app config JSON from the Firebase console. Set `authDomain` to the dashboard's own Hosting domain (`myself-research-dashboard.web.app`) so sign-in is same-origin. Public, not secret. |
| | `VITE_USE_EMULATORS` | `true` only for local/emulator builds. |
| | `VITE_STUDY` | Study id (default `ybm`; emulator `demo`). |
| | `VITE_DOWNLOAD_URL` | Optional override for the `downloadExport` URL. |
| Functions (`apps/functions/.env.<project>`) | `MYSELF_STUDY` | Study id, as the survey's functions use. |
| | `DASHBOARD_DATABASE` | Named database id (default `dashboard`). |
| | `DASHBOARD_ORIGINS` | Comma-separated browser origins allowed to call the functions. |
| | `DASHBOARD_ENFORCE_APP_CHECK` | `true` once App Check is configured. |
| Scripts | application-default credentials | `gcloud auth application-default login`. No key files. |
| | `FIRESTORE_EMULATOR_HOST`, `SEED_COUNT` | Emulator and seed size. |
| | `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Browser binary when `playwright install` is not possible. |
| GitHub | secret `FIREBASE_SERVICE_ACCOUNT` | Deploy credential (manual deploy workflow only). |
| | variable `DASHBOARD_FIREBASE_CONFIG` | The web config for production builds. |
| | secret `SURVEY_REPO_TOKEN` | Optional: read access to the survey repo for the vendored-code check. |

Nothing secret is needed by the dashboard at runtime.

### 4.2 Study settings (in the app)

Settings → Study settings (administrators), stored in `config/policy`: required
levels, abandonment window, test-code patterns, reviewer free-text access, export
retention, time zone, too-fast threshold, active release. Defaults and meaning are
in [05-plan.md §5.2](05-plan.md). Changing required levels needs a rebuild.

## 5. Deploying into `myself-research`

### 5.0 Automated first-time setup (GitHub Actions)

`.github/workflows/firebase-setup.yml` does everything below with the
`FIREBASE_SERVICE_ACCOUNT` secret — a JSON key for a service account with
**Editor**, **Cloud Run Admin** and **Cloud Functions Admin** (needed to make the
functions callable from browsers), plus **Cloud Datastore Owner** for the first
run only (creating the database; remove it afterwards) — in two stages chosen by
`MODE` in `.github/firebase-setup/request.env`:

- **preflight** — read-only: confirms the key, lists databases, Hosting sites, web
  apps, sign-in settings, API-key restrictions, buckets, deployed functions (and
  any name clashes), the functions runtime account's roles, and whether the
  administrator account exists. Changes nothing.
- **setup** — creates the `dashboard` database (same location as `(default)`,
  delete-protected, point-in-time recovery, daily backups kept 7 days), the
  Hosting site, a "MySelf Research Dashboard" web app, adds the dashboard domains
  to the authorised sign-in domains (and to the browser key's referrers if it has
  any); deploys rules/indexes, the `dashboard` functions codebase and the Hosting
  site; registers the survey versions in `releases/`; makes
  `brainpopresearch@gmail.com` an Administrator (only if it is not one already);
  asks the deployed `onOpsRequest` function to summarise every existing sitting
  — inside Google Cloud, so no participant data passes through GitHub — and
  smoke-tests the site and the backend.

Every step is idempotent: re-running setup after fixing a problem is safe, and
re-running it later is how an update is deployed.

First deployed 28 September 2026 (run 36489628110): database `dashboard`
(europe-west2), site https://myself-research-dashboard.web.app, 22 functions in
codebase `dashboard`, 10 survey versions registered, existing sittings summarised.

### 5.1 By hand

One-time, by a project owner:

```bash
# 1. The dashboard's own database, in the SAME location as (default).
gcloud firestore databases create --database=dashboard --location=europe-west2 --project=myself-research
#    Recommended: point-in-time recovery and daily backups for review data.
gcloud firestore databases update --database=dashboard --enable-pitr --project=myself-research
gcloud firestore backups schedules create --database=dashboard --recurrence=daily --retention=7d --project=myself-research

# 2. A separate Hosting site (the survey's lab keeps the default site).
firebase hosting:sites:create myself-research-dashboard --project myself-research
#    (.firebaserc already maps the "dashboard" target to it.)

# 3. Authentication → Settings → Authorised domains: add myself-research-dashboard.web.app
#    Authentication → Sign-in method: Google must be enabled (the survey's researcher
#    view already uses it).

# 4. A web app config: Project settings → Your apps → Web app (reuse or add one), with
#    authDomain = myself-research-dashboard.web.app → VITE_FIREBASE_CONFIG.
```

Deploy (each touches only the dashboard's resources):

```bash
pnpm deploy:rules          # firestore/dashboard.rules + indexes → "dashboard" DB only
pnpm deploy:functions      # codebase "dashboard" (bundled by build-deploy.mjs)
VITE_FIREBASE_CONFIG='{"apiKey":"…","authDomain":"myself-research-dashboard.web.app","projectId":"myself-research"}' \
  pnpm deploy:hosting      # Hosting site myself-research-dashboard
```

The deploying account needs the roles the survey documents for its own deploys
(`docs/13` §5.2.1 in the survey repo: Cloud Functions Admin, Service Account User,
Cloud Run Admin, Artifact Registry Writer) plus **Cloud Scheduler Admin**
(`cleanupExports`), **Eventarc Admin** for the first Firestore-trigger deploy,
**Cloud Datastore Owner** (or Index Admin) for indexes, and **Firebase Hosting
Admin**. It does **not** need Secret Manager: the dashboard has no secrets.

Then, once:

```bash
# 5. Register every published survey version (verifies each content hash).
node scripts/sync-releases.mjs --from ../MySelf/releases --project myself-research

# 6. Open the dashboard and sign in with brainpopresearch@gmail.com (you will see
#    "Access not granted" — that creates the account), then:
node scripts/bootstrap-admin.mjs --project myself-research --email brainpopresearch@gmail.com
#    add --domain <workspace-domain> if a managed BrainPOP Workspace domain exists.

# 7. Sign out and in again. Settings → Data maintenance → "Rebuild all summaries"
#    backfills every existing sitting (read-only against the survey's data).
```

Acceptance check after deploy: the Overview shows the expected session count;
`stranger` accounts are denied; a researcher can flag a session and see it in
"My activity"; an export downloads and appears in the audit log; the rules
tests pass against the deployed file (`pnpm test:rules`).

**Scale switch for fieldwork days:** cold starts cost a few seconds on the first
request. Setting `minInstances: 1` on `querySessions` and `getAnalytics` removes
that for a few pounds a month.

## 6. Authentication and roles

- **Who can sign in:** anyone with a Google account can *authenticate*; only
  accounts that are (a) on the access list — Settings → Access, stored in
  `config/access` — and (b) hold a role can *use* the dashboard. Both are enforced
  by the backend on every call and by `firestore/dashboard.rules` on every direct
  read. Survey devices (anonymous or `device: true`) are always refused.
- **Roles** are the survey's existing `role` custom claim: `owner` = Administrator,
  `researcher` = Researcher, `analyst` = Read-only reviewer. The capability matrix is
  `packages/core/src/roles.ts` (one table, used by backend, UI and tests).
- **Nobody grants themselves a role**: claims are set only by the Admin SDK
  (`setDashboardRole`, `bootstrap-admin.mjs`, or the survey's `setRole`). Rules deny
  every client write to `config/**` and `users/**`.

### Adding a researcher

1. Settings → Access: add their Google email (or confirm their Workspace domain is
   listed). Save.
2. Ask them to open the dashboard and sign in once. They will see "approved but has
   not been given a dashboard role yet" — that creates their account.
3. Settings → People and roles: enter their email, choose the role, **Grant role**.
4. They reload (or sign out and in). The change is audited as `role.changed`.

### Removing a researcher

1. Settings → People and roles → **Remove role** (revokes their refresh tokens; the
   backend refuses them within a minute).
2. Settings → Access: remove their email and save. The security rules read this
   list on every request, so direct reads stop at once too.

Do both. Their past audit entries, notes and flags remain, attributed to them.

## 7. Data model mapping

| Survey `(default)` `studies/{s}/sessions/{id}` | Dashboard `sessionSummaries/{id}` |
|---|---|
| `sessionId` | `sessionId` |
| `studyCode` | `studyCode` (masked for reviewers by the API), `site` (its letters) |
| `deviceId` | `deviceId` (hidden from reviewers; dropped from de-identified exports) |
| `releaseHash`, `releaseKey` | same, plus `releaseVersion`, `releaseKnown` (registry lookup) |
| `startedAt`, `completedAt` (device clock) | same |
| max(`events[].tWall`) | `lastActivityAt`; latest response → `lastResponseAt` |
| `receivedAt` (server, last upload) | `receivedAt`; first one seen → `firstReceivedAt` |
| `complete` / `session.completed` | `terminal` |
| `quarantined`, missing chunks | `quarantined`, `unreadable` → Invalid marker |
| `provenance` | `provenance` |
| `events[]` | never copied. Replayed into `counts`, `requiredCompletion`, `estimated`, `sections`, `missingRequiredKeys`, `invalidKeys`, `lastPresentedKey`, `finalSectionKey`, `warnings`, and `items[]` (per-question outcome code + stored code/number for non-identifying, non-free-text answers) |
| `session.completed.totalMs/foregroundMs` | `durationMs`, `foregroundMs`; first→last event → `wallClockMs` |

Dashboard-only collections: `config/access`, `config/policy`, `users/{uid}`,
`studies/{s}/releases`, `releaseManifests`, `meta/freshness`, `reviews(+notes)`,
`savedViews`, `exportJobs`, `auditLog` — shapes in [02 §2.3](02-architecture.md) —
and, for scoring ([08](08-scoring.md)), `config/groups` (school names, year-group
sources and rules, minimum group size) and `studies/{s}/scoringSchemes/{key}`
with every saved version under `…/versions/{version}`. Neither is readable or
writable by a client (the rules' default deny); both go through audited calls.

## 8. Indexes

`firestore/dashboard.indexes.json` (deployed with the rules):

| Collection | Fields | Used by |
|---|---|---|
| exportJobs | requestedBy ↑, createdAt ↓ | Reports, notifications, export progress |
| auditLog | actorUid ↑, at ↓ | "My activity" |
| auditLog | action ↑, at ↓ | Audit filter (administrators) |
| auditLog | actorUid ↑, action ↑, at ↓ | "My activity" filtered by action |
| auditLog | target.id ↑, at ↓ | audit trail of one session |
| savedViews | ownerUid ↑, updatedAt ↓ / shared ↑, updatedAt ↓ | Saved views |

Field overrides exempt `sessionSummaries.items`, `.sections` and
`releaseManifests.manifestJson` from indexing (large, never queried). Session
lists and metrics need no composite indexes: they are computed server-side
(02 §2.4).

## 9. Security rules

`firestore/dashboard.rules` governs **only** the `dashboard` database. Summary:
members read versions, freshness, reviews and notes; nobody reads summaries or
manifests directly; saved views are the only client-written collection (owner-only,
`request.time` stamps, sharing only for researchers/administrators, no search text);
export jobs readable by requester or administrator; audit log readable by
administrators (all) or its subject (own), never writable. Everything else is closed.

Tests: `pnpm test:rules` (28 cases: outsiders of every kind, each role, malicious
writes, self-granted roles, forged owners and timestamps, audit tampering).

**Survey-side dependency:** exports live in the project's single Storage bucket
under `dashboard-exports/`. They are private because the survey's `storage.rules`
end in a catch-all deny. If those rules are ever loosened, add an explicit
`match /dashboard-exports/{p=**} { allow read, write: if false; }` there.

## 10. Export security model

1. Preview (`previewExport`) shows type, count, date range, filters, versions,
   fields, free text, identifiers, format, filename and warnings.
2. Sensitive (row-level) exports require an explicit confirmation tick.
3. `createExport` re-parses the request, re-applies the caller's role
   (`authoriseExport`), audits refusals, generates the file on the server in batches
   (progress in the job document), stores it privately, and audits success.
4. `downloadExport` verifies the ID token (revocation checked), current access,
   ownership (or administrator), status and expiry, streams the file with
   `no-store`, and audits every download and refusal.
5. `cleanupExports` deletes files after `exportRetentionHours` (default 24 h).
6. Never exported, for any role: names, dates of birth, UPNs, NHS numbers and the
   secret-code answers. Session exports carry identifiers **by default** (participant
   code, wave, session id; study code where the role allows), because the study
   links these data to other records; ticking off "Include identifiers" gives a
   de-identified copy (labels P0001…, times cut to the day, no session ids or study
   codes). Free text only when asked and allowed; JSON only for administrators. CSV
   cells are formula-neutralised; XLSX cells are typed values, never formulas.
7. The default session format is a BIDS dataset (zip) built with the survey's own
   data layer, so participant codes, waves and scores match the survey's export.
   With identifiers, `linkage.tsv` maps each BIDS subject/session to the codes and
   is listed in `.bidsignore`; `export_manifest.json` holds a SHA-256 per file.

## 11. Testing

| Suite | Command | What |
|---|---|---|
| Unit | `pnpm -r test` | 152 core (completeness, statuses, filters, dates/DST, query, analytics, questions/versions, exports, CSV injection, roles, 20k-session performance, real YBM manifests, figure layout/typography/escaping/Wilson intervals/PNG and TIFF encoding) + 16 functions (access decisions, release verification, encoders) + 8 web components |
| Rules | `pnpm test:rules` | 28 emulator tests (Firestore emulator) |
| Integration | `pnpm test:integration` | 25 backend tests against Auth/Firestore/Storage emulators with real Google-provider ID tokens |
| End to end | `pnpm e2e:build && pnpm test:e2e` | 5 Playwright tests: the brief's 11-step research journey, a publication figure downloaded in every format (each file opened and checked), reviewer restrictions, administrator screens and empty states, axe WCAG 2.1 AA on the main screens including Figures |
| Privacy lint | `pnpm lint:privacy` | no console logging or analytics in the web app |
| Drift | `pnpm check:vendored ../MySelf` | the vendored evaluator still matches the survey |

CI (`.github/workflows/ci.yml`) runs all of these on every push.

## 12. Rollback

| What | How |
|---|---|
| Web app | Firebase console → Hosting → `myself-research-dashboard` → Release history → ⋮ → Roll back (instant, no rebuild); or `git checkout <previous tag>` and `pnpm deploy:hosting`. |
| Functions | `git checkout <previous tag> && pnpm deploy:functions`. Container images are kept per the project's artifact policy (survey docs/13 §6). |
| Rules / indexes | Console → Firestore → `dashboard` → Rules → history → restore; or redeploy the previous `firestore/dashboard.rules`. |
| Summaries | Derived. Settings → Rebuild all summaries (or `rebuildSummaries`). |
| Reviews, notes, views, audit | Primary dashboard data: restore with PITR / scheduled backups (§5 step 1). |
| Remove the dashboard entirely | Delete the `dashboard` functions codebase (`firebase functions:delete <names> --region europe-west2`), the Hosting site, and the database (`gcloud firestore databases delete --database=dashboard`). The survey is untouched: nothing in this repository writes to `(default)`. |

## 13. Known limitations

- Figure PDFs set text in the standard Helvetica font without embedding it;
  embed fonts in Acrobat or Illustrator if a journal's checker requires it
  ([07-figures.md](07-figures.md) §7.6).

- Deployed to `myself-research` (§5.0). Later changes reach production only when
  the "Firebase setup" workflow is run again (§5.0); nothing deploys on push.
- Scores: RCADS T-score norms are not included; the SWEMWBS bands are adult-
  derived and the SDQ British norms date from 1999; every cut-point and norm is
  shipped unverified until an administrator checks it (docs/08 §8.6). The
  survey's own SWEMWBS and STAI-5 scoring is blank before r7.2.0 (S6, fixed in
  the survey from r7.2.0) and its SDQ and RCADS totals are blank in every
  release (S7, not yet fixed); the dashboard is the scoring source for all data
  and exports only its own scores (docs/08 §8.5).
- Twins who share a secret code are detected by the survey's own ingest, which
  compares sittings collected under the same survey version. Twins who sat
  different versions are not detected automatically; the Participants page's
  "two sittings within a day" check catches the common case (twins sitting
  together), and the survey's Linkage tab is where they are separated.
- The Participants page and exports read every sitting to link them (cached for
  five minutes); "Re-link now" forces a fresh read.
- Browser tests run Chromium only here; WebKit/Firefox should be added to CI.
- The Hosting security headers (CSP, HSTS, frame-ancestors) in `firebase.json` are
  not applied by the emulators, so they have not been exercised against a live
  site. After the first deploy, sign in, open a session and run an export with the
  browser console open: a CSP violation there names the host to add.
- In-memory aggregation is designed for ≤ 20,000 sittings per study (tested); past
  ~50k, move aggregation to the Firestore→BigQuery extension.
- A removed role stops backend access within a minute; direct Firestore reads by an
  already-issued token continue until it expires (≤ 1 h) **unless** the email is
  also removed from the access list (effective immediately). Hence "do both" (§6).
- PDF reports use the built-in Helvetica (Windows Latin-1): characters outside it
  (for example emoji or non-Latin scripts in free text) are drawn as "?", and the
  report then says so. CSV/XLSX/BIDS exports carry full Unicode.
- Completion time uses the device's monotonic duration and excludes resumed
  sittings; `firstReceivedAt` for sittings that pre-date the dashboard is the
  backfill time (flagged `backfilled`). Device wall clocks can be wrong (flagged
  `clock_ahead` when detectably so).
- Notifications are in-app only (no email/push). No free-text search, by design.
- Light theme only (the survey style guide defines no dark theme).
- One study per deployment, as in the survey.
- The existing `apps/researcher` view in the survey repo still reads raw logs
  directly (audit F1); see recommended change S1.

## 14. Recommended next steps

1. Decide the open questions in [05-plan.md §5.3](05-plan.md) (test-code prefix,
   abandonment window, reviewer free text, Workspace domain).
2. Survey-side changes S1–S5 ([04-risks.md §4.2](04-risks.md)), S1 first.
3. Enable App Check for the web app, then `DASHBOARD_ENFORCE_APP_CHECK=true`.
4. Add the release-sync step to the survey's publishing workflow (or Survey
   Studio) so new versions register themselves.
5. Add WebKit to the e2e matrix; add a physical-tablet accessibility pass
   (VoiceOver), as the survey does for iPads.
6. Consider email digests of sessions needing review during fieldwork.
