/**
 * What the quality review checks the survey and the scoring schemes against:
 * published scoring keys and cut-points, what each response label must score,
 * and the reviewer's own findings about wording.
 *
 * Everything here was checked against the source it names (docs/09). The
 * review compares the study's *current* schemes with it, so a scheme edited in
 * Settings → Scoring that drifts from a published key is flagged, not trusted.
 */

import type { QualitySeverity } from "./types.js";

// ── Published scoring keys ───────────────────────────────────────────────────

export interface PublishedKey {
  scheme: string;
  output: string;
  /** Items the output is built from (item keys, without the instrument). */
  items: string[];
  source: string;
}

const SDQ_KEY = "youthinmind, 'Scoring the Strengths & Difficulties Questionnaire for age 4-17' (11 May 2015); Goodman (1997).";
const RCADS_KEY =
  "RCADS-25 (Ebesutani et al., 2012, Psychological Assessment 24(4)): depression = items 1, 4, 8, 10, 13, 15, 16, 19, 21, 24 — the full RCADS's ten major-depression items (RCADS-47 items 2, 6, 11, 15, 19, 21, 25, 29, 40, 47); anxiety = the other 15.";

export const PUBLISHED_KEYS: readonly PublishedKey[] = [
  { scheme: "sdq25_s", output: "emotional", items: ["q3", "q8", "q13", "q16", "q24"], source: SDQ_KEY },
  { scheme: "sdq25_s", output: "conduct", items: ["q5", "q7", "q12", "q18", "q22"], source: SDQ_KEY },
  { scheme: "sdq25_s", output: "hyperactivity", items: ["q2", "q10", "q15", "q21", "q25"], source: SDQ_KEY },
  { scheme: "sdq25_s", output: "peer", items: ["q6", "q11", "q14", "q19", "q23"], source: SDQ_KEY },
  { scheme: "sdq25_s", output: "prosocial", items: ["q1", "q4", "q9", "q17", "q20"], source: SDQ_KEY },
  { scheme: "rcads25", output: "depression", items: ["q1", "q4", "q8", "q10", "q13", "q15", "q16", "q19", "q21", "q24"], source: RCADS_KEY },
  { scheme: "rcads25", output: "anxiety", items: ["q2", "q3", "q5", "q6", "q7", "q9", "q11", "q12", "q14", "q17", "q18", "q20", "q22", "q23", "q25"], source: RCADS_KEY },
  { scheme: "swemwbs", output: "raw_total", items: ["optimistic", "useful", "relaxed", "problems", "thinking", "close", "mind"], source: "Stewart-Brown et al. (2009): the seven SWEMWBS items." },
  { scheme: "stai5_s", output: "state_anxiety", items: ["upset", "frightened", "nervous", "jittery", "confused"], source: "Zsido et al. (2020): the five STAI-5 state items." },
  { scheme: "bisbas12_ybm", output: "bis", items: ["bis1", "bis2", "bis3", "bis4"], source: "Carver & White (1994): BIS items administered." },
  { scheme: "bisbas12_ybm", output: "bas_reward", items: ["rr1", "rr2", "rr3", "rr4"], source: "Carver & White (1994): Reward Responsiveness items administered." },
  { scheme: "bisbas12_ybm", output: "bas_drive", items: ["dr1", "dr2", "dr3", "dr4"], source: "Carver & White (1994): the four Drive items." },
  { scheme: "ehi_sf", output: "lq", items: ["writing", "throwing", "toothbrush", "spoon"], source: "Veale (2014): the four EHI-SF items." },
];

// ── What each response label must score ─────────────────────────────────────

/**
 * An anchor: under this scheme, the option whose label matches must score this
 * value (after reversals and recodes; null = counted as missing). This is what
 * ties the words a participant tapped to the number in the analysis: a reversed
 * item, a scale that runs the other way, a re-ordered option list or a recode
 * typo all break one.
 */
export interface LabelExpectation {
  scheme: string;
  items: string[];
  label: RegExp;
  value: number | null;
  why: string;
}

const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const SDQ_REVERSED = ["q7", "q11", "q14", "q21", "q25"];
const SDQ_FORWARD = range("q", 25).filter((q) => !SDQ_REVERSED.includes(q));

export const LABEL_EXPECTATIONS: readonly LabelExpectation[] = [
  { scheme: "sdq25_s", items: SDQ_FORWARD, label: /^certainly true$/i, value: 2, why: "SDQ items score 0–2; 'Certainly true' is 2 on every item except the five reversed ones." },
  { scheme: "sdq25_s", items: SDQ_FORWARD, label: /^not true$/i, value: 0, why: "SDQ: 'Not true' scores 0 on the unreversed items." },
  { scheme: "sdq25_s", items: SDQ_REVERSED, label: /^certainly true$/i, value: 0, why: "SDQ items 7, 11, 14, 21 and 25 describe strengths and are reversed: 'Certainly true' scores 0." },
  { scheme: "sdq25_s", items: SDQ_REVERSED, label: /^not true$/i, value: 2, why: "SDQ reversed items: 'Not true' scores 2." },
  { scheme: "rcads25", items: range("q", 25), label: /^always$/i, value: 3, why: "RCADS items score Never 0 … Always 3; none is reversed." },
  { scheme: "rcads25", items: range("q", 25), label: /^never$/i, value: 0, why: "RCADS: 'Never' scores 0." },
  { scheme: "swemwbs", items: ["optimistic", "useful", "relaxed", "problems", "thinking", "close", "mind"], label: /^all of the time$/i, value: 5, why: "SWEMWBS items score None of the time 1 … All of the time 5; none is reversed." },
  { scheme: "swemwbs", items: ["optimistic", "useful", "relaxed", "problems", "thinking", "close", "mind"], label: /^none of the time$/i, value: 1, why: "SWEMWBS: 'None of the time' scores 1." },
  { scheme: "stai5_s", items: ["upset", "frightened", "nervous", "jittery", "confused"], label: /^very much/i, value: 4, why: "STAI-5 items all describe anxiety: 'Very much (so)' scores 4." },
  { scheme: "stai5_s", items: ["upset", "frightened", "nervous", "jittery", "confused"], label: /^not at all$/i, value: 1, why: "STAI-5: 'Not at all' scores 1." },
  { scheme: "bisbas12_ybm", items: [...range("bis", 4), ...range("rr", 4), ...range("dr", 4)], label: /^very true/i, value: 4, why: "BIS/BAS items administered are all keyed toward the trait, so 'Very true for me' scores 4 once responses are reversed (Carver & White, 1994)." },
  { scheme: "bisbas12_ybm", items: [...range("bis", 4), ...range("rr", 4), ...range("dr", 4)], label: /^very false/i, value: 1, why: "BIS/BAS: 'Very false for me' scores 1." },
  { scheme: "kss", items: ["q1"], label: /^extremely alert$/i, value: 1, why: "KSS runs 1 (extremely alert) to 9 (fighting sleep)." },
  { scheme: "kss", items: ["q1"], label: /fighting sleep/i, value: 9, why: "KSS: the sleepiest anchor is 9." },
  { scheme: "ehi_sf", items: ["writing", "throwing", "toothbrush", "spoon"], label: /^always right$/i, value: 100, why: "EHI-SF: 'Always right' scores +100 (Veale, 2014)." },
  { scheme: "ehi_sf", items: ["writing", "throwing", "toothbrush", "spoon"], label: /^both equally$/i, value: 0, why: "EHI-SF: 'Both equally' scores 0." },
  { scheme: "ehi_sf", items: ["writing", "throwing", "toothbrush", "spoon"], label: /^always left$/i, value: -100, why: "EHI-SF: 'Always left' scores −100." },
  { scheme: "doomscroll4", items: range("q", 4), label: /^strongly agree$/i, value: 7, why: "Doomscrolling runs 1 (strongly disagree) to 7 (strongly agree): more agreement, more doomscrolling." },
  { scheme: "ybm_screen_attitudes", items: ["dependent", "addicted", "impact_positive", "impact_negative"], label: /^strongly agree$/i, value: 5, why: "These are asked agree-first (1 = strongly agree) and re-coded so 5 = strongly agree." },
  { scheme: "ybm_screen_attitudes", items: ["control"], label: /^strongly agree$/i, value: 1, why: "'I can control my screen behaviours' counts against screen dependence: strongly agreeing is the least dependent, 1." },
  { scheme: "ybm_social_media", items: ["lose_track"], label: /^strongly agree$/i, value: 5, why: "Asked agree-first; re-coded so 5 = strongly agree (loses track most)." },
  { scheme: "ybm_social_media", items: ["lose_track"], label: /know/i, value: null, why: "'Don't know' is not a level of agreement: missing." },
  { scheme: "ybm_social_media", items: ["night_checks"], label: /^never$/i, value: 0, why: "Night-time checks: never is 0." },
  { scheme: "ybm_social_media", items: ["night_checks"], label: /more than 5/i, value: 3, why: "Night-time checks: more than five times is 3." },
  { scheme: "ybm_social_media", items: ["time_school_day", "time_nonschool_day"], label: /^less than 30 minutes$/i, value: 0.25, why: "Daily time: the midpoint of 'less than 30 minutes' is a quarter of an hour." },
  { scheme: "ybm_social_media", items: ["time_school_day", "time_nonschool_day"], label: /^7 hours or more$/i, value: 7.5, why: "Daily time: the open top band is taken as 7.5 hours." },
  { scheme: "ybm_gaming", items: ["hours_week"], label: /do not play/i, value: 0, why: "Not playing is 0 hours." },
  { scheme: "ybm_gaming", items: ["hours_week"], label: /^more than 20 hours$/i, value: 25, why: "The open top band is taken as 25 hours." },
  { scheme: "ybm_smartphone", items: ["age_smartphone", "age_sm"], label: /^younger than 5$/i, value: 4, why: "'Younger than 5' is taken as 4." },
  { scheme: "ybm_smartphone", items: ["age_smartphone", "age_sm"], label: /^13$/, value: 13, why: "An age option scores the age it says, not its code." },
  { scheme: "ybm_smartphone", items: ["age_smartphone", "age_sm"], label: /not sure/i, value: null, why: "'Not sure' is missing." },
];

// ── Published cut-points ─────────────────────────────────────────────────────

export interface PublishedBands {
  scheme: string;
  output: string;
  set: string;
  /** Upper limit of each band, the last open (null). */
  uppers: (number | null)[];
  source: string;
}

const SDQ_BANDS = "youthinmind, 'Scoring the SDQ for age 4-17' (11 May 2015), Table 3, self-completed SDQ.";

export const PUBLISHED_BANDS: readonly PublishedBands[] = [
  { scheme: "sdq25_s", output: "total_difficulties", set: "four_band", uppers: [14, 17, 19, null], source: SDQ_BANDS },
  { scheme: "sdq25_s", output: "emotional", set: "four_band", uppers: [4, 5, 6, null], source: SDQ_BANDS },
  { scheme: "sdq25_s", output: "conduct", set: "four_band", uppers: [3, 4, 5, null], source: SDQ_BANDS },
  { scheme: "sdq25_s", output: "hyperactivity", set: "four_band", uppers: [5, 6, 7, null], source: SDQ_BANDS },
  { scheme: "sdq25_s", output: "peer", set: "four_band", uppers: [2, 3, 4, null], source: SDQ_BANDS },
  { scheme: "sdq25_s", output: "prosocial", set: "four_band", uppers: [4, 5, 6, null], source: SDQ_BANDS },
  { scheme: "sdq25_s", output: "total_difficulties", set: "three_band", uppers: [15, 19, null], source: SDQ_BANDS },
  { scheme: "sdq25_s", output: "emotional", set: "three_band", uppers: [5, 6, null], source: SDQ_BANDS },
  { scheme: "sdq25_s", output: "conduct", set: "three_band", uppers: [3, 4, null], source: SDQ_BANDS },
  { scheme: "sdq25_s", output: "hyperactivity", set: "three_band", uppers: [5, 6, null], source: SDQ_BANDS },
  { scheme: "sdq25_s", output: "peer", set: "three_band", uppers: [3, 5, null], source: SDQ_BANDS },
  { scheme: "sdq25_s", output: "prosocial", set: "three_band", uppers: [4, 5, null], source: SDQ_BANDS },
  { scheme: "ehi_sf", output: "lq", set: "veale_2014", uppers: [-61, 60, null], source: "Veale (2014), Laterality 19(2): left −100 to −61, mixed −60 to 60, right 61 to 100." },
];

// ── The reviewer's findings ──────────────────────────────────────────────────

/**
 * Findings a machine cannot make: wording compared with the published forms,
 * and scoring problems on the survey's side, which the dashboard does not use
 * but anyone reading the survey's own researcher view or exports should know.
 * Each names its evidence; `status` says where it stands.
 */
export interface ReviewNote {
  id: string;
  severity: QualitySeverity;
  area: "wording" | "scoring" | "responses";
  instrument?: string;
  keys: string[];
  title: string;
  detail: string;
  source?: string;
  status: "open" | "fixed" | "decision";
}

export const REVIEW_NOTES: readonly ReviewNote[] = [
  {
    id: "wording.sdq_form",
    severity: "warning",
    area: "wording",
    instrument: "sdq25_s",
    keys: ["sdq25_s.q19", "sdq25_s.q20", "sdq25_s.q22", "sdq25_s.q4", "sdq25_s.q6", "sdq25_s.q13", "sdq25_s.q23"],
    title: "SDQ items 19, 20 and 22 use the adult (18+) wording, not the 11–17 self-report",
    detail:
      "Compared with youthinmind's 11–17 self-report (2005 revision): 19 'Other people pick on me or bully me' (11–17: 'Other children or young people…'), 20 '…(family members, friends, colleagues)' (11–17: '(parents, teachers, children)') and 22 '…from home, work or elsewhere' (11–17: '…home, school or elsewhere') are the 18+ phrasings. Items 4, 6, 13 and 23 follow the original 11–17 wording rather than the 2005 revision ('pens etc.', 'play alone', 'down-hearted', 'get on better'). The items and their scoring are the same, so the scores are computed correctly, but the dashboard's cut-points and British norms are for the 11–17 form: whether they apply to this mixed wording is a question for youthinmind, and future versions should use one form verbatim. Survey anomaly A-7.",
    source: "youthinmind SDQ self-report 11–17 (© Robert Goodman, 2005); survey docs/02 A-7.",
    status: "decision",
  },
  {
    id: "wording.rcads_17",
    severity: "note",
    area: "wording",
    instrument: "rcads25",
    keys: ["rcads25.q17"],
    title: "RCADS item 17 differs slightly from the published wording",
    detail: "The survey asks 'I have to think special thoughts (like number or words) to stop bad things happening'; the published item is 'I have to think of special thoughts (like numbers or words) to stop bad things from happening'. The meaning is unchanged; correct it in a future version.",
    source: "RCADS child/young person form (© 2003 Bruce F. Chorpita), item 31 of 47.",
    status: "open",
  },
  {
    id: "wording.stai_labels",
    severity: "note",
    area: "wording",
    instrument: "stai5_s",
    keys: ["stai5_s.upset", "stai5_s.frightened", "stai5_s.nervous", "stai5_s.jittery", "stai5_s.confused"],
    title: "STAI-5 response labels are shortened",
    detail: "The survey shows 'Moderately' and 'Very much'; the STAI's anchors are 'Moderately so' and 'Very much so'. Codes and scoring are unaffected; restore the published anchors in a future version (licensing permitting — survey A-21).",
    source: "Spielberger STAI state form anchors; Zsido et al. (2020).",
    status: "open",
  },
  {
    id: "wording.bisbas_instructions",
    severity: "note",
    area: "wording",
    instrument: "bisbas12_ybm",
    keys: ["bisbas12_ybm.bis1"],
    title: "BIS/BAS instructions ask for agreement, the answers are 'true for me'",
    detail: "The instructions say 'say how much you agree or disagree', but the options are 'Very true for me … Very false for me', as in Carver & White (1994). Align the instructions with the options in a future version; scoring is unaffected.",
    status: "open",
  },
  {
    id: "wording.bisbas_subset",
    severity: "note",
    area: "wording",
    instrument: "bisbas12_ybm",
    keys: ["bisbas12_ybm.bis1", "bisbas12_ybm.rr1", "bisbas12_ybm.dr1"],
    title: "BIS/BAS is a 12-item subset",
    detail: "BIS has 4 of its 7 items, Reward Responsiveness 4 of 5, Drive all 4, Fun Seeking none. The two reverse-keyed BIS items are not among them, so every item is reversed the same way. BIS and Reward sums are not comparable with published norms. Survey anomaly A-22.",
    source: "Carver & White (1994); survey docs/02 A-22.",
    status: "decision",
  },
  {
    id: "wording.impact_pair",
    severity: "note",
    area: "wording",
    instrument: "ybm_screen_attitudes",
    keys: ["ybm_screen_attitudes.impact_positive", "ybm_screen_attitudes.impact_negative"],
    title: "The social-media impact pair is not worded in parallel",
    detail: "'…on my mental wellbeing are mostly positive' against '…on my wellbeing are mostly negative'. The dashboard's impact balance (positive minus negative) assumes the two are mirror images; make them parallel in a future version.",
    source: "Survey docs/02 A-34.",
    status: "open",
  },
  {
    id: "wording.doomscroll_source",
    severity: "note",
    area: "wording",
    instrument: "doomscroll4",
    keys: ["doomscroll4.q1"],
    title: "The doomscrolling items' source is unconfirmed",
    detail: "The four items resemble the Doomscrolling Scale (Sharma, Lee & Johnson, 2022) but the source and permission are not recorded, so the dashboard treats the mean as a study-defined summary. Survey anomaly A-23.",
    status: "decision",
  },
  {
    id: "scoring.swemwbs_bands",
    severity: "note",
    area: "scoring",
    instrument: "swemwbs",
    keys: ["swemwbs.optimistic"],
    title: "SWEMWBS bands: confirm raw or metric, and their use at 11–16",
    detail: "The Warwick bands (7–17 probable depression, 18–20 possible, 21–27 average, 28–35 high) were benchmarked against the PHQ-9 in adults. Public sources do not say plainly whether they apply to raw or metric scores; the dashboard applies them to the metric score, rounded. Confirm against Warwick's user guide before reporting bands.",
    source: "Warwick Medical School guidance; Shah et al. (2021).",
    status: "decision",
  },
  {
    id: "scoring.survey_rcads",
    severity: "warning",
    area: "scoring",
    instrument: "rcads25",
    keys: ["rcads25.q18", "rcads25.q24"],
    title: "The survey's own RCADS subscales swap items 18 and 24 (every version)",
    detail:
      "The survey's scoring definition counts item 18 ('I think about death', a generalised-anxiety item in the full RCADS) as depression and item 24 ('I feel restless', a major-depression item) as anxiety. Its depression and anxiety subscales are each off by one item; the total is right. The dashboard's scheme was corrected in 1.1.0 and is what the dashboard reports and exports; the survey's own researcher view is still affected (survey-side change S8).",
    source: "RCADS-25 key (Ebesutani et al., 2012); RCADS-47 key.",
    status: "open",
  },
  {
    id: "scoring.survey_totals",
    severity: "warning",
    area: "scoring",
    instrument: "sdq25_s",
    keys: ["sdq25_s.q1", "rcads25.q1"],
    title: "The survey's own SDQ total and RCADS total are always blank",
    detail: "The survey's reading of the answers hides subscales from the step that adds them up, so its own SDQ total difficulties and RCADS total are blank in every sitting (survey-side change S7). The dashboard scores them correctly and never exports the survey's own scores.",
    status: "open",
  },
  {
    id: "scoring.survey_swemwbs_stai",
    severity: "note",
    area: "scoring",
    instrument: "swemwbs",
    keys: ["swemwbs.optimistic", "stai5_s.upset"],
    title: "The survey's own SWEMWBS and STAI-5 totals are blank before r7.2.0",
    detail: "Its definitions named items q1… that these instruments never had; fixed from r7.2.0 (survey D-49, S6). Earlier sittings keep blank survey-side totals; the dashboard scores every version from the answers.",
    status: "fixed",
  },
];

/**
 * Changes between versions that a comparison of labels cannot judge: these
 * are raised from a note to a warning, with the explanation.
 */
export const VERSION_ESCALATIONS: readonly { keys: RegExp; version: string; severity: QualitySeverity; detail: string }[] = [
  {
    keys: /^ybm_social_media\.time_(?!school_day$|nonschool_day$)/,
    version: "5.0.0",
    severity: "warning",
    detail:
      "Code 1 meant '0 minutes' in r1.0.0–r4.0.0 and 'I have it but barely use it' from r5.0.0, and the other bands' edges moved ('1–15' → 'up to 15', '15–30' → '16 to 30' …). Codes 2–6 are broadly comparable; code 1 is not: keep the two periods apart, or treat code 1 as its own category.",
  },
  {
    keys: /^ybm_gaming\./,
    version: "5.0.0",
    severity: "note",
    detail:
      "Before r5.0.0 the bands jumped from 'less than 5 hours' to '6–10 hours', so exactly 5 hours had no answer (survey A-9); from r5.0.0 that band reads '5 to 10 hours'. The codes keep their order and the dashboard's band midpoints are unchanged, so the versions pool.",
  },
  {
    keys: /^ybm_eeg_practical\.hair_type$/,
    version: "4.0.0",
    severity: "note",
    detail: "The same twelve hair-type categories (1a … 4c) were given descriptive names from r4.0.0; each code keeps its category.",
  },
];
