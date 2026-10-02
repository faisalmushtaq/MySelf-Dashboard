# 11. Survey versions

**Survey → Survey versions** is a read-only record of every version of the
survey: who wrote and published it, what changed, whether it ends with MyStory,
when it was the version the iPads ran, and how many sittings the dashboard has
recorded under it. Its history exports as CSV or JSON.

Versions are edited, previewed and published in **MySelf Studio**, in the
survey's researcher view (survey docs/16). The page says so and links there.
Nothing on it changes what the iPads run.

## Why the dashboard no longer edits the survey

This branch once carried a survey editor in the dashboard that published live
versions (survey decision D-54). Meanwhile the survey gained MySelf Studio,
which edits, versions and publishes survey versions itself, with preview,
history, rollback and an audit trail.

Two publishers would each decide what the iPads run, and each would have its
own idea of which version is live. The research team chose Studio as the one
editor and publisher. So the dashboard's editor was retired before it was ever
deployed, and D-54 was removed on the survey side too. What went:

- the editor pages, the draft, preview, publish and make-active callables, and
  the editor model;
- every write to the survey's database (`releases/{hash}`,
  `config/activeRelease`) and the dashboard collections `surveyDrafts`,
  `releaseActivations` and `meta/surveyPublishing`, which were never in
  production;
- the vendored release builder and MyStory protocol code it needed;
- the capabilities `survey.edit` and `survey.publish`. One read capability,
  `survey.versions`, replaces them, held by owners, researchers and analysts.

What the dashboard does instead is read Studio, and read the sittings collected
under Studio's versions.

## Where the history comes from

Studio keeps its records in the survey's `(default)` database, all under
`studies/{study}/` (survey docs/16 §5.2 and §9.2; the shapes are
`packages/studio/src/contract.ts` there). The dashboard's functions read them
with the Admin SDK and never write to them. No browser reads them.

| Studio's document | What the page takes from it |
|---|---|
| `surveys/{surveyId}` | the survey's title |
| `surveys/{surveyId}/versions/{version}` | version, release key, hash, engine version, source (Studio or the repository), release note, change summary, bump, based on, authors, publisher, published at |
| `published/{surveyId}` | the live version: hash, version, release key, generation |
| `publicReleases/{hashHex}` | the manifest itself, as Studio froze it, for MyStory and for downloads |
| `studioAudit/{id}` | only the rows about versions: `survey.imported`, `version.published`, `version.activated` (which moved the live pointer) and `draft.restored` |

Before an administrator presses **Set up from the live survey** in Studio these
are empty, and every iPad runs the release bundled in the survey app. The page
then says the iPads run "the version built into the app" and lists the
dashboard's registry alone.

A version in the dashboard's registry that Studio has no record of (one
published from the repository before Studio's set-up, such as r1.0.0–r4.0.0)
is listed too, as from the repository and not in Studio.

## What the page shows

- **On the iPads now.** Studio's live version, and since when. New sittings use
  it from each iPad's next start screen; a sitting already under way finishes on
  the version it started with.
- **History**, newest first. For each version:
  - the version, whether it is live, where it was made, the bump on the
    version it was based on, and the version restored into its draft, if one
    was;
  - when it was published and by whom; who wrote it (the draft's editors);
  - the release note, and Studio's change summary one line per change;
  - **MyStory**: whether the version ends with it, and which protocol. Read from
    the manifest: the last section holds a `narrative` component (survey docs/16
    §10.1);
  - **sittings**: how many the dashboard has recorded under it, how many reached
    the end and how many did not, and the first and last;
  - **on the iPads**: each period it was live (below);
  - a manifest download.
- A version the dashboard cannot read says why, under its row (below).

Release notes, change summaries and addresses are the research team's own, and
are shown as text, never as markup. The page carries no participant data: the
sittings are counts and dates, counted on the server from the dashboard's own
summaries, so nothing about a sitting reaches the browser.

## When each version was live

From the audit rows that moved the live pointer. Each period runs until the next
row:

- **already live when Studio was set up**: the set-up row, for the version that
  was live then. It was live before the trail began, so its earlier time is not
  in it;
- **published**: a publish in Studio;
- **made live again**: Studio's emergency rollback, with who did it and the
  reason they gave.

With no trail at all, the live pointer alone says which version is live, from
the time it records.

## Sittings under a version Studio published

A sitting names its version by the release's content hash. When a sitting's
summary is written (`summaries.ts`) and the registry does not hold that hash,
`resolveRelease` (`releases.ts`):

1. reads `publicReleases/{hashHex}` from the survey's database;
2. checks it, as the participant app does before it renders a release:
   - the manifest hashes, with the survey's own canonical code (its
     `packages/schema/src/canonical.ts`, vendored), to the hash it is filed
     under, and states that hash;
   - the document agrees with its manifest about hash, version, release key and
     study, and the study is this one;
3. registers it in the dashboard's registry with
   `provenance: { source: "studio", surveyId, version, from }`, once, in a
   transaction, with a `release.registered` audit row;
4. summarises the sitting through it. From then on its sittings are read and
   counted like any other version's.

A copy that fails a check is **refused**: logged as an error, audited once as
`release.refused` with the reason, and nothing is read through it. Its sittings
stay under "an unregistered version", never read through another version. The
page marks the version "Not read" with the reason.

A sitting that arrived before its version could be read stays unread until its
summary is rebuilt: **Settings → Data maintenance → Re-summarise sessions with
unknown versions**. The page says so for any such version.

## Downloads

- **Manifest**: the registry's copy, or else Studio's copy once it passes the
  checks above. A copy that fails them is not served.
- **Version history (CSV)** and **JSON**: the provenance export, audited as
  `survey.provenance_exported`. One row per version, newest first. The first
  twenty columns are those of Studio's own provenance download (survey docs/16
  §10.2), in its order and formats, so the two files read alike; the rest are
  what only the dashboard knows.

| Column | From |
|---|---|
| `version`, `release_key`, `hash`, `engine_version` | the version record, or the registry |
| `status` | `live` or `previous`, from Studio's live pointer |
| `source` | `studio` or `repository` |
| `authors`, `publisher`, `published_at` | the version record (`publisher` is `repository` for a version from the repository) |
| `based_on` | the version record |
| `restored_from` | the last "Restore into draft" in the audit trail between the publish before it and its own |
| `release_note`, `change_summary` | the version record; change lines separated by ` \| ` |
| `required_bump`, `chosen_bump` | the change summary's bump, and the bump the version number took |
| `mystory`, `mystory_protocol` | `on` or `off`, and `key@version`, from the manifest; empty when it could not be read |
| `sittings_complete`, `sittings_partial` | the dashboard's summaries: reached the end or not, as Studio counts them |
| `live_periods` | the audit trail, each "from to to (how)", with "now" for the one still live, separated by `; ` |
| `survey` | Studio's survey ID; empty for a version only the registry knows |
| `in_studio` | whether Studio has a record of it |
| `read_by_dashboard` | whether it is in the registry, so its sittings are read |
| `sittings`, `first_sitting`, `last_sitting` | the dashboard's summaries (counts and dates only) |
| `problem` | why the dashboard cannot read it, if it cannot |

Times are ISO 8601 (UTC); authors are separated by `; `. A cell that could not
be read is left empty, never guessed. The JSON is `{ format:
"myself-dashboard-provenance", formatVersion: 1, study, exportedAt, notes,
studioSetUp, live, versions, unknownSittings }`, each live period as `{ from,
to, how, by, reason }`, so who made a version live again, and why, is kept
there. The CSV is written with `toCsv`: a cell that starts with `=`, `+`, `-`,
`@`, a tab or a carriage return is prefixed with `'`, so a spreadsheet shows it
rather than runs it; quoting follows RFC 4180, with a byte-order mark.

## Functions and access

| Callable | Capability | Does |
|---|---|---|
| `listSurveyVersions` | `survey.versions` | the live version and the history |
| `getSurveyManifest` | `survey.versions` | one version's manifest, by hash |
| `exportSurveyProvenance` | `survey.versions` | the history as CSV and JSON, audited |

All three go through `requireActor`, like every callable: a verified Google
account on the access list with a dashboard role. Studio's own roles play no
part here. The web app's link to Studio is `VITE_STUDIO_URL`, by default
`https://faisalmushtaq.github.io/MySelf/researcher/#/surveys`, opened in a new
tab with `rel="noopener noreferrer"`.

## Code

- `packages/core/src/versions.ts`: the merge, live periods, MyStory and the CSV
  (pure, unit-tested).
- `apps/functions/src/studio.ts`: reads Studio's records.
- `apps/functions/src/releases.ts`: `checkStudioRelease`, `studioRelease`,
  `resolveRelease`.
- `apps/functions/src/api/versions.ts`: the three callables.
- `apps/web/src/pages/survey/Versions.tsx`: the page.

## Tests

- **Unit:** `packages/core/src/versions.test.ts` (merge, live periods, MyStory,
  CSV); `apps/functions/src/releases.test.ts` (Studio's copy accepted, and
  refused when changed, misfiled, inconsistent, not JSON or another study's);
  `apps/web/src/pages/survey/Versions.test.tsx` (the link, no editing controls,
  text not markup, downloads).
- **Emulators:** `apps/functions/test/api.integration.test.ts`, "survey
  versions from MySelf Studio": a sitting under a Studio version is read and its
  version registered once; a changed copy is refused once and nothing is read;
  the history, manifests, export and who may call them.
- **Offline demo:** `scripts/demo/studio.mjs` seeds an invented Studio history
  (set-up, a version with MyStory, a rollback) and `scripts/demo/check.mjs`
  checks the page and its downloads (scripts/demo/README.md).

## Known limitations

- A placement can now list part of a form (`items`, survey D-49). The
  completeness rules the dashboard shares with the survey (vendored
  `store/completeness.ts`) do not read it yet, in the survey either, so such a
  version would be judged as if the whole form were placed. That is the
  survey's to change; the dashboard follows when it re-vendors.
- Live periods before Studio's set-up are not known.
- The dashboard's own "active version" (Settings → Study settings, else the
  newest registered) does not follow Studio's live pointer. After a rollback
  the newest registered version may not be the live one.
