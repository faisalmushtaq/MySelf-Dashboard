# 2. Architecture and access model

## 2.1 Shape of the system

```
myself (existing repo — unchanged)
  apps/participant      public survey (GitHub Pages), writes via saveSitting
  apps/functions        codebase "default": saveSitting, setRole, exports…
  Firestore (default)   studies/{study}/sessions/…   ← raw event logs (survey-owned rules)

MySelf-Dashboard (this repo — separate app, same Firebase project)
  packages/core         pure TypeScript domain: manifest index, replay, completeness,
                        statuses, analytics, query model, CSV. No Firebase imports.
  apps/functions        codebase "dashboard", europe-west2:
                          - trigger: (default) sessions → de-identified summaries
                          - callables: query, detail, analytics, reviews, exports, admin
                          - HTTPS: authenticated export download
                          - scheduled: export cleanup
  apps/web              React + Vite SPA on its own Hosting site
  Firestore "dashboard" named database — dashboard-owned rules and indexes
  Storage               dashboard-exports/** (client access denied by the existing
                        catch-all; downloads only through the authenticated function)

MySelf Studio           the survey's one editor and publisher: versions, live
                        pointer, manifests and audit in (default) studies/{study}/;
                        the functions read them, never write (§2.6, docs/11)
```

### Why a separate **named** Firestore database

Firestore has **one ruleset per database** (audit F11). If this repository deployed
`firestore:rules` to `(default)` it would replace the survey's rules — and the next
survey deploy would replace ours. Putting dashboard data in a second database in the
same project (`dashboard`, created once in `europe-west2`) means:

- each repository deploys only its own rules and indexes, and cannot clobber the other;
- a mistake in dashboard rules cannot open participant raw logs;
- **no survey-side change is required** for the dashboard to run.

The dashboard never reads `(default)` from a browser. Its backend reads raw logs with
the Admin SDK (server-side, europe-west2) and writes de-identified summaries into
`dashboard`. Trade-off: a second database is outside Firestore's free tier; at this
study's volume (≈1–3 KB per summary, thousands of sittings) the cost is pennies a month
on the Blaze plan the project already requires (`docs/13` §6).

### Why a backend for reads, not only Security Rules

Rules can say *who may read a document*; they cannot remove fields from it, redact an
identifying answer inside an event log, compute a median, or apply "reviewers see
free text only if policy allows". Those are exactly the controls this dashboard needs
(audit F1). So:

| Data | Path | Enforced by |
|---|---|---|
| Session list, search, sort, pagination, prev/next | callable `querySessions` / `getSessionDetail` | backend role check + rules deny direct access to summaries |
| Session answers (redacted) | callable `getSessionDetail` | backend: identifying answers never leave the server; free text per role policy; every view audited |
| Overview / completeness / question analytics | callable `getAnalytics` | backend, computed from summaries |
| Review status, flags, notes | read: direct (rules); write: callables `updateReview`, `addNote` | rules deny client writes; backend checks role and writes review + audit in one transaction |
| Saved views | direct read/write | rules (owner-only write; `shared` requires researcher/admin; reviewers may read shared) |
| Export jobs | callable `createExport`; progress: direct read of the job doc | backend; rules let only the requester (or an admin) read the job |
| Release registry | direct read | rules (any dashboard role) |
| Audit log | direct read | rules: admin reads all; everyone else only their own entries; no client writes |
| Access policy, roles | callables `getAccessPolicy`, `updateAccessPolicy`, `setDashboardRole`, `listPeople` | backend (admin only) + rules (admin read, no client write) |

This keeps "access is enforced by Security Rules, not only by the interface" true in
the strong sense: a researcher who opens the browser console and calls Firestore
directly gets exactly what the rules tests say, and no more.

## 2.2 Authentication and authorisation

- **Sign-in:** Firebase Authentication, Google provider, `signInWithPopup`.
  `authDomain` is set to the dashboard's own Hosting domain so the auth handler is
  same-origin (third-party-cookie safe; the reason is the same one `docs/13` §5.2 gives
  for the lab).
- **Which studies** a dashboard user sees: every study for an Administrator; the
  default study for everyone; another study when its own list names them. Checked
  by the backend on every call and by the rules on every read under
  `studies/{study}/` ([12 §12.4](12-studies-and-surveys.md)).
- **Who is a dashboard user:** a Google account that (1) has a verified email,
  (2) signed in with the `google.com` provider, (3) carries a `role` custom claim, and
  (4) whose email is on the **access policy** — an explicit allowlist
  (`brainpopresearch@gmail.com` seeded) and/or an allowed Google Workspace domain.
  All four are checked by the backend on every call **and** by the rules on every
  direct read (`get()` of `config/access`).
- **Roles reuse the survey's existing claim**, so one person has one role across the
  platform:

  | Dashboard role | `role` claim | Can |
  |---|---|---|
  | Administrator | `owner` | everything below + manage access, policy, rebuilds, JSON exports, read full audit |
  | Researcher | `researcher` | view all permitted data, free text, study codes; review (flags, notes, status); save & share views; create session-level exports |
  | Read-only reviewer | `analyst` | view data (study codes masked; free text per policy, default hidden); private saved views; aggregate exports only |

- **Roles are configured without code changes:** Settings → Access (admin) calls
  `setDashboardRole`, which refuses any email not allowed by the access policy, sets the
  claim, revokes refresh tokens and audits the change. The survey's own `setRole` still
  works; the dashboard's allowlist check means a role granted there to a non-allowlisted
  account still cannot use the dashboard (defence in depth, audit F2).
- **Nobody can grant themselves anything:** claims are set only by the Admin SDK; the
  rules deny every client write to `config/**`, `users/**`, and the audit log.
- **Bootstrapping** the first administrator uses `scripts/bootstrap-admin.mjs` with
  application-default credentials, exactly like the survey's `grant-role.mjs`.
- **No service-account keys in the browser.** The web app holds only the public web
  config. Functions use their runtime identity.

## 2.3 Data model in the `dashboard` database

All study data is nested under `studies/{study}`, one space per study the survey
runs in the project (`ybm`, and any study space created in MySelf Studio;
[12-studies-and-surveys.md](12-studies-and-surveys.md)); the dashboard's access list
is global, and the default study's settings stay in `config/`.

```
config/access                         { emails[], domains[], defaultStudy, updatedAt, updatedBy }
config/policy                         { abandonAfterHours, testCodePatterns[],
                                        reviewerCanViewFreeText, exportRetentionHours,
                                        timeZone, tooFastWarningCount }
users/{uid}                           { email, role, lastSignInAt } (mirror, for admin UI)
studies/{study}/
  config/access, policy, groups       another study's own access list and settings (docs/12 §12.3)
  releases/{releaseHash}              { key, version, publishedAt, manifestJson, verified,
                                        provenance? (a version registered from MySelf Studio) }
  sessionSummaries/{sessionId}        de-identified, derived; backend-only
  meta/freshness                      { lastSummaryAt, lastSessionReceivedAt, summaryCount,
                                        rulesVersion }
  reviews/{sessionId}                 { status, flags[], qualityConcerns[], markedTest,
                                        markedInvalid, lastReviewedAt/By, updatedAt/By, rev }
  reviews/{sessionId}/notes/{noteId}  { text, authorUid, authorEmail, createdAt } append-only
  savedViews/{viewId}                 { name, ownerUid, shared, state, createdAt, updatedAt }
  exportJobs/{jobId}                  { requestedBy, kind, format, spec, preview, status,
                                        progress, fileName, bytes, expiresAt, error }
  auditLog/{eventId}                  { at, actorUid, actorEmail, actorRole, action,
                                        target, detail, outcome }
```

Participant responses stay in `(default)`; researcher notes and flags live in a
different database, so a review can never modify a response (brief §3, §9).

### Session summary (derived, de-identified)

Written by the `onSessionWritten` trigger whenever a sitting document changes, and by
`rebuildSummaries` (admin) for backfill or after a rules change. Contains facts, never
answers to identifying items and never free text:

- identity & version: `sessionId`, `studyCode`, `releaseHash`, `releaseKey`,
  `releaseVersion`, `releaseKnown`, `provenance`, `quarantined`, `unreadable`;
- time: `startedAt`, `completedAt`, `lastActivityAt` (device), `receivedAt`,
  `firstReceivedAt` (server), `durationMs`, `foregroundMs`, `wallClockMs`, `resumedCount`;
- completeness facts (§3): counts, `requiredCompletion`, `estimated` + reasons, per-section
  results, `missingRequiredKeys`, `invalidKeys`, `lastPresentedKey`, `finalSectionKey`;
- data-quality signals: `warnings[]`;
- compact per-question outcomes `items{key: [outcomeCode, value?]}` — `value` only for
  numeric/choice codes of non-identifying, non-free-text questions;
- `rulesVersion`, `updatedAt` (server timestamp).

Status is **not** stored: "abandoned" depends on the current time and "needs review"
on review state, so it is derived when read (§3.4).

## 2.4 Aggregation and scale

Expected scale: hundreds to low thousands of sittings per study year (`docs/13` §6
sizes the study at ~1,000). The design target is **20,000 sittings per study** with
headroom; the code is tested at that size.

- Every read path goes through a function instance that keeps summaries and reviews
  **in memory** and brings them up to date with a **delta query**
  (`updatedAt > last seen`) at the start of each request. A warm instance pays one
  cheap query per request; a cold one reads all summaries once (20k × ~3 KB ≈ 60 MB).
- Filtering, sorting, pagination, neighbours and every metric are computed there, with
  the same `@myself-dashboard/core` functions the unit tests exercise. Arbitrary
  combinations of filters therefore need no composite-index explosion.
- **No browser ever loads the response database**, and no request is unbounded: pages
  are ≤ 200 rows, analytics responses are aggregates.
- Beyond ~50k sittings per study the in-memory model should give way to the Firestore →
  BigQuery export extension with scheduled SQL aggregates. Not introduced now: it adds a
  data warehouse, a second copy of the data under a different access model, and cost,
  for a volume this study does not have.

## 2.5 Exports

1. The client asks `previewExport(spec)`: session count, versions, date range, fields,
   free-text and identifier inclusion, warnings (e.g. incompatible versions, free text).
2. The user confirms in a dialog that shows all of that plus a privacy warning.
3. `createExport(spec)` re-checks the role **server-side** against the spec (free text,
   study codes, JSON, row-level), creates `exportJobs/{id}`, generates the file in
   batches while updating `progress`, writes it to `dashboard-exports/{jobId}/…` in
   Storage, audits it and returns. The client watches the job document for progress.
4. Download: `downloadExport` (HTTPS) verifies the ID token, the requester (or an
   admin), the job's status and expiry, streams the file, and audits the download.
   Nothing is ever public; there are no long-lived URLs.
5. `cleanupExports` (hourly) deletes files past `exportRetentionHours` (default 24) and
   marks jobs `expired`.

Formats: BIDS (the default for session data: a zip laid out as the survey's own
export, with `linkage.tsv` when identifiers are included), CSV (with formula-injection
neutralisation), XLSX, PDF (session report, completeness report), JSON (administrators
only). Identifying items (names, dates of birth, UPN, NHS number, the secret-code
answers) are **never** exported by this dashboard — they belong to the identity project.
Participant codes and waves are included unless the user chooses "de-identified"; study
codes only when the role also allows them.

PDF reports are laid out on the server (`exporters/report.ts`, a small kit on pdfkit:
running head and "Page N of M" footer, key-figure tiles, ruled tables that repeat their
header across pages, bars with Wilson intervals, callouts). The completeness report
embeds Figure 1 from the publication renderer as vectors (`svg-to-pdfkit`), floated to
the next page rather than leaving a gap. The session report groups answers by section
in the participant's own version's wording, highlights missing required answers, and
sets the researcher review (flags, notes) apart from the answers.

## 2.6 Survey versions and MySelf Studio

The registry `studies/{study}/releases/{releaseHash}` holds every manifest the study
has published. Releases from the repository reach it through
`scripts/sync-releases.mjs` (or Settings → Survey versions), which validates each
manifest, **recomputes its hash with the survey's canonicalisation and refuses a
mismatch**, and uploads it.

Survey versions are edited and published in **MySelf Studio**, in the survey's
researcher view (survey docs/16). Studio writes each version to the survey's own
database; nothing has to copy it here. When a sitting arrives under a hash the
registry does not hold, the summary trigger reads Studio's copy,
`publicReleases/{hashHex}`, checks that it hashes to that hash with the survey's
own canonical code, and registers it with its provenance. A copy that fails is
refused and audited. The Survey versions page reads Studio's version records,
live pointer and audit trail, read-only ([docs/11](11-survey-editor.md)). The
dashboard writes nothing to the survey's database.

The dashboard never reads a sitting through a manifest other than its own. A sitting
whose `releaseHash` is in neither the registry nor Studio is shown with completeness
**unavailable** (never through the "latest" manifest — audit F8).

## 2.7 Technology choices

Kept identical to the survey where it matters, so one team can maintain both:
TypeScript (strict), pnpm workspaces, React 18, Vite 5, Firebase JS SDK 11,
firebase-admin 13, firebase-functions 6 (v2 API), zod 3, Vitest 2, Playwright. Added
only where there was no equivalent: `react-router-dom` (URL state), `exceljs` (XLSX,
server-side), `pdfkit` + `svg-to-pdfkit` (PDF, server-side). Charts are small hand-written SVG components
so every chart has a proper accessible name, a data table twin and no third-party
analytics or CDN. Visual language follows the survey's binding style guide
(`docs/11-style-guide.md`, D-17) as the survey's researcher view applies it
(`apps/researcher/src/styles.css`): Inter (self-hosted), near-white canvas, black
text with a muted grey `#6b6b68` for labels and notes, hairline borders, one accent
`#067843`, category accents `#1e6091`, `#964f8c`, `--warn #A33B00`.

## 2.8 Hosting

A second Hosting **site** in `myself-research` (e.g. `myself-research-dashboard`) with
its own deploy target, so `firebase deploy --only hosting:dashboard` cannot touch the
lab site. Strict security headers (CSP limited to Firebase endpoints, `frame-ancestors
'none'`, `Referrer-Policy: no-referrer`, HSTS). Functions deploy as codebase
`dashboard`, so the survey's `firebase deploy --only functions` never deletes them and
ours never deletes the survey's.
