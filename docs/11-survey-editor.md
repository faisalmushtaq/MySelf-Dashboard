# 11. The survey editor

Change the survey from the dashboard, see exactly what changed, and publish it
as a new, correctly numbered version that iPads pick up for their next sitting.
Every version's history can be extracted.

The survey's side of this (how a device picks its version, where published
versions live, MyStory) is its decision D-54, in its docs/06. This document is
the dashboard's side.

## What it is for

- **Edit** a draft that starts from any published version. Change wording,
  answer options, which sections and questions are asked and in what order,
  required levels, screens, and whether the version ends with MyStory, including
  the protocol and its TOML.
- **See the change**: every difference from the base version, marked as
  participant-visible or researcher-only, and the version number that follows
  (survey docs/06 §3). Preview the draft in the real participant app.
- **Publish**, owners only. The draft goes through the survey's own release
  builder and publish gate, is frozen and hashed, registered, and made the
  version new sittings use.
- **Keep track.** A Versions page lists every version: when it was active, what
  changed from the one before, who published it and why, and how many sittings
  it collected. It exports all of that as CSV or JSON. Making an earlier version
  active again is the rollback.

## How a draft is edited: unfreeze, change, rebuild

A published manifest already holds everything that built it:
- its composition, which is the draft;
- the frozen instruments (the administered form only);
- its scales, scoring and MyStory protocols;
- its assets.

So a draft is *unfrozen* from a base manifest. Edits are applied to that
content, and publishing *rebuilds* it with the survey's `buildRelease`, the
function `publish.mjs` uses. This gives three guarantees:

1. **Nothing the editor does bypasses the publish gate.** Licences, unresolved
   references, bands, pipes, scoring references, assets and the MyStory protocol
   checks all run on every publish.
2. **The editor needs no copy of the survey's question library.** It works from
   what was actually fielded.
3. **Rebuilding an unedited draft reproduces the base manifest byte for byte**,
   apart from the release block. A test holds this for every committed release.

The builder is vendored from the survey (`packages/release`: `builder.ts`,
`canonical.ts`), with the MyStory protocol code it needs (`packages/narrative`).
`scripts/check-vendored.mjs` checks them like the rest of the vendored code.

## Edits the editor offers

| Change | Where | Counts as |
|---|---|---|
| Question wording, lede, help text | study-owned modules (`ybm_*`) only | participant-visible |
| Answer option labels, add an option | study-owned scales only; the editor lists every question sharing the scale | participant-visible |
| Required level (hard/soft/optional), allow "prefer not to say" | where the instrument's fidelity flags allow | participant-visible |
| Leave out / restore a question, a component or a section | any | participant-visible |
| Reorder components within a section, or sections | any | participant-visible |
| Add a question (single choice, multiple choice, short or long text, number) | study-owned modules | participant-visible (new variable) |
| Show-only-if condition (question is / is not an option) | new and edited questions; existing complex conditions are shown read-only | participant-visible |
| Screens (welcome, finish, review and the others) and the study label | any | participant-visible |
| MyStory on or off, protocol choice, protocol TOML | the final section | participant-visible |
| Variable names and labels for new questions, release notes | any | researcher-only |

Licensed instruments whose licence forbids modification (`modifiable: no`) can
be left out or restored, never reworded. The editor says why.

## The version number

`nextVersion(base, changes)` in `packages/core/src/editor/version.ts`:
- **MAJOR** if any change is participant-visible (survey docs/06 §3: wording is
  never a PATCH);
- **MINOR** if there are only additions that leave every existing path alone;
- **PATCH** for metadata only.

The page shows the reason for the level it chose. An owner may raise the level,
never lower it.

## Data

Dashboard database (the backend writes; the web reads through the functions):
- `studies/{study}/surveyDrafts/{draftId}`: `{ name, baseHash, edits, updatedAt,
  updatedBy, status }`. `edits` is the list of changes, in order, so a draft
  can be replayed, reviewed and reverted one change at a time.
- `studies/{study}/releases/{hash}` and `releaseManifests/{hash}`: the existing
  registry. Its metadata gains `source: "editor" | "repository"`, `baseHash`,
  `notes`, `changes` (summary), `bump`, `bumpReasons` and `publishedBy`.
- `studies/{study}/releaseActivations/{id}`: `{ hash, version, activatedAt,
  activatedBy, reason }`, one row per activation. When each version was live is
  read from these rows.

Survey database (written by `publishSurveyVersion` and `activateSurveyVersion`
with the Admin SDK; see survey D-54): `studies/{study}/releases/{hash}` and
`studies/{study}/config/activeRelease`.

## Functions

| Callable | Who | Does |
|---|---|---|
| `listSurveyVersions` | any dashboard role | versions, activation history, sittings per version, changes from the previous |
| `getSurveyDraft` / `saveSurveyDraft` / `deleteSurveyDraft` | researcher, owner | drafts |
| `previewSurveyDraft` | researcher, owner | applies the edits, runs the builder, and returns the draft manifest, the gate's problems, the diff and the next version |
| `publishSurveyVersion` | owner | rebuilds, writes both databases, makes the version active, audits |
| `activateSurveyVersion` | owner | makes an earlier version active again (the rollback), audits |
| `exportSurveyProvenance` | any dashboard role | every version's provenance, as CSV and JSON |

## Pages

- **Survey → Versions**: the history and provenance, active version, rollback,
  exports, and each version's manifest to download.
- **Survey → Editor**: a draft beside its base.
  - Sections and components as an outline.
  - A question's wording and options edited in place.
  - A MyStory panel: on or off, the protocol, and its TOML with live checks.
  - A changes list with the version it implies.
  - Preview, which opens the participant app in preview mode with the draft.
  - Publish.

## Tests

- **Round trip:** every committed release unfreezes and rebuilds unchanged.
- **Each edit** has its own test. Among them: the version number on each kind of
  change; the licence refusal; MyStory placement and protocol checks; the gate
  refusing a broken draft.
- **The functions**, against the emulators: roles, both databases written,
  activation history, audit rows.
- **End to end:** edit, preview, publish, and a device picks the new version.
