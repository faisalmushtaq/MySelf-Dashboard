# MySelf Research Dashboard

Secure, researcher-facing dashboard for the MySelf survey: participation,
completeness, session review and controlled exports. A separate application from
the public survey (`faisalmushtaq/MySelf`), sharing its Firebase project through a
dedicated `dashboard` Firestore database, Hosting site and functions codebase.

Design documents (read in order):

1. [Audit of the existing system](docs/01-audit.md)
2. [Architecture and access model](docs/02-architecture.md)
3. [Completeness and status definitions](docs/03-completeness.md)
4. [Risks and survey-side changes](docs/04-risks.md)
5. [Plan, assumptions, open questions](docs/05-plan.md)
