# 3. Completeness and status — definitions

These rules are implemented once, in `packages/core/src/completeness.ts` and
`packages/core/src/status.ts`, and every number in the dashboard comes from them.
The same text is shown in the app (Help, and the ⓘ beside each metric). Rule set
version: **`completeness@1`** — stored on every summary so a change of rules is a
visible rebuild, not a silent drift.

## 3.1 Inputs

For one sitting:

1. its **own** release manifest, found by `releaseHash` in the registry — never another
   version's;
2. its event log, replayed in `seq` order (last statement about an item wins — the same
   rule the survey's `ingest` uses);
3. the policy (`config/policy`): which `required` levels count, abandonment window,
   test-code patterns.

**Questions** are the manifest's items in section → component → item order, excluding
`info` items, instrument-instruction screens and narrative markers (which are not
questions — `apps/participant/src/lib/flatten.ts`). A question's stable id is
`instrument.item` (e.g. `sdq25_s.q13`). Its display condition is the conjunction of the
section's, the component's and the item's `displayIf`, exactly as `flattenManifest`
builds it. Conditions are evaluated with a verbatim copy of the survey engine's
`evaluate()` (vendored with its source commit).

## 3.2 What happened to each question — the outcome taxonomy

Each question in the sitting's version gets exactly one outcome:

| Outcome | Meaning | Counts as |
|---|---|---|
| `answered` | A valid answer is recorded. Includes a **legitimately empty** value the definition allows (e.g. multi-choice with `minSelections: 0`), marked "empty (allowed)". | resolved |
| `declined` | The participant used the explicit "prefer not to say" control (`allowDecline`). | resolved |
| `invalid` | A value is recorded but does not satisfy this version's definition: unknown option code, out of range, too long, wrong pattern, wrong answer kind, or unparseable (**corrupted**). | missing |
| `skipped` | Shown, and the participant chose to leave it blank. | missing |
| `no_response` | Shown, but left with no answer and no skip (moved back, app closed). | missing |
| `not_reached` | Eligible, never shown, sitting **not** finished. | missing |
| `eligible_not_shown` | Eligible under the final answers, never shown, sitting **finished** — happens when an answer is changed from the review screen (audit F12). | missing |
| `hidden_branching` | Not eligible under the final answers and never shown: **valid skip logic**. | excluded |
| `answered_hidden` | Answered, then made ineligible by a later change of an earlier answer. The answer is kept and shown, but not counted. | excluded |
| `undetermined` | Its display condition depends on a question the participant never reached, so whether it *would* have been shown is unknowable. | excluded, and the result is marked **estimated** |

Two further states apply across versions, never within one:

| Outcome | Meaning |
|---|---|
| `not_in_version` | The question does not exist in the version this sitting used — added later or removed earlier. **Data never collected**, not missing. |
| `unavailable` | The sitting's version is not in the registry; nothing about its questions can be said. |

"Shown" is taken from `item.presented` events. For a log that has none (legacy
builds), shown is inferred from response events, and the result is marked
**estimated** with the reason `no_presentation_events`.

**Identifying questions** (`identifying: true`: names, date of birth, code components)
get an outcome like any other — so completeness is right — but their **values never
leave the server**: the dashboard shows "withheld (identifying)".

## 3.3 The formulas

For a sitting with a known version:

- **Required questions** = questions whose `required` level is in the policy's
  `requiredLevels` (default `hard` and `soft`) **and** whose outcome is not excluded
  (not `hidden_branching`, `answered_hidden`, `undetermined`).
  `soft` counts because it is the survey's default for expected questions: the app lets
  a participant skip it after confirming, which is exactly a missing required answer.
  `hard` questions cannot be skipped in the app at all.
- **Required answers completed** = required questions with outcome `answered` or
  `declined`.
- **Required completion %** = completed ÷ required × 100. If there are no required
  questions: *not applicable*.
- **Estimated** when any required-level question is `undetermined`, or the log has no
  presentation events. Shown as "≈ 72%", with the reason. Never shown with decimals.
- **Section completion** = the same ratio restricted to the section's questions. A
  section none of whose questions was eligible is "not applicable" (e.g. *Your social
  media* for a participant without a smartphone), not 0%.
- **Answered rate** (secondary) = answered ÷ all eligible questions incl. optional.
- **Drop-off point** = the last question shown, for sittings that did not finish.

A sitting whose version is unknown has completeness **unavailable** — no number is
shown rather than a wrong one.

## 3.4 Session status

A sitting has one **lifecycle** status and zero or more **markers**.

**Terminal** means the survey reached its end: `complete: true` on the sitting, or a
`session.completed` event in its log.

| Lifecycle | Rule |
|---|---|
| Not started | not terminal, and no question has any response (answered, skipped, declined) |
| In progress | not terminal, has responses, and the study heard from it (server `receivedAt`) within the abandonment window (default **24 h**) |
| Abandoned | not terminal, has responses, and not heard from for longer than the window |
| Incomplete | terminal, with ≥ 1 missing required answer |
| Complete | terminal, with no missing required answers (or version unknown — then completeness shows "unavailable") |

| Marker | Rule |
|---|---|
| Invalid | quarantined by the survey (two contradicting copies), log unreadable (missing chunks), or marked invalid by a researcher |
| Test session | study code matches a test pattern in the policy (proposed default: codes starting `TST` or `ZZZ`), or marked as test by a researcher |
| Needs review | review status is *Needs review*; or an open flag; or — while the review is still *Unreviewed* — an automatic data-quality signal (invalid answers, unknown question ids, device clock ahead of the server, too-fast answers ≥ policy threshold) |

The badge shows the most severe marker (Invalid › Test › Needs review), otherwise the
lifecycle, and always names the lifecycle beside a marker ("Needs review · Incomplete").
**Filtering by a lifecycle includes sittings that also carry a marker**; filtering by a
marker matches the marker. By default the dashboard shows **production** data only
(test sittings excluded; a toggle includes or isolates them).

## 3.5 Overview metrics

| Metric | Definition |
|---|---|
| Sessions started | Sittings in the current filters |
| Completed / Incomplete / Abandoned | Lifecycle counts |
| Sessions requiring review | Needs-review marker count |
| Completion rate | Complete ÷ (Complete + Incomplete + Abandoned). In-progress, not-started and invalid sittings are excluded — they have not had, or cannot be judged to have had, the chance to finish. |
| Median completion time | Median device-measured duration (monotonic clock) of complete sittings that were **never resumed** — a resumed sitting's timer covers only its last stretch (`docs/06`, `durationMs`). Shows *n*; hidden below 5. |
| New in period | Sittings the server first received inside the date range |
| Most recent response | Latest device `tWall` of any response, with the server's latest receipt beside it |
| Data last refreshed | When summaries were last written, and when this view was computed |
| Active published version | The policy's active release, else the newest release in the registry |

**Date filters** state which timestamp they use: session start (default), completion,
last activity (all device clock), or received (server clock). Days are bucketed in the
study time zone (default `Europe/London`).

## 3.6 Question-level measures (one version at a time)

For each question in the selected version, over sittings of that version in the filters:
eligible, undetermined, shown, answered, declined, skipped, no response, not reached,
invalid, **response rate = answered ÷ shown**, **coverage = answered ÷ eligible**,
drop-offs (unfinished sittings whose last shown question was this one), and for
choice/scale questions the distribution **by stored option code**, labelled with this
version's labels. Free-text questions show counts only.

## 3.7 Across versions

Questions are matched **only by stable id**. For each pair of versions the comparison
reports: added, removed, and for shared ids — wording changed, answer type changed,
option codes added/removed, option labels changed, `required` changed, display
condition changed, revision changed. Pooling is:

- **compatible** — nothing but metadata changed;
- **caution** — wording or labels changed (codes identical): pooled only with the
  warning visible;
- **incompatible** — type or option codes changed: never pooled; shown side by side.
