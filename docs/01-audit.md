# 1. Audit of the existing MySelf system

Audited 2026-09-28 against `faisalmushtaq/MySelf` at `ee554ac` (main, after PR #97).
Every statement below cites the file it was read from. Nothing here is inferred
from a production database: this audit had no access to live Firestore, and none
was sought. Where the code cannot answer a question, it is listed as an **open
question** in [05-plan.md](05-plan.md#open-questions), not guessed at.

## 1.1 What the survey is

| Fact | Source |
|---|---|
| pnpm + TypeScript monorepo; React 18 + Vite 5 PWA; Node 22 | `package.json`, `apps/participant/package.json` |
| Participant app ("MySelf Go") deployed to GitHub Pages from `main` | `.github/workflows/pages.yml` |
| The Pages build **is** wired to Firebase project `myself-research` — the web config is baked in at build time | `pages.yml` (`MYSELF_FIREBASE_CONFIG`) |
| Backend is Firebase: Cloud Functions v2 (`europe-west2`), Firestore, Storage, Auth | `apps/functions/src/apps.ts`, `infra/firebase/firebase.json`, `docs/13-firebase.md` |
| A second project, `myself-identity`, is designed to hold names/DOB but **is not stood up** | `docs/13` §1, `docs/14` §8 |
| The survey definition is a **frozen, hashed release manifest** bundled into the app (currently `r7.1.0`) | `apps/participant/src/App.tsx:4`, `releases/*.manifest.json` |
| An existing in-browser "researcher view" (`apps/researcher`) pulls **every** raw sitting into the browser and derives the dataset there | `apps/researcher/src/lib/study.ts` (`pullSittings`) |

The participant does not authenticate. The **iPad** does, with a self-issued
device credential (`Device …` header) or anonymous Firebase Auth, and it can only
*write* through the `saveSitting` HTTPS function (`apps/functions/src/sittings.ts`).

## 1.2 Firebase configuration

- **Project:** `myself-research`; Firestore `(default)` database, location
  `europe-west2` (London) per `docs/13` §5. Location is permanent.
- **Functions:** codebase `default`, runtime `nodejs22`, region fixed in
  `apps.ts` (`REGION = "europe-west2"`), bundled by `build-deploy.mjs`.
- **Hosting:** the default site serves MyStory lab (`infra/firebase/firebase.json`).
- **Rules:** `infra/firebase/firestore.rules` (research), `identity.rules`,
  `storage.rules`; deployed by `.github/workflows/firebase.yml`; 20 emulator tests in
  `infra/firebase/test/rules.test.ts`.
- **Indexes:** one composite index (`sessions`: `quarantined` + `startedAt`) in
  `infra/firebase/firestore.indexes.json`.
- **Roles:** Firebase Auth **custom claim** `role` ∈ `owner | researcher | analyst`,
  set only by the owner-only callable `setRole` (`apps/functions/src/admin.ts`) or the
  bootstrap script `apps/functions/grant-role.mjs`. Devices carry `device: true`.
- **Study id:** single study per deployment, `MYSELF_STUDY` env, default `ybm`.

## 1.3 Firestore collections (research project)

From `packages/firebase/src/layout.ts` (`paths`) and `firestore.rules`:

```
studies/{study}/
  sessions/{sessionId}              one document per sitting, WHOLE EVENT LOG INLINE
    chunks/{0000…}                  only when a log exceeds ~700 kB (rare)
  quarantine/{sessionId__deviceId}  refused/contradicting copies, log as JSON string
  corrections/{id}                  mistyped-code repairs (append, then withdraw)
  assignments/{sessionId}           twin splits
  devices/{deviceId}                device registry / revocation
  audit/{id}                        survey-side audit (owner-read, append-only)
  narratives/{sessionId}            MyStory runs (not fielded)
  audit_testerLinks/{hash}          tester links (no client access)
  audit_uploads/{day_uid}           per-device upload meter (no client access)
```

### The sitting document (`SessionDoc`, `layout.ts`)

| Field | Type | Meaning / reliability |
|---|---|---|
| `sessionId` | string | Device-generated id (ULID-style), stable, also the doc id |
| `deviceId` | string | Installation id that filed it |
| `study` | string | e.g. `ybm` |
| `studyCode` | string | Code typed at start, pattern `^[A-Za-z]{3}[0-9]{4}$` ("NDC0042"): site letters + number. **Pseudonymous identifier.** |
| `releaseKey` | string | e.g. `ybm_nd2026_standard_r7_1_0` |
| `releaseHash` | string | `sha256:…` of the canonical manifest — **the survey version id** |
| `startedAt` | ISO string | **Device clock** |
| `completedAt?` | ISO string | **Device clock**, only when finished |
| `complete` | boolean | Set when the participant reached the end (`session.completed`) |
| `events[]` | array | Append-only log: `{seq, type, itemKey?, payload?, tWall, tMono}` |
| `chunkCount`, `eventCount` | number | Spill bookkeeping; `eventCount` never decreases (`conflictWith`) |
| `receivedAt` | ISO string | **Server clock** (function's `new Date()`), overwritten on every upload — i.e. *last received* |
| `quarantined` | boolean | Always present; set when a contradicting copy arrived |
| `provenance` | `"device" \| "imported"` | Uploaded by an iPad vs. imported from a handover file |

In-progress sittings **are** in Firestore: the device checkpoints running sittings
every few minutes (`apps/participant/src/lib/sync.ts`, `runningSessionsForCheckpoint`),
with `complete: false`. Sittings that never reach a network arrive later by file.

### Events actually written by the participant app

From `apps/participant/src/App.tsx` and `SurveyScreen.tsx`:
`session.started` (payload: `releaseHash`, `val_id` = study code),
`item.presented` (`visit`, `returning`, `tooFastMs`), `response.recorded` /
`response.changed` (`value`, `timing`), `response.too_fast`, `item.left`
(`totalDwellMs`, `visit`), `item.skipped`, `item.declined`, `navigation.back`,
`review.opened`, `review.edited`, `review.returned`, `hint.shown`, `skip.confirmed`,
`skip.abandoned`, `effort.checkin_shown/returned`, `effort.pace_prompt_shown`,
`response.inconsistent`, `session.suspended`, `session.resumed`, `session.completed`
(timing summary incl. `totalMs`, `foregroundMs`).

`itemKey` is `"<instrument>.<item>"`, e.g. `sdq25_s.q13`. Answer values are
tagged unions: `{kind:"choice",code}`, `{kind:"multi",codes}`, `{kind:"number",value}`,
`{kind:"text",value}`, `{kind:"date",iso}`, `{kind:"fields",values}`,
`{kind:"checkboxes",checked}`, `{kind:"group_rank",assignments}`
(`packages/engine/src/answers.ts`).

## 1.4 Sessions, answers, completion, timestamps, identifiers — how they are stored

| Question | Answer from the code |
|---|---|
| Is there a session id? | Yes — `sessionId`, stable, the document id. |
| Where are answers? | Inside the event log. The "current answer" is a replay (last statement wins) — `packages/store/src/ingest.ts` `replay()`. |
| Is there a completion status? | Only a boolean `complete` + `completedAt`. **No** in-progress/abandoned/incomplete distinction is stored. |
| Is there "shown" evidence? | Yes — `item.presented` per viewing. This is what lets branching-hidden and not-reached be told apart. |
| Timestamps? | Device clock for `startedAt`, `completedAt`, every `tWall`; monotonic `tMono` within an app session; server clock only in `receivedAt` (last upload) and the survey audit row `sittings.received` (which also stores `clockSkewMs`). |
| Participant identifier? | `studyCode` (researcher-issued, pseudonymous). The longitudinal `participantId` is **derived at analysis time** from identifying answers (mother's initials, house digit, birth month, postcode letters) — `ingest.ts` `deriveParticipantCode`. |
| Survey version on each response? | Yes — `releaseHash` + `releaseKey` on every sitting. |
| Stable question ids? | Yes — `instrument.item` keys (slugs, permanent by policy, `docs/06` §1), plus integer item `revision` and export `variable` in the manifest. |

## 1.5 The survey definition ("Survey Studio schema")

There is **no separate Survey Studio application yet**. What exists is the
definition layer a Studio would author, in `packages/schema`:
`assessmentDraft` → `releaseManifest` (`assessment.ts`), `itemDefinition`
(`item.ts`), `responseScale` (`response-scale.ts`), logic AST (`logic.ts`); and the
release builder + publish gate in `packages/release`. Releases are committed as
files to `releases/` and **bundled** into the app and the functions
(`apps/functions/src/releases.ts`). There is no releases collection in Firestore.

What the dashboard needs, and the manifest provides:

- sections (`composition.sections[]`, key + title + optional `displayIf`);
- components per section (instrument/module/narrative/screen, optional `displayIf`);
- items with `key`, `revision`, `variable`, `stem.text`, `responseType`,
  `required: hard | soft | optional`, `allowDecline`, `identifying`, `displayIf`,
  type-specific constraints (min/max, maxChars, pattern, scale);
- scales with option `code` (stable stored value) and `label` (display).

Release hashes are reproducible: `packages/release/src/canonical.ts` (sorted-key JSON,
`hash` excluded, SHA-256). Verified here for r7.1.0.

Existing releases: r1.0.0 … r7.1.0 (11 files incl. an unhashed `preview`
manifest). r1–r6 have **no `identifying` flags**; from r7.0.0, 7 items are marked
identifying. All share 9 sections; 146–148 items; 11–13 `hard`, 132–136 `soft`,
0–3 `optional`; ~21 item-level `displayIf` and one conditional section
(`social_media`, shown when `ybm_smartphone.sm_use` or `sm_use_confirm` = 1).

## 1.6 Security, privacy, consistency and compatibility findings

| # | Finding | Severity | Evidence |
|---|---|---|---|
| F1 | **Raw sitting logs in `(default)` contain names, date of birth and code components** as ordinary `response.recorded` events. `ingest` diverts them *after* reading, but the stored document holds them, and the rules let **any** owner/researcher/analyst read raw logs directly. The claim in `docs/13` §1 that "a child's name never passes through a researcher's laptop" is not true of the raw-log read path. | High | `firestore.rules` `sessions` `allow read: if isPerson()`; `apps/participant` has no identifying-item filter (`grep identifying` finds only `flatten.ts` markers); `apps/researcher/src/lib/study.ts` pulls whole logs |
| F2 | `setRole` grants a role to **any** Google account an owner names; there is no allowlist or domain check. | Medium | `apps/functions/src/admin.ts` `setRole` |
| F3 | Rules do not require `email_verified` or a Google sign-in provider for people. | Low | `firestore.rules` `isPerson()` |
| F4 | `startedAt`/`completedAt`/`tWall` are **device clock**; an iPad restored from backup can be hours out. Skew is logged server-side only in the survey audit row. | Medium (data quality) | `sittings.ts` `clockSkewMs` |
| F5 | `receivedAt` is overwritten on every checkpoint, so "first received" is not stored. | Low | `sittings.ts` `storeSitting` |
| F6 | No stored notion of abandoned vs in-progress; a checkpointed sitting that is never finished stays `complete:false` forever. | Medium (reporting) | `layout.ts` |
| F7 | No convention for **test sittings**. Tester links cannot file sittings (`sittingRefusal`), but a staff member typing a code on a real iPad produces a sitting indistinguishable from a participant's. | Medium (data quality) | `sittings.ts`, `docs/15` |
| F8 | Sittings under a release hash the reader does not bundle fall back to the **latest** manifest in the nightly export (`releasesByHash.get(hash) ?? latestRelease`). A dashboard must never do that — it would read one version through another. | Medium (consistency) | `apps/functions/src/export.ts` |
| F9 | The `preview` manifest has no hash; a sitting collected under it would carry `releaseHash: ""`. | Low | `releases/preview.manifest.json`, `App.tsx` (`manifest.hash ?? ""`) |
| F10 | The existing researcher view derives everything by reading **every** sitting into the browser (~54 kB each). Fine at a few hundred sittings, unbounded as the study grows, and it moves raw logs (F1) onto laptops. | Medium (scale/privacy) | `study.ts` `pullSittings` |
| F11 | One Firestore ruleset and one Storage ruleset exist per database/bucket. A second repository that deploys `firestore:rules` for `(default)` would **silently replace** the survey's rules. | High (deployment) | Firebase platform behaviour |
| F12 | Items can become eligible after they were passed (a participant edits an answer from the review screen, which returns to the review rather than walking forward), so "finished" does not imply "every eligible question was shown". | Medium (completeness) | `App.tsx` `advance` (`fromReview`) |
| F13 | `hard`-required items cannot be skipped; `soft`-required items can, after confirmation; `optional` can be skipped freely. Declining is an explicit control where `allowDecline`. | — (semantics) | `SurveyScreen.tsx:233,260` |

None of these is a reason to change production data. F1, F2 and F11 shape the
dashboard's architecture (§2); F4–F9 and F12–F13 shape the completeness rules (§3).
