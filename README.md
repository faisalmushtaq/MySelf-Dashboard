# MySelf Research Dashboard

A secure, researcher-facing dashboard for the MySelf survey
([faisalmushtaq/MySelf](https://github.com/faisalmushtaq/MySelf)): participation,
data completeness, session-by-session review, and controlled exports.

It is a separate application from the public survey. It shares the survey's Firebase
project (`myself-research`) through its **own** named Firestore database
(`dashboard`), functions codebase (`dashboard`) and Hosting site, so it cannot change
the survey's rules, functions or data — and needs no change to the survey to run.
It reads every study space the survey runs in that project, each kept apart.

- **Access:** Google sign-in; an explicit allowlist (and optional Workspace domain)
  **and** a role — Administrator, Researcher or Read-only reviewer — enforced by the
  backend on every call and by Firestore Security Rules on every read.
- **Study spaces and surveys** (survey decision D-56): every study the survey
  runs in the project, chosen in the header, each with its own data and its own
  access list (administrators see all; a study other than `ybm` only those it
  lists); a survey filter inside a study, counted by the survey's own rules; each
  live survey's participant link ([details](docs/12-studies-and-surveys.md)).
- **Completeness** is judged against the survey version each participant actually
  received, distinguishing unanswered, hidden-by-branching, not-reached, invalid,
  declined and never-collected questions ([definitions](docs/03-completeness.md)).
- **Privacy:** raw logs never reach a browser; names, dates of birth, home
  addresses and code components are never shown or exported; exports are generated server-side,
  downloaded through an authenticated endpoint, audited and deleted after 24 hours.
- **Participants and linkage:** sittings joined into participants and waves by the
  survey's participant code (the secret code up to survey version 7.3.0, an ID
  from name and date of birth from 8.0.0), exactly as the survey's own export does, with held-back
  sittings, shared (twin) codes and same-day repeats called out.
- **Exports:** BIDS by default (built with the survey's data layer), with identifiers
  for linkage unless a de-identified copy is chosen; CSV, Excel and clearly laid-out
  PDF reports.
- **Scores and benchmarks:** every instrument scored by its published method
  (SDQ, RCADS-25, SWEMWBS with the metric conversion, STAI-5, EHI-SF, KSS,
  MacArthur, the BIS/BAS subset) or a labelled study summary, read against
  published threshold bands and norms and compared across schools and year
  groups; schemes are versioned JSON an administrator can adjust, and school
  and year-group reports are ready to share ([guide](docs/08-scoring.md)).
- **Codebook and quality review:** every question has a readable name
  (`sdq_13_unhappy`) and label, used on screen and as export column names, with the
  survey and Qualtrics variables kept beside them; every survey version is reviewed
  automatically against its labels, the published scoring keys and cut-points, and
  the earlier versions ([review](docs/09-data-quality.md)).
- **Publication figures:** multi-panel figures at journal column widths (89/120/183
  mm), Arial/Helvetica at 6–8 pt, colour-blind-safe or greyscale, exported as vector
  PDF/SVG or 300–1200 dpi PNG/TIFF with a draft legend and source data
  ([guide](docs/07-figures.md)).

Screenshots (emulator seed, synthetic sittings only):
[Overview](docs/screenshots/overview.png) ·
[Sessions split view](docs/screenshots/sessions-split-view.png) ·
[Questions](docs/screenshots/questions.png) ·
[Figures](docs/screenshots/figures.png) ·
[an exported figure (300 dpi)](docs/screenshots/figure-example-300dpi.png)

## Documents

1. [Audit of the existing system](docs/01-audit.md)
2. [Architecture and access model](docs/02-architecture.md)
3. [Completeness and status definitions](docs/03-completeness.md)
4. [Risks and survey-side changes](docs/04-risks.md)
5. [Plan, assumptions, open questions](docs/05-plan.md)
6. [**Handover**: setup, configuration, deployment, roles, rollback, limitations](docs/06-handover.md)
7. [Publication figures: panels, house style, files, privacy](docs/07-figures.md)
8. [Scores, benchmarks and school reports](docs/08-scoring.md)
9. [Codebook and data-quality review](docs/09-data-quality.md)
10. [**Maintainers' guide**: repository map, data flow, recipes, tests, deploys](docs/10-maintainers-guide.md)
11. [Survey versions: MySelf Studio's history, read-only, and the sittings under each version](docs/11-survey-editor.md)
12. [**Study spaces and surveys**: several studies, access per study, the survey filter](docs/12-studies-and-surveys.md)

## Quick start (local, synthetic data)

```bash
pnpm install
pnpm e2e:build                                     # core, functions, emulator web build
pnpm dev:emulators                                 # Auth, Firestore, Functions, Storage
pnpm seed:emulators                                # in a second terminal
pnpm --filter @myself-dashboard/web dev:emulators  # http://127.0.0.1:5173
```

Sign in on the emulator page as `brainpopresearch@gmail.com` (Administrator),
`researcher@brainpop.example` (who also sees the second study, `pilot`),
`reviewer@brainpop.example`, or `stranger@gmail.com` (denied). All data is
synthetic.

## Tests

```bash
pnpm -r test            # 399 unit tests (core 348, functions 34, web 17)
pnpm test:rules         # 36 Firestore rules tests (emulator), cross-study isolation among them
pnpm test:integration   # 55 backend tests against the emulators
pnpm test:e2e           # 13 Playwright tests: the research journey, figures, roles, a11y, study spaces (after pnpm e2e:build)
```

Port 4173 taken (the survey's own preview uses it too)? `E2E_PORT=4183 pnpm test:e2e`.
More in the [maintainers' guide](docs/10-maintainers-guide.md#105-tests).

## Layout

`packages/core` (domain logic and the completeness engine) · `apps/functions`
(backend) · `apps/web` (React app) · `firestore/` (rules, indexes, rules tests) ·
`releases/` (survey release manifests) · `e2e/` · `scripts/` · `docs/`. The
[maintainers' guide](docs/10-maintainers-guide.md) maps each of them and has the
recipes for common changes.

## Public repository

This repository is public. It holds the dashboard's code, never participant
data: answers stay in the Firebase project, readable only through the
dashboard's backend by signed-in, allowed Google accounts, and every fixture,
screenshot and demo is made up. The dashboard needs no secrets; deploys
authenticate with a GitHub Actions secret, and Actions run logs (public too)
never print participant data.
