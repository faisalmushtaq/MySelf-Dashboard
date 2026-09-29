# 4. Security and data-model risks, and survey-side changes

## 4.1 Risks and how the dashboard handles them

| Risk | From | Handling in this dashboard |
|---|---|---|
| Raw logs carry names/DOB/code components (identifying items) | Audit F1 | The browser never reads raw logs. Summaries omit identifying values; `getSessionDetail` replaces them with "withheld"; exports never include them. |
| Anyone given a role anywhere can use the dashboard | F2 | Allowlist/domain policy checked by backend and rules; roles granted through the dashboard refuse non-allowlisted emails. |
| Unverified or non-Google identities | F3 | Rules and backend require `email_verified` and provider `google.com`. |
| Device clock wrong | F4 | Date filter names its timestamp; "received (server clock)" is available; a sitting that started after the server received it is flagged `clock_ahead`. |
| No first-received time | F5 | Summaries record `firstReceivedAt` the first time the trigger sees a sitting. For sittings that pre-date the dashboard it is the backfill time, flagged `backfilled`. |
| No abandoned state | F6 | Derived at read time from the abandonment window (policy). |
| Test sittings indistinguishable | F7 | Policy `testCodePatterns` + researcher "mark as test". **Needs a team convention** (Q3). |
| Reading one version through another | F8 | Never. Unknown version ⇒ completeness *unavailable*. |
| Unhashed preview manifest | F9 | A sitting with an empty/unknown hash is `releaseKnown: false`. |
| Unbounded browser reads | F10 | Paginated callables over an in-memory server cache with delta sync; no client access to summaries. |
| Clobbering the survey's rules | F11 | Separate named database; the dashboard deploys only `firestore:dashboard` rules/indexes. |
| Eligible questions never shown after review edits | F12 | Outcome `eligible_not_shown`, counted as missing, labelled distinctly. |
| CSV/Excel formula injection | brief §9 | Every text cell starting with `= + - @` TAB or CR is prefixed with `'`; covered by tests. |
| Response data leaking to logs/analytics | brief §9 | No third-party analytics; no `console.log` of answers (lint rule); function logs carry ids and counts only. |
| Identifiers in URLs | brief §9 | URLs carry filters, session ids (random, non-identifying) and view ids only. Search text is kept in session storage, never in the URL or saved views. |
| Export files outliving their purpose | brief §7 | Private Storage path, authenticated download only, 24 h retention, hourly cleanup, audited. |
| Named-database cost | §2.1 | Outside the free tier; pennies at this volume. |
| Custom-claim changes take up to an hour | Firebase | `setDashboardRole` revokes refresh tokens; the backend re-reads claims per call, so a removed role stops working on the next request that refreshes its token. Admin UI says so. |
| Domain allowlist and consumer "conflict" accounts | Google | Domain access is safe only for a managed Workspace domain; the setting says so. The explicit email allowlist is the primary control. |

## 4.2 Survey-side changes

**None is required for the dashboard to work.** It reads `(default)` only through its
own backend's Admin SDK and writes only to its own database, Hosting site and functions
codebase.

The following are **recommended, documented here, and not implemented** — each changes
the survey repository or production behaviour and needs the team's approval:

| # | Change | Why | Cost / risk |
|---|---|---|---|
| S1 | Restrict direct client reads of `studies/{study}/sessions/**` in `(default)` to `owner` (or to no client), once the old researcher view is retired | Closes F1 for the raw-log path: analysts and researchers can currently read children's names from raw logs with a browser console | Breaks `apps/researcher`'s `pullSittings` for non-owners; needs the old view retired or moved behind a function |
| S2 | Reserve a test code prefix (e.g. `TST0001`–`TST9999`) in the fielding runbook | Makes test sittings reliably separable (F7) | Documentation only |
| S3 | Add `firstReceivedAt` (set once) to the sitting document in `storeSitting` | Server-clock creation time (F5) | Small change to `sittings.ts`, additive, tests exist |
| S4 | When Survey Studio publishes a release, also write it to the dashboard registry (or run `scripts/sync-releases.mjs` in the survey's release workflow) | New versions appear in the dashboard without a manual step | CI change in the survey repo |
| S5 | Add the allowlist check to the survey's `setRole` | Consistency with the dashboard (F2) | Small change to `admin.ts` |
| S6 | Fix the survey's SWEMWBS and STAI-5 scoring definitions (`packages/scoring/src/definitions.ts`): they sum items `q1`…`q7` and `q1`…`q5`, but in every release (r1.0.0–r7.1.0) those items are keyed `optimistic`…`mind` and `upset`…`confused`, so the survey's own `swemwbs raw_total` and `stai5 state_anxiety` are **always blank** (proven by `packages/core/src/survey/survey.test.ts`) | The survey's researcher view, its exports and anything read back to participants from these scores are empty; the dashboard's own schemes (docs/08) already key on the real items, so dashboard scores and exports are unaffected | A new scoring-definition version in the survey; releases carry their scoring frozen, so already-published releases keep the broken definition — which is why the dashboard scores from its own schemes rather than the release's |

## 4.3 Production data

No migration is proposed, and nothing in this repository writes to `(default)`. The
dashboard's first deployment runs a **read-only backfill** (`rebuildSummaries`) that
reads every sitting and writes summaries to the `dashboard` database. It is idempotent
and can be re-run; deleting the `dashboard` database removes every trace of it.
