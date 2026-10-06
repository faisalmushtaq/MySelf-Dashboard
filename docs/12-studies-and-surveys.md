# 12. Study spaces and surveys

The survey now runs **several studies in one Firebase project, and several
surveys in one study** (survey decision D-56; its docs/16 §11). A standalone
study on participants' perspectives of the future is a *study space* beside
`ybm`, with its own access list and its own data; the stages of MyPhone MyBrain
are *surveys* in `ybm`, each with its own live participant link. This chapter is
how the dashboard follows: which studies it shows, who may see which, where each
study's documents live, how a survey is chosen inside a study, and why nothing
that exists today has to move.

It was written as the design before the change was built. The survey side's
§11.6, "What the dashboard reads (the data contract)", is the contract; this
chapter was written against its version at survey commit `9ec4733`
(branch `d56-links`).

---

## 12.1 Two words

As in the survey (docs/16 §11.1):

- A **study** is everything under `studies/{study}/` in the survey's database:
  its surveys, its sittings, its Studio access list, its audit trail. `ybm` is
  one. The deployment's default study is `MYSELF_STUDY` (`ybm` in production,
  `demo` in the emulators).
- A **survey** is one Studio survey in a study: its versions and its live
  pointer. `ybm_nd2026_standard` is the survey every iPad has run so far.

In the dashboard a study is chosen in the header and a survey is a filter, like
a survey version.

## 12.2 What the dashboard reads

All in the survey's `(default)` database, by the functions only, with the Admin
SDK (§11.6). No browser reads `(default)`.

| What | Where | How the dashboard reads it |
|---|---|---|
| **The studies** | `studies/{study}` (the registry), plus the default study whether or not it has a document | A document whose id is not a study id (`^[a-z][a-z0-9_]{1,39}$`) is ignored. `status` is read failing closed: anything but `"open"` is closed. The default study with no document is open, and its title is its live survey's title. |
| **A study's surveys** | `studies/{study}/published/{surveyId}` (one per survey with a live version), plus every survey named by a release the dashboard has registered in that study | A survey's title is its release's `composition.title`. |
| **A sitting's study** | the path, `studies/{study}/sessions/{id}` | A sitting whose own `study` field names another study is not summarised (§12.5). |
| **A sitting's survey** | `release.assessment` of the release its `releaseHash` names, **resolved in its own study** | `releaseKey` is never the source. A sitting whose version is not registered belongs to no survey until it is. |
| **A release** | the dashboard's registry for that study; else Studio's copy, `studies/{study}/publicReleases/{hex}`, checked against its hash (docs/11) | The repository's bundled releases are registered only for `ybm`. A release is never looked up in another study. |
| **Studio's history** | `studies/{study}/surveys`, `…/versions`, `…/published`, `…/studioAudit` | per study, as docs/11 already does for one. |

The ids are checked with the survey's own patterns and link builder,
`packages/schema/src/link.ts`, vendored (`vendor/myself/schema/link.ts`), so
the dashboard accepts exactly the ids, and builds exactly the links, that the
survey does.

## 12.3 Where each study's documents live (the `dashboard` database)

Everything the dashboard keeps about a study was already filed under
`studies/{study}/`, keyed by the deployment's one study. Each study now gets its
own space alongside, with the same shape:

```
config/access                    who may use the dashboard at all (unchanged)
                                 + defaultStudy (written by the backend; absent means "ybm")
config/policy, config/groups     the DEFAULT study's settings and school names (unchanged)
users/{uid}                      + study: the study this person last chose
studies/{study}/                 one space per study — ybm's stay exactly where they are
  releases/, releaseManifests/   its survey versions
  sessionSummaries/, meta/       its summaries and freshness
  reviews/(+notes)               its review records
  savedViews/, exportJobs/       its saved views and exports
  auditLog/                      its audit trail
  scoringSchemes/                its scoring schemes
  config/access                  NEW, not for the default study: who else may see it
  config/policy, config/groups   NEW, not for the default study: its own settings,
                                 once an administrator saves some in it
```

- **`ybm` moves nowhere.** Its summaries, reviews, notes, views, exports, audit
  rows, schemes, registry, `config/policy` and `config/groups` are where they
  were. No document is rewritten and no summary needs rebuilding: a sitting's
  survey is worked out when it is read (§12.6), not stored.
- **A new study's settings** start as the default study's (time zone,
  abandonment window, required levels, test-code patterns, school names), with
  no active version of its own: until an administrator saves settings while in
  that study, its newest registered version is its active one. Saving writes
  `studies/{study}/config/policy` (or `groups`); the default study's are never
  touched from another study.
- **Global events** — sign-ins, refusals, the dashboard's access list, roles —
  are audited where they always were, in the default study's log. Everything
  done inside a study (views, reviews, exports, its own access list) is audited
  in that study's log.

## 12.4 Who may see which study

| | Administrator (`owner`) | Researcher, Read-only reviewer |
|---|---|---|
| use the dashboard at all | on the access list, with a role (unchanged) | the same |
| the default study (`ybm`) | ✓ | ✓ — `ybm`'s access is the dashboard's access list, unchanged |
| another study | ✓ every study | only when their address, or their Google Workspace domain, is on **that study's** list |
| manage a study's list | ✓ Settings → Study access | ✗ |

- **A study's list** is a list of addresses and Workspace domains, like the
  dashboard's own, managed by administrators in Settings → Study access and
  audited as `study_access.changed` (before and after) in that study's log.
  It narrows, never widens: someone on a study's list who is not on the
  dashboard's access list, or holds no role, still gets nothing. The role is
  the same in every study: a reviewer in one is a reviewer in all.
- **Public mail domains are refused as domain rules** (`gmail.com`,
  `outlook.com`, `icloud.com` and the rest of `PUBLIC_MAIL_DOMAINS`), on the
  dashboard's list and on every study's: a domain rule is for a domain an
  organisation manages. Single addresses at those domains are fine.
- **Enforced by the backend on every call.** Every study-scoped callable reads
  `study` from the request (absent means the default, which is what every
  request meant until now), checks it is a study id and a registered study, and
  then checks the caller may see it, before anything else is read
  (`requireStudyActor`, `apps/functions/src/authz.ts`; the decision is the pure
  `decideStudyAccess` in `packages/core/src/studies.ts`, unit-tested).
  Every path is then built from that checked study, never from the request.
  `downloadExport` takes the study beside the job id and checks the same.
- **Enforced by the rules on every direct read.** Every rule under
  `studies/{study}/` asks `studyMember(study)`: a member, and an administrator,
  or the default study, or on that study's list. The rules learn which study is
  the default from `config/access.defaultStudy`, which they already read, and
  read `ybm` when it is absent — so production's existing document needs no
  change. `firestore/test/rules.test.ts` holds a researcher of one study to
  reading nothing of another.
- **Studio roles play no part**, as before: a Studio member is not a dashboard
  user, and a dashboard user is not a Studio member.

**What this does not cover.** The survey's own rules let every `owner`,
`researcher` and `analyst` claim read sittings in every study (§11.5); a
per-study reader there is the survey's decision (§11.11). The dashboard's
narrowing applies to the dashboard. Someone kept out of a study here who holds
a researcher claim could still read its raw sittings in the survey's researcher
view. §12.11 asks the team to decide whether that is acceptable.

## 12.5 Summaries for every study

`onSessionWritten` already listened to `studies/{study}/sessions/{id}` and
returned early for any study but the deployment's. Now:

1. the study id must be a study id and a registered study (its registry
   document exists, or it is the default). A registered study is remembered for
   the life of the instance — studies are never deleted — and an unknown one is
   asked about again next time, so a study created a moment ago is not missed;
2. a sitting whose own `study` field names a different study is malformed;
3. anything else is **ignored and logged** (`warn`, with the session id and the
   study id clipped), never summarised into another study.

A summary is written to `studies/{study}/sessionSummaries/{id}` of **its**
study, with the release resolved in that study: its registry, else Studio's
checked copy in that study's `publicReleases`, registered there with its
provenance and an audit row in that study's log. A closed study's sittings are
summarised like any other: closing stops new sittings, never the reading of
collected ones.

Rebuilds follow: **Settings → Data maintenance** rebuilds the study you are in;
the setup workflow's backfill (`ops/` request) rebuilds every registered study,
or the one it names.

## 12.6 Surveys inside a study: the survey filter

- **"All surveys" is the default.** A survey filter (`surveys`, URL key `sv`)
  joins the global filters beside the version filter, shown in the header when
  the study has more than one survey. Like every filter it is applied on the
  server, in `makePredicate`, so the Overview, Sessions, Completeness, Questions,
  Scores, Figures, Participants, exports (CSV, Excel, BIDS) and reports all
  respect it. The version list narrows to that survey's versions.
- **A row's survey** is resolved from its release when rows are built
  (`buildRows(…, { surveyOf })`), not stored in the summary, so no existing
  summary has to be rebuilt and the answer always follows the contract.
- **Counts per survey are the survey's counts.** The figures the survey's
  researcher view also shows (Sittings, Reached the end, All required answered,
  participants, …) are computed by its vendored `counting.ts` over the sittings
  of that survey; participants and waves stay linked across the whole study,
  as the survey's ingest links them, and `headlineFigures` restricts the
  dataset itself, as in the researcher view.
- **Participants** with a survey chosen lists the participants with a sitting in
  that survey, and only those sittings; waves keep their study-wide numbers.

## 12.7 Choosing a study in the web app

- **A study switcher in the header**, listing the studies the person may see
  (from `whoAmI`, worked out on the server), with each study's title and
  whether it is closed. It is shown only when there is more than one.
- **Remembered per person**, on the server (`users/{uid}.study`, written by
  `whoAmI` when someone chooses a study): the same study on any browser, the
  default the first time, and the default again if their access to the
  remembered one is taken away.
- **Every call carries the study.** The typed API client adds the current study
  to every request, and every direct read uses its path. Choosing another study
  reloads the dashboard's data for it, starting from the Overview.
- **Addresses carry no study**, as they carry no study code: a study id is not
  identifying, but a link to a session or a filtered list is a link inside the
  study you are in.

## 12.8 Survey versions, per study and per survey

Survey versions shows the chosen study's history, one section per survey:

- its live version and since when, and its **participant link**, built exactly
  as the survey builds it (§11.2, the vendored `participantLink`):
  `https://faisalmushtaq.github.io/MySelf/?study=<study>&survey=<surveyId>`,
  both parameters always, with a copy button. The address is
  `VITE_PARTICIPANT_URL`, by default the survey's GitHub Pages address;
- **Edit in Studio**, pointing at the survey's own versions page in Studio
  (`#/surveys/<surveyId>/versions`) for the default study. Studio's addresses do
  not name a study yet, so for another study the link opens Studio's survey
  list and the page says to choose the study there;
- the history of that survey's versions. A version only the registry knows is
  placed under the survey its manifest names.

## 12.9 Exports

- **File names** say the study, and the survey when one is chosen:
  `myself_<study>[_<survey>]_<kind>…`.
- **Inside**: the BIDS dataset's name and README name the study, and
  `export_manifest.json`'s provenance carries the study and the survey filter;
  CSV and Excel session exports carry a `survey` column. Spreadsheet formulas are
  defused as before (`toCsv`, typed XLSX cells).
- **Jobs** are filed in the study's own `exportJobs`; downloading one checks
  the person may still see that study.

## 12.10 Back-compatibility

- **A request without a study** means the default study, so a web build from
  before this change keeps working against the new functions. Deploy the
  functions first, then the rules, then the web app.
- **Nothing in `ybm` moves, nothing is rewritten, nothing needs a rebuild**
  (§12.3, §12.6). `config/access` without `defaultStudy` reads as `ybm`.
- **Before the survey's D-56 is deployed** there is no registry and every
  sitting is under `ybm`: the dashboard shows one study and one survey, the
  switcher and the survey filter do not appear, and every page is as it was.
- **Rolling back** is redeploying the previous functions, rules and web app.
  The new documents (`studies/{study}/config/*`, `users/{uid}.study`,
  `config/access.defaultStudy`) are additive and the previous build ignores
  them; other studies' summaries stay in their own spaces, unread.

## 12.11 Decisions for the research team to confirm

1. **Every dashboard member sees `ybm`.** The dashboard's access list is
   `ybm`'s list, unchanged; there is no way to admit someone to a standalone
   study only. If that is wanted, `ybm` needs a list of its own (a small change:
   the rules and the backend already work per study).
2. **Raw sittings are still readable by every role claim in every study**
   through the survey's own rules (§12.4). The dashboard narrows only itself.
3. **One role across studies.** A Researcher in one study is a Researcher in
   every study they may see.
4. **A new study starts with the default study's settings and school names**
   (§12.3), changed per study once an administrator saves them there.
5. **Studio links for other studies** open Studio's survey list until Studio's
   addresses can name a study.
