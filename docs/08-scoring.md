# 8. Scores, benchmarks and school reports

How the dashboard turns answers into scores, what it compares them with, how
sittings are grouped into schools and year groups, and what a school report
contains. Code: `packages/core/src/scoring/`; server: `apps/functions/src/scoring.ts`,
`api/scores.ts`, `exporters/schoolReport.ts`; screens: **Scores**, **Settings →
Scoring**, **Reports → School report**.

## 8.1 Principles

- **Scores are derived, never stored over answers.** Every score is recomputed from
  the stored responses with a *scoring scheme*; changing a scheme re-derives
  every score and loses nothing.
- **Published methods where they exist, labelled summaries where they do not.**
  Each scheme is marked *Official method*, *Official method, adapted form* (the
  published rule applied to a shortened instrument) or *Study-defined summary*
  (no published scoring; compare within the study only).
- **Nothing is presented as authoritative until checked.** Every scheme, every
  set of cut-points and every benchmark names its source and ships
  `verified: false`. The Scores page, the figures, the BIDS sidecar and the
  school reports all say so, until an administrator records that they have
  checked it against the instrument's licensed scoring documents (§8.6).
- **Schemes are plain, versioned JSON.** A study's changes are saved as new
  versions (all kept, with who, when and why); every score, export and report
  names the scheme version it used.
- **Aggregates only leave the server.** The Scores page and school reports are
  built from group summaries; the only per-participant scores are in the BIDS
  export (`phenotype/scores.tsv`), which is a session-level export with its own
  permissions.

## 8.2 The default schemes

Item keys are those of the survey's releases r1.0.0–r7.2.0; every scheme is
checked against every registered release (§8.5).

| Instrument | Status | Scores | Method | Bands | Benchmark |
|---|---|---|---|---|---|
| SDQ (self-report) | Official | emotional, conduct, hyperactivity, peer, prosocial (0–10); total difficulties (0–40); externalising, internalising (0–20) | Items 0–2; 7, 11, 14, 21, 25 reversed; subscales summed and prorated from ≥ 3 of 5 items (mean × 5, rounded); total needs all four difficulty subscales | youthinmind four-band (close to average / slightly raised / high / very high, expected 80/10/5/5%) and original three-band, self-report cut-points | British norms, 11–15 self-report (Meltzer et al., 2000; n = 4,228) |
| RCADS-25 | Official | depression (0–30), anxiety (0–45), total (0–75) | Items 0–3 summed; all items required by default | None: RCADS cut-offs are T ≥ 65 / 70 on grade- and gender-specific norms, which are not included | None |
| SWEMWBS | Official | raw total (7–35); **metric score** (7–35, primary) | Items 1–5 summed, all seven required; raw → metric by the Rasch conversion table (Stewart-Brown et al., 2009) | Warwick bands: 7–17 probable depression, 18–20 possible depression, 21–27 average, 28–35 high (metric rounded to the nearest whole number; derived in adults) | None by default (add one in Settings) |
| STAI-5 (state) | Official | state anxiety (5–20) | Five items 1–4 summed, none reversed (Zsido et al., 2020) | None published | None |
| BIS/BAS (12-item subset) | Adapted | BIS (4 items), BAS reward (4), BAS drive (4); 4–16 each | Responses 1 (very true) … 4 reversed so higher = more of the trait (Carver & White, 1994); Drive is the complete subscale, BIS and Reward are shortened | None | None |
| EHI-SF | Official | laterality quotient (−100 to 100) | Items scored 100 / 50 / 0 / −50 / −100, mean of four (Veale, 2014) | Veale: left −100 to −61, mixed −60 to 60, right 61 to 100 | — |
| KSS | Official | sleepiness right now (1–9) | The rating | 7 or more = sleepy (research convention) | — |
| MacArthur SSS-Y | Official | society ladder, school ladder (1–10) | The rung chosen | — | — |
| Doomscrolling (DS-4) | Study | doomscrolling (1–7) | Mean of ≥ 3 of 4 items (source scale still to be confirmed) | — | — |
| Screen attitudes | Study | screen dependence (1–5), impact balance (−4 to 4), agreement items | Agreement re-coded so 5 = strongly agree; "I can control…" reversed | — | — |
| Social-media use | Study | hours on a school day / other day (band midpoints; 7+ h as 7.5), hours a week (5 × school + 2 × other), night-time checking (0–3), losing track (1–5) | — | 3 h or more a day (convention, e.g. Riehm et al., 2019); any night-time checking | — |
| Gaming | Study | hours a week (band midpoints; > 20 h as 25), % with others | — | more than 20 h a week | — |
| Smartphone | Study | age at first smartphone, age at first social media | "younger than 5" as 4; "not sure" missing | — | — |

"Prefer not to say", "don't know" and similar options are never scores: they
count as missing. A score that its missing-data rule cannot support is blank,
with the number of items that were available.

## 8.3 Schools and year groups

- **School** = the letters a study code opens with (the survey's own rule: the
  letters are the site, the digits the cohort), shown under the name set in
  Settings → Scoring.
- **Year group** — the survey does not ask it, so it is taken from the first of
  these (order configurable) that gives one:
  1. a *study-code rule* (`^NDC08 = 8`), for cohorts issued per year group;
  2. a *year-group question*, in a release that has one (variable `year_group`);
  3. the *date of birth* and the sitting date, by the school-year cut-off
     (1 September in England and Wales: Year 7 are 11 on 31 August). Only the
     year group is kept; the date of birth never leaves the server's memory.
  Pupils held back or moved up a year are placed by age; a study-code rule
  overrides that where it matters.

## 8.4 Statistics

- **Which sittings.** By default each participant's *latest* sitting, so no one
  counts twice; first sitting, a given wave or every sitting can be chosen.
- **Means** with 95% intervals from the t distribution; **band shares** with
  Wilson 95% intervals.
- **A group against its peers** — a school against the other schools combined;
  a school's year group against the same year group elsewhere — is the
  difference in means with a Welch 95% interval.
- **Against a benchmark**: the difference in the benchmark's SD units (a
  standardised difference), and in points.
- Groups smaller than the study's minimum size (default 10) are marked small on
  the Scores page and withheld from school reports.

## 8.5 Checks against the survey's versions, and why the dashboard scores everything

Every scheme is checked against every registered release that administers its
instrument: every item it names must exist and be scorable, reversal constants
must match the codes (a 0–2 item reverses with 2), and recodings should cover
every substantive code. Errors show on the Scores page and in Settings.

**The dashboard is the scoring source for all data, old and new.** Each survey
release also carries scoring definitions of its own, frozen with it, but the
dashboard never uses or exports them:

- the survey's SWEMWBS and STAI-5 definitions in r1.0.0–r7.1.0 name items
  `q1`… that those instruments have never had, so their totals are always
  blank. The survey fixed this in r7.2.0 and now refuses to publish such a
  definition (survey-side change **S6**, docs/04 §4.2), but a release is never
  edited, so every sitting collected before r7.2.0 keeps the broken definition;
- the survey's own reading of the answers leaves SDQ total difficulties and the
  RCADS total blank in every release (**S7**, not yet fixed).

The dashboard's schemes key on the real items for every release, so a sitting
from r1.0.0 and one from r7.2.0 are scored the same way, by the same versioned
scheme. The BIDS export carries only the dashboard's scores. A test
(`packages/core/src/survey/survey.test.ts`) scores made-up sittings under the
real r7.2.0 with both and checks that, sitting by sitting, the survey's own
SWEMWBS, STAI-5, SDQ and RCADS subscale and EHI scores equal the dashboard's —
and that the SDQ and RCADS totals equal the sums of those subscales. BIS/BAS
differ by design: the survey sums the raw codes, the dashboard reverses them
so a higher score means more of the trait.

## 8.6 Changing a scheme

Settings → Scoring → choose the instrument:

- **Forms** for the common changes: how many items a score needs and whether a
  partial sum is prorated; threshold bands (names, upper limits, concern level,
  the range as the source writes it, expected shares); benchmarks (label,
  population, mean, SD, n, source).
- **JSON** for everything else: items, reversals, re-codings, conversion tables,
  new scores. The format is `packages/core/src/scoring/scheme.ts`; every save is
  validated (outputs may only use earlier outputs, bands must increase, a sum
  without proration needs every item, and so on).
- **Preview the effect** on the study's scores before saving.
- **Save** a new version (it must be higher than the current one) with a reason.
  Tick *I have checked this scheme against the instrument's licensed scoring
  documents* to record that you did — your email, the date and a note are kept
  and shown wherever the scheme is used. Any later change clears it.
- Every version is kept (`studies/{study}/scoringSchemes/{key}/versions`) and
  every save is in the audit log (`scoring.changed`). *Start again from the
  dashboard default* loads the default into the editor as a new version.

**Before relying on scores in a publication or a report, check at least:** the
SDQ bands and scoring against the youthinmind scoring sheet; the SWEMWBS
conversion table and bands against the Warwick user guide; the SDQ British
norms against youthinmind's normative tables; the RCADS item allocation
against rcads.ucla.edu; and the KSS, social-media and gaming thresholds against
the study protocol.

## 8.7 Where scores appear

- **Scores** page: per instrument, the scheme and its status; per score the
  mean, interval, median, SD, band shares against expected shares, distance
  from the benchmark, and — with a school or year group in focus — its
  difference from its peers. Charts are publication figure panels: open them in
  **Figures** for PDF/SVG/PNG/TIFF, or download their source data.
- **BIDS export**: `phenotype/scores.tsv` has a column per score and one per
  threshold set (the band's label); `phenotype/scores.json` gives each column's
  method, scheme and version, range, direction and verification.
- **School reports** (§8.8).

## 8.8 School and year-group reports

Reports → School report, or the button on the Scores page when a school is in
focus. A PDF for one school, or one of its year groups:

- the school, its pupils, what it is compared with, the period and filters;
- *How to read this report*: averages only; bands are screening information
  about a group, not a diagnosis; how to read a confidence interval;
- *At a glance*: each measure's school mean (95% CI), the other schools
  combined, the difference with its interval (coloured only when the interval
  excludes zero), the distance from the benchmark, and the share of pupils in
  the high-concern bands against the other schools and the expected share;
- a section per measure: group means and band shares (this school, the other
  schools, all schools and — for a whole-school report — the school's year
  groups), and a table of every score;
- descriptive measures (handedness, status ladders) as averages only;
- the source of every band and benchmark, and the scheme versions.

It is written to be shared with the school, so: **no distributions of individual
scores; other schools are never named; any group smaller than the minimum size
is withheld; and when fewer than two other schools took part, no other-school
or all-school figures are shown**, since the other school's results could be
worked out by subtraction. Any dashboard member may make one; every report is
an audited export, kept for the retention period and then deleted.

## 8.9 Limitations

- RCADS T-scores need grade- and gender-specific norm tables that are not
  included; RCADS raw scores are compared within the study only.
- The SWEMWBS bands were derived in adults; the SDQ British norms are from a
  1999 survey of 11–15 year olds. Both are stated wherever they are used.
- Study-defined summaries are sensible, documented choices, not validated
  scales: compare them within the study, not with other studies.
- Year groups from dates of birth assume the England and Wales cut-off (set the
  school-year start in Settings for elsewhere) and place every pupil by age.
