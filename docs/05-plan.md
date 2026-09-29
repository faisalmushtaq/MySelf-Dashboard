# 5. Implementation plan, assumptions and open questions

> **Status (2026-09-28): steps 1–17 are implemented and tested against the Firebase
> Emulator Suite.** Deployment into `myself-research` is the procedure in
> [06-handover.md §5](06-handover.md); the open questions below still need answers.

## 5.1 Sequence

| Step | Deliverable | Verified by |
|---|---|---|
| 1–3 | Audit, architecture, access model (docs 01–04) | this document set |
| 4 | Completeness engine and status rules in `packages/core` | unit tests over synthetic sittings and the real YBM manifests |
| 5 | Repository scaffold: pnpm workspace, `firebase.json` with the `dashboard` database, Hosting target and functions codebase | build + typecheck |
| 6 | Authentication and role enforcement (`authz.ts`, `whoAmI`, access policy) | unit tests of every role × capability |
| 7 | `firestore/dashboard.rules` + indexes | emulator tests: authorised, unauthorised, malicious |
| 8 | App shell, navigation, global filters, Overview | component + e2e |
| 9 | Sessions directory | unit (query model) + e2e |
| 10 | Session review, filtered prev/next, split view, review tools | unit + e2e |
| 11 | Completeness and Questions views, version comparison | unit + e2e |
| 12 | Saved views | rules tests + e2e |
| 13 | Exports (preview → confirm → server generation → authenticated download → cleanup) | unit (CSV/XLSX/PDF, injection) + e2e |
| 14 | Audit log | unit + rules + e2e |
| 15 | Accessibility, loading/empty/error states, performance | axe checks in e2e, 20k-sitting benchmark test |
| 16 | End-to-end scenario against the Firebase emulators | Playwright |
| 17 | Deployment, configuration, rollback, handover | `docs/06-handover.md` |

No destructive migration is part of this plan.

## 5.2 Assumptions (labelled; each is a setting, not a constant)

| # | Assumption | Where to change it |
|---|---|---|
| A1 | Role mapping: Administrator = `owner`, Researcher = `researcher`, Read-only reviewer = `analyst` | `packages/core/src/roles.ts` |
| A2 | `soft` and `hard` required levels both count as required | `config/policy.requiredLevels` |
| A3 | A sitting not heard from for 24 h is abandoned | `config/policy.abandonAfterHours` |
| A4 | Test sittings use codes starting `TST` or `ZZZ` | `config/policy.testCodePatterns` |
| A5 | Read-only reviewers do not see free-text answers or unmasked study codes | `config/policy.reviewerCanViewFreeText` / role matrix |
| A6 | Study time zone `Europe/London` | `config/policy.timeZone` |
| A7 | Exports are kept 24 h | `config/policy.exportRetentionHours` |
| A8 | The initial allowlist is `brainpopresearch@gmail.com`; no Workspace domain | Settings → Access |
| A9 | The dashboard Hosting site is `myself-research-dashboard` | `.firebaserc` target |
| A10 | The `dashboard` database is created in `europe-west2`, matching `(default)` | `docs/06-handover.md` |

## 5.3 Open questions (cannot be answered from the repository)

1. **Is `brainpopresearch@gmail.com` the only account**, and is there a managed BrainPOP
   Google Workspace domain to allow as well?
2. **Which release is live?** The participant bundle pins r7.1.0; the dashboard cannot
   see a deployment. Default: newest release in the registry, overridable in policy.
3. **Test sittings:** is there, or can there be, a reserved code prefix (S2)?
4. **Abandonment window:** is 24 h right for school fieldwork where devices sync at the
   end of the day, or should it be several days?
5. **May read-only reviewers read free text?** (Default no.)
6. **Survey-side change S1** (restrict raw-log reads): approve or not?
7. How many sittings are expected per study year? (Designed for ≤ 20k; see §2.4.)
