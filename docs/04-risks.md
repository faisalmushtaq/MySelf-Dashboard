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
| S6 | **Done in the survey (r7.2.0, D-49), awaiting merge: [faisalmushtaq/MySelf#98](https://github.com/faisalmushtaq/MySelf/pull/98).** The survey's SWEMWBS and STAI-5 scoring definitions summed items `q1`…`q7` and `q1`…`q5`, but in every release those items are keyed `optimistic`…`mind` and `upset`…`confused`, so the survey's own `swemwbs raw_total` and `stai5 state_anxiety` are **always blank** in r1.0.0–r7.1.0. Definitions 1.0.1 use the real keys, r7.2.0 freezes them, and the survey's publish gate now refuses any definition that reads a name its form does not have | The survey's researcher view and exports had no SWEMWBS or STAI-5 totals (nothing shown to participants depends on them). Older releases keep the broken definitions, because a release is never edited: **the dashboard is the scoring source for all data** (decision 4a) — its schemes key on the real items for every release, and the BIDS export carries only its scores, never the survey's (docs/08 §8.5). `survey.test.ts` checks that on r7.2.0 the survey's own totals equal the dashboard's, sitting by sitting | Deploying r7.2.0 is the survey team's step (merge between fielding sessions); the dashboard reads r7.2.0 sittings as soon as the version is registered |
| S7 | Fix the survey's ingest (`packages/store/src/ingest.ts`, `scoreSession`): it hands the scoring executor a `null` for every name a step reads — earlier outputs included — and the executor reads a supplied name before an output, so a total built from subscales is always blank. The survey's own **SDQ total difficulties and RCADS total are blank in every sitting, in every release** (the definitions are right; the subscales are not affected). Fix: seed only names that are not an earlier step's output — a few lines, and a derived-data fix (a rebuild, not a migration or a new release) | Same as S6 for the survey's researcher view and exports; nothing shown to participants uses these totals (the participant app's copy of the same loop only scores EHI, which reads no outputs). The dashboard is unaffected: it scores with its own engine and never exports the survey's scores. `survey.test.ts` pins the current behaviour, so re-vendoring the fix will say so | Small change to the survey's store plus a test; **not implemented — needs the team's approval** |
| S8 | Fix the survey's RCADS-25 scoring definition (`packages/scoring/src/definitions.ts`, `scoreRcads25`): it counts item 18 ("I think about death", a generalised-anxiety item in the full RCADS) as depression and item 24 ("I feel restless", a major-depression item) as anxiety; the published RCADS-25 depression items are 1, 4, 8, 10, 13, 15, 16, 19, 21, 24 (docs/09 §9.3) | The survey's own RCADS depression and anxiety subscales are each off by one item in every version (the total is right). The dashboard's scheme was corrected in 1.1.0 and is what the dashboard reports and exports | A new scoring-definition version in the survey, frozen in its next release; **not implemented — needs the team's approval** |

## 4.3 Production data

No migration is proposed, and nothing in this repository writes to `(default)`. The
dashboard's first deployment runs a **read-only backfill** (`rebuildSummaries`) that
reads every sitting and writes summaries to the `dashboard` database. It is idempotent
and can be re-run; deleting the `dashboard` database removes every trace of it.
