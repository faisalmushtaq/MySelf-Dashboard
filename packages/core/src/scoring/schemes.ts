import { scoringScheme, type ScoringScheme, type ScoringSchemeInput, type ThresholdSet } from "./scheme.js";

/**
 * The dashboard's default scoring schemes for the instruments the MySelf
 * survey administers (item keys as in releases r1.0.0–r7.1.0).
 *
 * Every cut-point and reference value here is transcribed from the source it
 * names and ships with `verified: false`: the Scoring settings page shows that,
 * and a researcher marks each one checked against the licensed scoring
 * documentation. Nothing is presented as authoritative until then. A study
 * changes any of it by saving a new version in Scoring settings; these
 * defaults are never edited in place for a live study.
 */

type Input = ScoringSchemeInput;

/** A threshold set from bands written as [label, upper limit, concern level]. */
function bands(
  keyName: string,
  label: string,
  basis: ThresholdSet["basis"],
  source: string,
  rows: [string, number | null, 0 | 1 | 2 | 3 | null][],
  extra: { note?: string; expected?: number[] } = {},
): ThresholdSet {
  return { key: keyName, label, basis, source, verified: false, bands: rows.map(([l, max, level]) => ({ label: l, max, level })), ...extra };
}

// ── SDQ (self-report, 11–17) ───────────────────────────────────────────────

const SDQ_SOURCE = "Goodman, R. (1997; 2001). youthinmind, 'Scoring the Strengths & Difficulties Questionnaire for age 4-17 or 18+' (self-report cut-points).";
const SDQ_FOUR = "youthinmind four-band categorisation (self-report), set so that about 80% of a large UK community sample is close to average, 10% slightly raised, 5% high and 5% very high.";
const SDQ_NORMS = "youthinmind, Normative SDQ data from Britain: self-report, age 11–15 (Meltzer, Gatward, Goodman & Ford, 2000; n = 4,228).";
const FOUR_BAND_SHARES = [0.8, 0.1, 0.05, 0.05];

function sdqDifficulty(
  keyName: string,
  label: string,
  itemsList: string[],
  four: [number, number, number],
  three: [number, number],
  norm: [number, number],
  description: string,
): Input["outputs"][number] {
  return {
    key: keyName,
    label,
    description,
    calc: { op: "sum", items: itemsList, minValid: 3, prorate: true },
    range: [0, 10],
    higherIs: "worse",
    thresholds: [
      bands("four_band", "Four-band categorisation", "published", SDQ_FOUR, [["Close to average", four[0], 0], ["Slightly raised", four[1], 1], ["High", four[2], 2], ["Very high", null, 3]], { expected: FOUR_BAND_SHARES }),
      bands("three_band", "Original three-band categorisation", "published", SDQ_SOURCE, [["Normal", three[0], 0], ["Borderline", three[1], 1], ["Abnormal", null, 3]]),
    ],
    benchmarks: [{ key: "uk_norms_11_15", label: "British norms, 11–15", population: "British 11–15 year olds, self-report, 1999 national survey", source: SDQ_NORMS, verified: false, mean: norm[0], sd: norm[1], n: 4228 }],
  };
}

export const sdq: Input = {
  key: "sdq25_s",
  version: "1.0.0",
  instrument: "sdq25_s",
  name: "Strengths and Difficulties Questionnaire (self-report)",
  abbreviation: "SDQ",
  status: "official",
  method:
    "youthinmind scoring: items coded 0–2 (Not true, Somewhat true, Certainly true); items 7, 11, 14, 21 and 25 reversed; each five-item subscale summed, and prorated (the mean of the items answered × 5, rounded) when 3 or 4 are answered; total difficulties is the sum of the four difficulty subscales and needs all four. Goodman, R. (1997). J Child Psychol Psychiatry, 38(5), 581–586.",
  notes:
    "Externalising (conduct + hyperactivity) and internalising (emotional + peer) follow Goodman, Lamping & Ploubidis (2010), recommended for community samples. The impact supplement is not administered, so no impact score.",
  transforms: [{ op: "reverse", items: ["q7", "q11", "q14", "q21", "q25"], maxPlusMin: 2 }],
  outputs: [
    sdqDifficulty("emotional", "Emotional symptoms", ["q3", "q8", "q13", "q16", "q24"], [4, 5, 6], [5, 6], [2.8, 2.1], "Worries, unhappiness, fears and somatic complaints."),
    sdqDifficulty("conduct", "Conduct problems", ["q5", "q7", "q12", "q18", "q22"], [2, 3, 4], [3, 4], [2.2, 1.7], "Temper, disobedience, fighting, lying and stealing."),
    sdqDifficulty("hyperactivity", "Hyperactivity/inattention", ["q2", "q10", "q15", "q21", "q25"], [5, 6, 7], [5, 6], [3.8, 2.2], "Restlessness, fidgeting, distractibility and impulsivity."),
    sdqDifficulty("peer", "Peer relationship problems", ["q6", "q11", "q14", "q19", "q23"], [2, 3, 4], [3, 5], [1.5, 1.4], "Being alone, lacking friends, being picked on, getting on better with adults."),
    {
      key: "prosocial",
      label: "Prosocial behaviour",
      description: "Kindness, sharing and helping. A strength: higher is better.",
      calc: { op: "sum", items: ["q1", "q4", "q9", "q17", "q20"], minValid: 3, prorate: true },
      range: [0, 10],
      higherIs: "better",
      thresholds: [
        bands("four_band", "Four-band categorisation", "published", SDQ_FOUR, [["Very low", 4, 3], ["Low", 5, 2], ["Slightly lowered", 6, 1], ["Close to average", null, 0]], { expected: [0.05, 0.05, 0.1, 0.8] }),
        bands("three_band", "Original three-band categorisation", "published", SDQ_SOURCE, [["Abnormal", 4, 3], ["Borderline", 5, 1], ["Normal", null, 0]]),
      ],
      benchmarks: [{ key: "uk_norms_11_15", label: "British norms, 11–15", population: "British 11–15 year olds, self-report, 1999 national survey", source: SDQ_NORMS, verified: false, mean: 8.0, sd: 1.7, n: 4228 }],
    },
    {
      key: "total_difficulties",
      label: "Total difficulties",
      description: "Emotional + conduct + hyperactivity + peer problems.",
      calc: { op: "combine", outputs: ["emotional", "conduct", "hyperactivity", "peer"], how: "sum" },
      range: [0, 40],
      higherIs: "worse",
      primary: true,
      thresholds: [
        bands("four_band", "Four-band categorisation", "published", SDQ_FOUR, [["Close to average", 14, 0], ["Slightly raised", 17, 1], ["High", 19, 2], ["Very high", null, 3]], { expected: FOUR_BAND_SHARES }),
        bands("three_band", "Original three-band categorisation", "published", SDQ_SOURCE, [["Normal", 15, 0], ["Borderline", 19, 1], ["Abnormal", null, 3]]),
      ],
      benchmarks: [{ key: "uk_norms_11_15", label: "British norms, 11–15", population: "British 11–15 year olds, self-report, 1999 national survey", source: SDQ_NORMS, verified: false, mean: 10.3, sd: 5.2, n: 4228 }],
    },
    {
      key: "externalising",
      label: "Externalising problems",
      description: "Conduct + hyperactivity (Goodman, Lamping & Ploubidis, 2010).",
      calc: { op: "combine", outputs: ["conduct", "hyperactivity"], how: "sum" },
      range: [0, 20],
      higherIs: "worse",
    },
    {
      key: "internalising",
      label: "Internalising problems",
      description: "Emotional + peer problems (Goodman, Lamping & Ploubidis, 2010).",
      calc: { op: "combine", outputs: ["emotional", "peer"], how: "sum" },
      range: [0, 20],
      higherIs: "worse",
    },
  ],
};

// ── RCADS-25 ───────────────────────────────────────────────────────────────

export const rcads: Input = {
  key: "rcads25",
  version: "1.0.0",
  instrument: "rcads25",
  name: "Revised Child Anxiety and Depression Scale – 25",
  abbreviation: "RCADS-25",
  status: "official",
  method:
    "Raw scores as published: items coded 0–3 (Never … Always); depression is the sum of its 10 items, anxiety the sum of its 15, total the sum of both. Ebesutani, C., et al. (2012). Psychological Assessment, 24(4), 833–845.",
  notes:
    "Clinical thresholds for the RCADS are defined on T-scores from grade- and gender-specific norm tables (T ≥ 65 borderline, T ≥ 70 clinical), not on raw scores. No norm table is included, so raw scores are compared within the study only. By default every item must be answered; the official scoring programs' missing-item rules can be matched by changing minValid and proration.",
  outputs: [
    {
      key: "depression",
      label: "Depression",
      calc: { op: "sum", items: ["q1", "q4", "q8", "q10", "q13", "q15", "q16", "q18", "q19", "q21"], minValid: 10 },
      range: [0, 30],
      higherIs: "worse",
    },
    {
      key: "anxiety",
      label: "Anxiety",
      calc: { op: "sum", items: ["q2", "q3", "q5", "q6", "q7", "q9", "q11", "q12", "q14", "q17", "q20", "q22", "q23", "q24", "q25"], minValid: 15 },
      range: [0, 45],
      higherIs: "worse",
    },
    { key: "total", label: "Total anxiety and depression", calc: { op: "combine", outputs: ["depression", "anxiety"], how: "sum" }, range: [0, 75], higherIs: "worse", primary: true },
  ],
};

// ── SWEMWBS ────────────────────────────────────────────────────────────────

/** SWEMWBS raw total → metric score (Rasch conversion, Stewart-Brown et al., 2009). */
export const SWEMWBS_METRIC: Record<string, number> = {
  "7": 7.0, "8": 9.51, "9": 11.25, "10": 12.4, "11": 13.33, "12": 14.08, "13": 14.75, "14": 15.32, "15": 15.84, "16": 16.36,
  "17": 16.88, "18": 17.43, "19": 17.98, "20": 18.59, "21": 19.25, "22": 19.98, "23": 20.73, "24": 21.54, "25": 22.35, "26": 23.21,
  "27": 24.11, "28": 25.03, "29": 26.02, "30": 27.03, "31": 28.13, "32": 29.31, "33": 30.7, "34": 32.55, "35": 35.0,
};

export const swemwbs: Input = {
  key: "swemwbs",
  version: "1.0.0",
  instrument: "swemwbs",
  name: "Short Warwick–Edinburgh Mental Wellbeing Scale",
  abbreviation: "SWEMWBS",
  status: "official",
  method:
    "Warwick scoring: seven items coded 1–5 summed to a raw total (7–35), which is converted to a metric score with the published Rasch conversion table; analyses use the metric score. Stewart-Brown, S., et al. (2009). Health Qual Life Outcomes, 7, 15. All seven items are required.",
  outputs: [
    {
      key: "raw_total",
      label: "Raw total",
      calc: { op: "sum", items: ["optimistic", "useful", "relaxed", "problems", "thinking", "close", "mind"], minValid: 7 },
      range: [7, 35],
      higherIs: "better",
    },
    {
      key: "metric",
      label: "Mental wellbeing (metric score)",
      description: "The raw total on SWEMWBS's interval scale. Higher is better.",
      calc: { op: "convert", output: "raw_total", table: SWEMWBS_METRIC },
      range: [7, 35],
      decimals: 2,
      higherIs: "better",
      primary: true,
      thresholds: [
        bands(
          "warwick_bands",
          "Warwick wellbeing bands",
          "published",
          "Warwick Medical School, 'Collect, score, analyse and interpret WEMWBS': SWEMWBS 7–17 probable depression, 18–20 possible depression, 21–27 average, 28–35 high wellbeing; derived in adults (Shah et al., 2021, Health Qual Life Outcomes).",
          [["Probable depression", 17.5, 3], ["Possible depression", 20.5, 2], ["Average", 27.5, 0], ["High wellbeing", null, 0]],
          { note: "Bands are published as whole numbers; metric scores are rounded to the nearest whole number before banding (so the limits sit at .5). Validated in adults; interpret with care at 11–16." },
        ),
      ],
    },
  ],
};

// ── STAI-5 ─────────────────────────────────────────────────────────────────

export const stai5: Input = {
  key: "stai5_s",
  version: "1.0.0",
  instrument: "stai5_s",
  name: "State-Trait Anxiety Inventory, 5-item state form",
  abbreviation: "STAI-5",
  status: "official",
  method:
    "Sum of the five items coded 1–4 (Not at all … Very much); all five describe anxiety, so none is reversed. Zsido, A. N., et al. (2020). Psychiatry Research, 291, 113223. All five items are required.",
  notes: "State anxiety at the moment of answering; no published cut-points for the five-item form.",
  outputs: [
    {
      key: "state_anxiety",
      label: "State anxiety",
      calc: { op: "sum", items: ["upset", "frightened", "nervous", "jittery", "confused"], minValid: 5 },
      range: [5, 20],
      higherIs: "worse",
      primary: true,
    },
  ],
};

// ── BIS/BAS (12-item subset) ───────────────────────────────────────────────

export const bisbas: Input = {
  key: "bisbas12_ybm",
  version: "1.0.0",
  instrument: "bisbas12_ybm",
  name: "BIS/BAS scales, 12-item YBM subset",
  abbreviation: "BIS/BAS-12",
  status: "adapted",
  method:
    "Carver & White (1994) scoring applied to the administered items: responses 1 (very true for me) … 4 (very false for me) are reversed (5 − response) so that higher means more of the trait — the original reverses every item except 2 and 22, neither of which is administered — and each subscale is summed. Carver, C. S., & White, T. L. (1994). JPSP, 67(2), 319–333.",
  notes:
    "BAS Drive is the complete four-item subscale. BIS (4 of 7 items) and Reward Responsiveness (4 of 5) are shortened, so their sums are not comparable with published norms for the full scales.",
  transforms: [{ op: "reverse", items: ["bis1", "bis2", "bis3", "bis4", "rr1", "rr2", "rr3", "rr4", "dr1", "dr2", "dr3", "dr4"], maxPlusMin: 5 }],
  outputs: [
    { key: "bis", label: "Behavioural inhibition (BIS, 4 items)", calc: { op: "sum", items: ["bis1", "bis2", "bis3", "bis4"], minValid: 4 }, range: [4, 16], higherIs: "neutral", primary: true },
    { key: "bas_reward", label: "BAS reward responsiveness (4 items)", calc: { op: "sum", items: ["rr1", "rr2", "rr3", "rr4"], minValid: 4 }, range: [4, 16], higherIs: "neutral" },
    { key: "bas_drive", label: "BAS drive", calc: { op: "sum", items: ["dr1", "dr2", "dr3", "dr4"], minValid: 4 }, range: [4, 16], higherIs: "neutral" },
  ],
};

// ── EHI-SF ─────────────────────────────────────────────────────────────────

export const ehi: Input = {
  key: "ehi_sf",
  version: "1.0.0",
  instrument: "ehi_sf",
  name: "Edinburgh Handedness Inventory – Short Form",
  abbreviation: "EHI-SF",
  status: "official",
  method:
    "Veale (2014): each item scored always right = 100, usually right = 50, both equally = 0, usually left = −50, always left = −100; the laterality quotient is the mean of the four. Veale, J. F. (2014). Laterality, 19(2), 164–177.",
  transforms: [{ op: "recode", items: ["writing", "throwing", "toothbrush", "spoon"], map: { "1": 100, "2": 50, "3": 0, "4": -50, "5": -100 } }],
  outputs: [
    {
      key: "lq",
      label: "Laterality quotient",
      description: "−100 (fully left-handed) to +100 (fully right-handed).",
      calc: { op: "mean", items: ["writing", "throwing", "toothbrush", "spoon"], minValid: 4 },
      range: [-100, 100],
      decimals: 1,
      higherIs: "neutral",
      primary: true,
      thresholds: [bands("veale_2014", "Handedness (Veale, 2014)", "published", "Veale (2014): left-handed −100 to −61, mixed-handed −60 to 60, right-handed 61 to 100.", [["Left-handed", -61, null], ["Mixed-handed", 60, null], ["Right-handed", null, null]])],
    },
  ],
};

// ── KSS ────────────────────────────────────────────────────────────────────

export const kss: Input = {
  key: "kss",
  version: "1.0.0",
  instrument: "kss",
  name: "Karolinska Sleepiness Scale",
  abbreviation: "KSS",
  status: "official",
  method: "The single rating, 1 (extremely alert) to 9 (very sleepy, fighting sleep), is the score. Åkerstedt, T., & Gillberg, M. (1990). Int J Neurosci, 52(1–2), 29–37.",
  outputs: [
    {
      key: "sleepiness",
      label: "Sleepiness right now",
      calc: { op: "item", item: "q1" },
      range: [1, 9],
      higherIs: "worse",
      primary: true,
      thresholds: [
        bands("sleepy_7", "Sleepy (7 or more)", "convention", "Ratings of 7 or more ('sleepy') are widely used to mark sleepiness, e.g. Åkerstedt, Anund, Axelsson & Kecklund (2014), J Sleep Res, 23(3), 240–252.", [["Not sleepy (1–6)", 6, 0], ["Sleepy (7–9)", null, 2]]),
      ],
    },
  ],
};

// ── MacArthur SSS (youth) ──────────────────────────────────────────────────

export const macarthur: Input = {
  key: "macarthur_ssy",
  version: "1.0.0",
  instrument: "macarthur_ssy",
  name: "MacArthur Scale of Subjective Social Status – Youth",
  abbreviation: "MacArthur SSS-Y",
  status: "official",
  method: "Each ladder is scored separately as the rung chosen, 1 (bottom) to 10 (top). Goodman, E., et al. (2001). Pediatrics, 108(2), e31.",
  outputs: [
    { key: "society", label: "Family's place in society", calc: { op: "item", item: "family" }, range: [1, 10], higherIs: "neutral", primary: true },
    { key: "school", label: "Own standing at school", calc: { op: "item", item: "self" }, range: [1, 10], higherIs: "neutral" },
  ],
};

// ── Study-defined summaries ────────────────────────────────────────────────

const AGREE_UP: Record<string, number | null> = { "1": 5, "2": 4, "3": 3, "4": 2, "5": 1 };

export const doomscroll: Input = {
  key: "doomscroll4",
  version: "1.0.0",
  instrument: "doomscroll4",
  name: "Doomscrolling (4 items)",
  abbreviation: "DS-4",
  status: "study",
  method: "Mean agreement across the four items, 1 (strongly disagree) to 7 (strongly agree), when at least three are answered. The items' source scale (possibly Sharma, Lee & Johnson, 2022) is still to be confirmed, so no published scoring is assumed.",
  outputs: [{ key: "doomscrolling", label: "Doomscrolling", calc: { op: "mean", items: ["q1", "q2", "q3", "q4"], minValid: 3 }, range: [1, 7], decimals: 2, higherIs: "worse", primary: true }],
};

export const screenAttitudes: Input = {
  key: "ybm_screen_attitudes",
  version: "1.0.0",
  instrument: "ybm_screen_attitudes",
  name: "Screen control and social-media impact",
  status: "study",
  method:
    "Study-defined. Agreement is re-coded so 5 = strongly agree. Screen dependence is the mean of 'dependent', 'addicted' and 'I can control my screen behaviours' reversed, when at least two are answered (1–5, higher = more dependence). Social-media impact balance is agreement that the impact is mostly positive minus agreement that it is mostly negative (−4 to 4).",
  transforms: [{ op: "recode", items: ["dependent", "addicted", "impact_positive", "impact_negative"], map: AGREE_UP }],
  outputs: [
    { key: "screen_dependence", label: "Screen dependence", calc: { op: "mean", items: ["dependent", "addicted", "control"], minValid: 2 }, range: [1, 5], decimals: 2, higherIs: "worse", primary: true },
    { key: "impact_positive", label: "Social media mostly positive (agreement)", calc: { op: "item", item: "impact_positive" }, range: [1, 5], higherIs: "neutral" },
    { key: "impact_negative", label: "Social media mostly negative (agreement)", calc: { op: "item", item: "impact_negative" }, range: [1, 5], higherIs: "neutral" },
    { key: "impact_balance", label: "Social-media impact balance", description: "Positive minus negative agreement.", calc: { op: "combine", outputs: ["impact_positive", "impact_negative"], how: "difference" }, range: [-4, 4], higherIs: "better" },
  ],
};

/** Band midpoints, in hours, for the 9-band daily social-media question; the open top band is taken as 7.5. */
const DAILY_HOURS: Record<string, number | null> = { "1": 0.25, "2": 0.75, "3": 1.5, "4": 2.5, "5": 3.5, "6": 4.5, "7": 5.5, "8": 6.5, "9": 7.5 };
const HEAVY_DAY = (source: string) =>
  bands("three_hours", "3 hours or more a day", "convention", source, [["Under 3 hours", 2.99, 0], ["3 hours or more", null, 2]]);
const RIEHM = "More than 3 hours a day of social media is a common research threshold, e.g. Riehm, K. E., et al. (2019). JAMA Psychiatry, 76(12), 1266–1273.";

export const socialMedia: Input = {
  key: "ybm_social_media",
  version: "1.0.0",
  instrument: "ybm_social_media",
  name: "Social-media use",
  status: "study",
  method:
    "Study-defined. Daily time is taken as the midpoint of the band chosen (the open '7 hours or more' band as 7.5 h); weekly time is 5 school days + 2 other days. Night-time checking is 0 (never) to 3 (more than 5 times). Losing track is agreement, 1–5, with 'don't know' missing.",
  transforms: [
    { op: "recode", items: ["time_school_day", "time_nonschool_day"], map: DAILY_HOURS },
    { op: "recode", items: ["night_checks"], map: { "1": 0, "2": 1, "3": 2, "4": 3 } },
    { op: "recode", items: ["lose_track"], map: { ...AGREE_UP, "6": null } },
  ],
  outputs: [
    { key: "hours_school_day", label: "Social media on a school day (hours)", calc: { op: "item", item: "time_school_day" }, range: [0, 7.5], decimals: 1, higherIs: "worse", primary: true, thresholds: [HEAVY_DAY(RIEHM)] },
    { key: "hours_other_day", label: "Social media on other days (hours)", calc: { op: "item", item: "time_nonschool_day" }, range: [0, 7.5], decimals: 1, higherIs: "worse", thresholds: [HEAVY_DAY(RIEHM)] },
    { key: "hours_week", label: "Social media per week (hours)", calc: { op: "combine", outputs: ["hours_school_day", "hours_other_day"], how: "sum", weights: [5, 2] }, range: [0, 52.5], decimals: 1, higherIs: "worse" },
    {
      key: "night_checking",
      label: "Night-time checking",
      description: "0 never, 1 once or twice, 2 three to five times, 3 more than five times a night.",
      calc: { op: "item", item: "night_checks" },
      range: [0, 3],
      higherIs: "worse",
      thresholds: [bands("any", "Any night-time checking", "study", "Study-defined: checking social media at least once on a typical night.", [["Never", 0, 0], ["At least once a night", null, 2]])],
    },
    { key: "lose_track", label: "Loses track of time on social media (agreement)", calc: { op: "item", item: "lose_track" }, range: [1, 5], higherIs: "worse" },
  ],
};

export const gaming: Input = {
  key: "ybm_gaming",
  version: "1.0.0",
  instrument: "ybm_gaming",
  name: "Gaming",
  status: "study",
  method: "Study-defined. Weekly gaming time is the midpoint of the band chosen (0 for 'I do not play'; the open 'more than 20 hours' band as 25 h). Playing with others is the percentage given.",
  transforms: [{ op: "recode", items: ["hours_week"], map: { "1": 0, "2": 2.5, "3": 7.5, "4": 13, "5": 18, "6": 25 } }],
  outputs: [
    {
      key: "hours_week",
      label: "Gaming per week (hours)",
      calc: { op: "item", item: "hours_week" },
      range: [0, 25],
      decimals: 1,
      higherIs: "worse",
      primary: true,
      thresholds: [bands("over_20", "More than 20 hours a week", "study", "Study-defined: the survey's top band.", [["20 hours or less", 20, 0], ["More than 20 hours", null, 2]])],
    },
    { key: "social_pct", label: "Gaming with others (%)", calc: { op: "item", item: "social_pct" }, range: [0, 100], higherIs: "neutral" },
  ],
};

/** Age bands: code 1 'younger than 5' taken as 4; codes 2–22 are ages 5–25; 99 (not sure) missing. */
const AGE_MAP: Record<string, number | null> = { "1": 4, ...Object.fromEntries(Array.from({ length: 21 }, (_, i) => [String(i + 2), i + 5])), "99": null };

export const smartphone: Input = {
  key: "ybm_smartphone",
  version: "1.0.0",
  instrument: "ybm_smartphone",
  name: "Smartphone and social-media start",
  status: "study",
  method: "Study-defined. The age given, in years ('younger than 5' taken as 4, 'not sure' missing).",
  transforms: [{ op: "recode", items: ["age_smartphone", "age_sm"], map: AGE_MAP }],
  outputs: [
    { key: "age_first_smartphone", label: "Age at first smartphone", calc: { op: "item", item: "age_smartphone" }, range: [4, 25], higherIs: "neutral", primary: true },
    { key: "age_first_social_media", label: "Age at first social media", calc: { op: "item", item: "age_sm" }, range: [4, 25], higherIs: "neutral" },
  ],
};

/** Every default, in the order instruments appear in the survey. */
export const DEFAULT_SCHEME_INPUTS: readonly Input[] = [ehi, macarthur, kss, swemwbs, sdq, rcads, smartphone, socialMedia, screenAttitudes, doomscroll, gaming, stai5, bisbas];

export const DEFAULT_SCHEMES: readonly ScoringScheme[] = DEFAULT_SCHEME_INPUTS.map((s) => scoringScheme.parse(s));
