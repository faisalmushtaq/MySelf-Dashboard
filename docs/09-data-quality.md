# 9. Codebook and data-quality review

What every question is called, and whether each answer means and scores what its
label says. Reviewed 29 September 2026 against survey versions r1.0.0–r7.3.0 and
the dashboard's scoring schemes. Code: `packages/core/src/codebook/`,
`packages/core/src/quality/`; server: `apps/functions/src/api/codebook.ts`;
screen: **Codebook**.

## 9.1 What was reviewed, and how

- **Every question in every version**: 147 distinct questions across 12 survey
  versions (143 in r7.2.0 and r7.3.0; information screens are not questions): wording, the context shown above it, the instrument's instructions,
  the answer type, and every response code with its label and kind (a real answer,
  or "don't know" / "prefer not to say").
- **Against the published instruments**: the SDQ against youthinmind's 11–17
  self-report form and scoring document; the RCADS-25 against the RCADS-25 key and
  the full RCADS-47 form and key; SWEMWBS, STAI-5, BIS/BAS, EHI-SF and KSS against
  their sources (§9.11).
- **Against the scoring**: for each scheme, what every response label scores, item
  by item and version by version; whether each subscale's items are the published
  ones; whether cut-points are the published ones.
- **Between versions**: every change in wording, codes, labels, variable names and
  answer types from one version to the next.
- **Against the survey's own anomaly report** (survey docs/02): each anomaly
  re-checked against the current version (§9.7).

The automated part (§9.9) runs on every registered version and the study's current
schemes whenever the Codebook page is opened, so an edited scheme or a new survey
version is reviewed the same way.

## 9.2 Results in brief

| Area | Result |
|---|---|
| Names and labels | Every question in every version now has a readable name and label (§9.8). |
| Response options | Every "don't know" / "prefer not to say" option is marked as such, so none is ever scored as a number. No code is shared by two options. |
| Scoring against labels | Every anchor checked (e.g. SDQ "Certainly true" = 2, or 0 on the five reversed items; RCADS "Always" = 3; BIS/BAS "Very true for me" = 4; agree-first items re-coded so 5 = strongly agree) scores as its label says, in every version. |
| Scoring keys | **Two errors found and fixed in the dashboard** (§9.3): the RCADS-25 depression/anxiety items, and the SDQ self-report conduct cut-points. |
| Survey-side scoring | Three problems in the survey's own scoring, none of which affects the dashboard (§9.4). |
| Wording | The SDQ mixes the 11–17 and adult forms (decision needed); small deviations in RCADS 17, STAI-5 labels, BIS/BAS instructions and the social-media impact pair (§9.5). |
| Versions | One change of meaning: per-app "time in one go" code 1 was "0 minutes" before r5.0.0 and "I have it but barely use it" from r5.0.0 (§9.6). |

## 9.3 Scoring errors found and fixed in the dashboard

**RCADS-25 depression and anxiety (scheme 1.0.0 → 1.1.0).** The published RCADS-25
depression subscale is items 1, 4, 8, 10, 13, 15, 16, 19, 21 and 24 — the full
RCADS's ten major-depression items. The survey's item order follows the RCADS-47
exactly (1 = RCADS-47 item 2, …, 18 = item 37, 24 = item 47). Item 18, "I think
about death", is a generalised-anxiety item in the RCADS-47 key (1, 13, 22, 27, 35,
37); item 24, "I feel restless", is a major-depression item (2, 6, 11, 15, 19, 21,
25, 29, 40, 47). Scheme 1.0.0 had taken the survey's own allocation, which swaps
them. Each subscale was off by one item; the total was right. 1.1.0 uses the
published key.

**SDQ conduct problems, four-band cut-points (scheme 1.0.0 → 1.1.0).** For
self-completed SDQs youthinmind's bands are 0–3 close to average, 4 slightly raised,
5 high, 6–10 very high. 1.0.0 had the parent-completed ones (0–2 / 3 / 4 / 5–10),
so it put too many young people in the raised bands. Every other SDQ cut-point
(four- and three-band, all scales) matches the self-completed table.

A study that has saved its own RCADS or SDQ scheme keeps what it saved: the review
flags a saved scheme that still has either error (as an error for the RCADS key, a
warning for cut-points, since a study may change cut-points on purpose).

## 9.4 Scoring problems on the survey's side

The dashboard scores everything from the answers with its own schemes and never
exports the survey's own scores (docs/08 §8.5), so none of these reaches a dashboard
figure, report or export. They do affect the survey's own researcher view and
exports.

| | Problem | Status |
|---|---|---|
| S6 | SWEMWBS and STAI-5 definitions named items `q1`… the instruments never had: totals always blank | Fixed in the survey from r7.2.0 (D-49, [faisalmushtaq/MySelf#98](https://github.com/faisalmushtaq/MySelf/pull/98)); earlier versions keep blank survey-side totals |
| S7 | The survey's ingest hid subscales from the step that adds them up: its SDQ total difficulties and RCADS total were always blank | Fixed in the survey's reading (D-50, [faisalmushtaq/MySelf#100](https://github.com/faisalmushtaq/MySelf/pull/100)), for every version once a dataset is rebuilt |
| S8 | The survey's RCADS definition swapped items 18 and 24, as in §9.3 | Fixed from r7.3.0 (D-50, [faisalmushtaq/MySelf#100](https://github.com/faisalmushtaq/MySelf/pull/100)); r1.0.0–r7.2.0 keep the swapped survey-side subscales |

## 9.5 Questions against their labels, instrument by instrument

| Instrument | Wording | Response labels and codes | Scoring |
|---|---|---|---|
| SDQ (25) | Items 19, 20 and 22 are the **adult (18+) phrasings** ("Other people pick on me…", "(family members, friends, colleagues)", "home, work or elsewhere"); 4, 6, 13 and 23 are the original rather than the 2005 11–17 wording. Survey anomaly A-7. | Not True 0, Somewhat True 1, Certainly True 2 in every version | Published allocation and reversals (7, 11, 14, 21, 25); scores are right. Whether the 11–17 cut-points and British norms apply to this mixed wording is a question for youthinmind — **decision needed**. |
| RCADS-25 | As the RCADS-47 items; item 17 reads "think special thoughts (like number or words) to stop bad things happening" for "think of special thoughts (like numbers or words) to stop bad things from happening" | Never 0 … Always 3; skippable, as the instructions say | Fixed (§9.3) |
| SWEMWBS | The seven items verbatim | None of the time 1 … All of the time 5 | Raw total and metric conversion as published; raw 23→20.73, 24→21.54, 30→27.03, 32→29.31 confirmed against a published source. Whether Warwick's bands apply to raw or metric scores, and their use at 11–16, to confirm (the dashboard bands the metric score). |
| STAI-5 | The five state items verbatim | Not at all 1, Somewhat 2, Moderately 3, Very much 4 — the STAI's anchors are "Moderately so" and "Very much so" | Sum, none reversed: right |
| BIS/BAS (12) | 4 of 7 BIS, 4 of 5 Reward, all 4 Drive items; no Fun Seeking. The instructions say "agree or disagree" but the answers are "Very true for me … Very false for me". | 1 very true … 4 very false | All reversed so higher = more of the trait; the two reverse-keyed BIS items are not administered, so this is right |
| EHI-SF | Veale's four items (stems reworded as questions from r6.0.0) | Always right … Always left, codes 1–5 | +100 … −100, mean: right; Veale's bands |
| KSS | As published | 1 Extremely alert … 9 Very sleepy, fighting sleep (numbered "1 - …" before r5.0.0) | As answered; "7 or more = sleepy" is a convention, not a published cut-off |
| MacArthur SSS-Y | Society and school ladders | Rung 1 bottom … 10 top in every version | As answered: right |
| Screen and social-media attitudes | "…my mental wellbeing are mostly positive" against "…my wellbeing are mostly negative": not parallel, though the impact balance treats them as mirror images | **1 = strongly agree** (agree-first) | Re-coded so 5 = strongly agree; "I can control…" scored against dependence: right |
| Doomscrolling (4) | Source unconfirmed (survey A-23) | **1 = strongly disagree** (disagree-first) | Mean, higher = more: right |
| Social-media time, gaming, phone age | — | Bands and ages; "not sure" and "don't know" marked as such | Band midpoints and ages as documented in docs/08: right |

Agreement scales run in **opposite directions** in the same survey (screen,
social-media impact and "I lose track" agree-first; doomscrolling disagree-first).
The dashboard's scores put them on one direction; raw codes in exports keep the
survey's, and the codebook says which is which.

## 9.6 Changes between versions

- **Per-app "time in one go" (11 questions), r5.0.0**: code 1 changed from "0
  minutes" to "I have it but barely use it", and the band edges moved ("1–15" →
  "up to 15", "15–30" → "16 to 30"…). Codes 2–6 are broadly comparable; **code 1 is
  not**: keep the periods apart, or treat code 1 as its own category. BIDS sidecars
  record each version's codes (`LevelsByVersion`) for every item whose labels changed.
- **Gaming hours, r5.0.0**: "6–10 hours" became "5 to 10 hours", closing the gap at
  exactly 5 hours (survey A-9). Codes keep their order; the versions pool.
- **Hair type, r4.0.0**: the same 12 categories, given names instead of 1a…4c.
- **KSS, night checks, morning delay, daily time, r5.0.0**: labels reworded, numbers
  unchanged: each code means the same.
- **Wording**: 3 questions in r4.0.0, 8 in r5.0.0 and 4 in r6.0.0 were shortened,
  had instructions or examples removed, or had context moved above the question;
  each was read and none changes what is asked.
- **Questions added and retired**: the secret code became four questions in r4.0.0
  (replacing one form and the validation ID), "Just to check — do you use any of
  these?" was added in r5.0.0, and the two sleep-priority questions were last asked
  in r5.0.0.

No scored instrument (SDQ, RCADS, SWEMWBS, STAI-5, BIS/BAS, EHI-SF, doomscrolling,
screen attitudes) changed a code or a label in any version.

## 9.7 The survey's anomaly report, re-checked (r7.2.0)

| Anomaly | Now |
|---|---|
| A-1 Abstaining question had the wrong text | Fixed: "What effect do you think abstaining from social media would have on you?" |
| A-2 Twitch time shown to X users | Fixed: shown to those who have Twitch |
| A-3 Top games asked of non-gamers | Fixed: asked unless "I do not play video games" |
| A-6 SDQ "Clearly true" | Fixed: "Certainly True" in every MySelf version |
| A-7 SDQ mixes 11–17 and 18+ wording | **Open — decision needed** (§9.5) |
| A-8 KSS label typo and "Fairly alert" | Fixed: published anchors |
| A-9 Gaming band gap at 5 hours | Fixed from r5.0.0 |
| A-17 Scrambled age codes | Clean ordinal codes; "younger than 5" = 4, "not sure" missing |
| A-18 Agreement directions differ | Still so; handled in scoring, stated in the codebook |
| A-19 EHI anchors | Fixed: Veale's anchors |
| A-20 Ladders 0–10 sliders | Fixed: 10-rung ladders |
| A-22 BIS/BAS subset, stray quote | Quote fixed; subset documented as adapted |
| A-23 Doomscrolling source | **Open** |
| A-34 Impact pair typos | Typos fixed; the pair is still not parallel |
| A-36 Overlapping time bands | Fixed from r5.0.0 |
| A-43 Age 5 missing | Fixed: "5" offered |
| A-44 RCADS says skippable but was forced | Fixed: every RCADS item can be skipped |

## 9.8 Names and labels

Every question has a **readable name** and a **label** (`packages/core/src/codebook/names.ts`):

- Published-scale items are `<scale>_<nn>_<gist>`, numbered as in the published
  scale: `sdq_13_unhappy`, `rcads_18_death`, `swemwbs_07_own_mind`,
  `bas_drive_04_no_holds`. SDQ gists follow youthinmind's own variable names.
- Everything else says what it is: `age_first_smartphone` (survey `smartphone_age`),
  `ladder_school` (survey `ses_self`), `sm_bout_tiktok` (time on TikTok in one go).
- Names are lower case, letters, digits and `_`, at most 32 characters: valid
  unchanged in R, Python, SPSS and Stata. Labels are at most 80 characters.

They are used on screen (Questions, Codebook, session review, figures) and as the
**column names of every export**: BIDS phenotype files (`sdq_13_unhappy`,
`sdq_13_unhappy_status`) and CSV/Excel wide files. Nothing is lost: each BIDS
sidecar gives the label (`LongName`), the wording, the codes, the survey variable
(`SurveyVariable`) and the Qualtrics name (`QualtricsVariable`), and the codebook
sheet of every CSV/Excel export maps name ↔ survey variable ↔ Qualtrics name. The
long CSV format carries `name` and `question_label` beside `variable`.

**A new question** in a future survey version shows under its survey variable, and
the review reports it as an error until it is given an entry in `names.ts`. Names
never change once data have been exported under them.

## 9.9 The automated review

`reviewQuality()` checks, for every registered version and the study's current
schemes:

- **Names**: every question named; names safe and unique among the questions shown
  together; labels present and short.
- **Response options**: no shared codes, no empty labels, no "don't know"-type
  option recorded as a real answer; agreement scales running in opposite directions.
- **Scoring**: each scheme checked against each version (items exist and are
  scorable, reversals fit the codes, recodes cover every code); subscale items
  against the published keys (`PUBLISHED_KEYS`); what each response label scores
  against `LABEL_EXPECTATIONS` (31 anchors: the reversed SDQ items, RCADS, SWEMWBS,
  STAI-5, BIS/BAS, KSS, EHI-SF, doomscrolling, agree-first items, time midpoints,
  ages); options that score out of order; cut-points against the published ones
  (`PUBLISHED_BANDS`).
- **Versions**: variable renames, answer-type changes, relabelled, added and removed
  codes (telling rewording that keeps every number from a change of meaning),
  wording changes, questions added and retired.
- **The reviewer's findings** (`REVIEW_NOTES`): what a machine cannot judge —
  wording against the published forms, and the survey-side scoring problems — each
  with its evidence and whether it is open, fixed or needs a decision.

Severity: an **error** means scores or names are wrong — fix before analysis; a
**warning** changes what the data mean or how they may be pooled and needs a
decision; a **note** is worth knowing. With the default schemes, the review of
r1.0.0–r7.3.0 has no errors and two warnings (the SDQ form and per-app time
code 1); the survey-side S6–S8 are notes, fixed in the survey. Tests (`quality.test.ts`) pin that result and show
the review catching each kind of mistake: the old RCADS key, an unreversed SDQ
strength item, an agree-first item scored backwards, a scrambled recode,
parent-report cut-points, and "don't know" recorded as a real answer.

## 9.10 Decisions needed

1. **SDQ form (A-7).** Ask youthinmind whether the 11–17 self-report cut-points and
   norms apply to the wording administered, and choose one form, verbatim, for
   future versions.
2. **SWEMWBS bands.** Confirm against Warwick's user guide whether the bands apply to
   raw or metric scores, and whether to report them at 11–16.
3. **Per-app time, code 1.** Decide how analyses treat "0 minutes" (r1–r4) against
   "I have it but barely use it" (r5 on).
4. **Wording corrections** in §9.5, at the next survey version (S7 and S8 are
   fixed in the survey from r7.3.0; docs/04 §4.2).
5. **Doomscrolling source (A-23)** and the **BIS/BAS subset (A-22)**: record the
   source and prior use.

## 9.11 Sources

- youthinmind, *Scoring the Strengths & Difficulties Questionnaire for age 4-17*
  (11 May 2015), Table 3; SDQ self-report 11–17 form (© Robert Goodman, 2005).
- Ebesutani, C., et al. (2012). The Revised Child Anxiety and Depression
  Scale-Short Version. *Psychological Assessment*, 24(4), 833–845; RCADS child form
  (© 2003 Bruce F. Chorpita) and the RCADS-47 scoring key (rcads.ucla.edu).
- Stewart-Brown, S., et al. (2009). *Health and Quality of Life Outcomes*, 7, 15;
  Warwick Medical School WEMWBS guidance; German SWEMWBS norms (Quality of Life
  Research, 2024) for the conversion values quoted.
- Zsido, A. N., et al. (2020). *Psychiatry Research*, 291, 113223.
- Carver, C. S., & White, T. L. (1994). *JPSP*, 67(2), 319–333.
- Veale, J. F. (2014). *Laterality*, 19(2), 164–177.
- The survey's own anomaly report and QSF findings (faisalmushtaq/MySelf docs/02,
  docs/10).
