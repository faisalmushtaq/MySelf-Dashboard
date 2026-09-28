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

Screenshots (emulator seed, synthetic sittings only):
[Overview](docs/screenshots/overview.png) ·
[Sessions split view](docs/screenshots/sessions-split-view.png) ·
[Questions](docs/screenshots/questions.png)

## Documents

1. [Audit of the existing system](docs/01-audit.md)
2. [Architecture and access model](docs/02-architecture.md)
3. [Completeness and status definitions](docs/03-completeness.md)
4. [Risks and survey-side changes](docs/04-risks.md)
5. [Plan, assumptions, open questions](docs/05-plan.md)
6. [**Handover**: setup, configuration, deployment, roles, rollback, limitations](docs/06-handover.md)

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
pnpm -r test            # 145 unit tests (core, functions, web)
pnpm test:rules         # 28 Firestore rules tests (emulator)
pnpm test:integration   # 24 backend tests against the emulators
pnpm test:e2e           # Playwright: the full research journey, roles, a11y (after pnpm e2e:build)
```

## Layout

`packages/core` (domain logic and the completeness engine) · `apps/functions`
(backend) · `apps/web` (React app) · `firestore/` (rules, indexes, rules tests) ·
`e2e/` · `scripts/` · `docs/`.
