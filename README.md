# MySelf Research Dashboard

A secure, researcher-facing dashboard for the MySelf survey
([faisalmushtaq/MySelf](https://github.com/faisalmushtaq/MySelf)): participation,
data completeness, session-by-session review, and controlled exports.

It is a separate application from the public survey. It shares the survey's Firebase
project (`myself-research`) through its **own** named Firestore database
(`dashboard`), functions codebase (`dashboard`) and Hosting site, so it cannot change
the survey's rules, functions or data — and needs no change to the survey to run.

- **Access:** Google sign-in; an explicit allowlist (and optional Workspace domain)
  **and** a role — Administrator, Researcher or Read-only reviewer — enforced by the
  backend on every call and by Firestore Security Rules on every read.
- **Completeness** is judged against the survey version each participant actually
  received, distinguishing unanswered, hidden-by-branching, not-reached, invalid,
  declined and never-collected questions ([definitions](docs/03-completeness.md)).
- **Privacy:** raw logs never reach a browser; names, dates of birth and code
  components are never shown or exported; exports are generated server-side,
  downloaded through an authenticated endpoint, audited and deleted after 24 hours.
- **Participants and linkage:** sittings joined into participants and waves by the
  survey's secret code, exactly as the survey's own export does, with held-back
  sittings, shared (twin) codes and same-day repeats called out.
- **Exports:** BIDS by default (built with the survey's data layer), with identifiers
  for linkage unless a de-identified copy is chosen; CSV, Excel and clearly laid-out
  PDF reports.
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

## Quick start (local, synthetic data)

```bash
pnpm install
pnpm e2e:build                                     # core, functions, emulator web build
pnpm dev:emulators                                 # Auth, Firestore, Functions, Storage
pnpm seed:emulators                                # in a second terminal
pnpm --filter @myself-dashboard/web dev:emulators  # http://127.0.0.1:5173
```

Sign in on the emulator page as `brainpopresearch@gmail.com` (Administrator),
`researcher@brainpop.example`, `reviewer@brainpop.example`, or
`stranger@gmail.com` (denied). All data is synthetic.

## Tests

```bash
pnpm -r test            # 176 unit tests (core, functions, web)
pnpm test:rules         # 28 Firestore rules tests (emulator)
pnpm test:integration   # 25 backend tests against the emulators
pnpm test:e2e           # Playwright: the research journey, figures, roles, a11y (after pnpm e2e:build)
```

## Layout

`packages/core` (domain logic and the completeness engine) · `apps/functions`
(backend) · `apps/web` (React app) · `firestore/` (rules, indexes, rules tests) ·
`e2e/` · `scripts/` · `docs/`.
