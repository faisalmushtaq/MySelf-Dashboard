/**
 * A readable name and a short label for every question the survey has asked,
 * in every version (keyed "<instrument>.<item>").
 *
 * The survey's own variables are stable but often opaque (`sdq25_q13`,
 * `rcads25_q18`, `ses_self`). These are what an analyst sees instead: a name that
 * says what the column is (`sdq_13_unhappy`) and a label that reads as a
 * sentence ("SDQ 13: Often unhappy, down-hearted or tearful"). The survey
 * variable and the original Qualtrics name are kept beside them in every
 * codebook and sidecar, so nothing is lost and old analyses still join.
 *
 * Conventions:
 * - Items of a published scale: `<scale>_<nn>_<gist>`, numbered as in the
 *   published scale (two digits, so they sort), the gist after youthinmind's
 *   own SDQ variable names where there is one.
 * - Everything else: what it is, not where it sits (`age_first_smartphone`,
 *   not `smartphone_age`).
 * - Lower case, letters, digits and underscores, starting with a letter, at most
 *   32 characters: valid in R, Python, SPSS and Stata unchanged.
 * - Labels are at most 80 characters and say the construct, not the wording;
 *   the full wording is always beside them.
 *
 * Names never change once data are exported under them; a new question gets a
 * new entry. `codebookProblems()` (and the tests) insist that every question
 * in every registered release has an entry.
 */
export interface CodebookEntry {
  name: string;
  label: string;
}

const scaleItems = (instrument: string, prefix: string, labelPrefix: string, rows: [string, string, string][]): Record<string, CodebookEntry> =>
  Object.fromEntries(
    rows.map(([item, gist, label], i) => {
      const n = String(i + 1).padStart(2, "0");
      return [`${instrument}.${item}`, { name: `${prefix}_${n}_${gist}`, label: `${labelPrefix} ${i + 1}: ${label}` }];
    }),
  );

const sdq = scaleItems("sdq25_s", "sdq", "SDQ", [
  ["q1", "considerate", "Tries to be nice, cares about others' feelings"],
  ["q2", "restless", "Restless, cannot stay still for long"],
  ["q3", "somatic", "Gets a lot of headaches, stomach-aches or sickness"],
  ["q4", "shares", "Usually shares with others"],
  ["q5", "tantrums", "Gets very angry, often loses temper"],
  ["q6", "loner", "Usually on their own, keeps to themselves"],
  ["q7", "obeys", "Usually does as told"],
  ["q8", "worries", "Worries a lot"],
  ["q9", "caring", "Helpful if someone is hurt, upset or ill"],
  ["q10", "fidgety", "Constantly fidgeting or squirming"],
  ["q11", "friend", "Has one good friend or more"],
  ["q12", "fights", "Fights a lot, can make others do what they want"],
  ["q13", "unhappy", "Often unhappy, down-hearted or tearful"],
  ["q14", "popular", "Generally liked by others their age"],
  ["q15", "distractible", "Easily distracted, finds it hard to concentrate"],
  ["q16", "nervous_new", "Nervous in new situations, easily loses confidence"],
  ["q17", "kind", "Kind to younger children"],
  ["q18", "lies", "Often accused of lying or cheating"],
  ["q19", "bullied", "Picked on or bullied"],
  ["q20", "helps_out", "Often offers to help others"],
  ["q21", "reflective", "Thinks before doing things"],
  ["q22", "steals", "Takes things that are not theirs"],
  ["q23", "adults_better", "Gets on better with adults than with peers"],
  ["q24", "fears", "Many fears, easily scared"],
  ["q25", "attends", "Finishes work, attention is good"],
]);

/** The SDQ self-report for 18 and over (r8.0.0 on, D-51): same items and scales, adult wording. */
const sdq18 = scaleItems("sdq25_s18", "sdq18", "SDQ 18+", [
  ["q1", "considerate", "Tries to be nice, cares about others' feelings"],
  ["q2", "restless", "Restless, finds it hard to sit down for long"],
  ["q3", "somatic", "Gets a lot of headaches, stomach-aches or sickness"],
  ["q4", "shares", "Usually shares with others"],
  ["q5", "tantrums", "Gets very angry, often loses temper"],
  ["q6", "loner", "Would rather be alone than with other people"],
  ["q7", "obliging", "Generally willing to do what others want"],
  ["q8", "worries", "Worries a lot"],
  ["q9", "caring", "Helpful if someone is hurt, upset or ill"],
  ["q10", "fidgety", "Constantly fidgeting or squirming"],
  ["q11", "friend", "Has at least one good friend"],
  ["q12", "fights", "Fights a lot, can make others do what they want"],
  ["q13", "unhappy", "Often unhappy, depressed or tearful"],
  ["q14", "popular", "Generally liked by other people"],
  ["q15", "distractible", "Easily distracted, finds it hard to concentrate"],
  ["q16", "nervous_new", "Nervous in new situations, easily loses confidence"],
  ["q17", "kind", "Kind to children"],
  ["q18", "lies", "Often accused of lying or cheating"],
  ["q19", "bullied", "Picked on or bullied"],
  ["q20", "helps_out", "Often offers to help others"],
  ["q21", "reflective", "Thinks before doing things"],
  ["q22", "steals", "Takes things that are not theirs"],
  ["q23", "older_better", "Gets on better with older people than with peers"],
  ["q24", "fears", "Many fears, easily scared"],
  ["q25", "attends", "Finishes work, attention is good"],
]);

const rcads = scaleItems("rcads25", "rcads", "RCADS", [
  ["q1", "sad_empty", "Feels sad or empty"],
  ["q2", "worry_did_poorly", "Worries after doing poorly at something"],
  ["q3", "afraid_alone_home", "Would feel afraid on their own at home"],
  ["q4", "no_fun", "Nothing is much fun anymore"],
  ["q5", "worry_family", "Worries something awful will happen to family"],
  ["q6", "crowds", "Afraid of crowded places"],
  ["q7", "worry_others_think", "Worries what other people think of them"],
  ["q8", "sleep_trouble", "Has trouble sleeping"],
  ["q9", "scared_sleep_alone", "Scared to sleep on their own"],
  ["q10", "appetite", "Has problems with appetite"],
  ["q11", "dizzy", "Suddenly dizzy or faint for no reason"],
  ["q12", "repeat_actions", "Has to do things over and over (washing, ordering)"],
  ["q13", "no_energy", "Has no energy for things"],
  ["q14", "tremble", "Suddenly trembles or shakes for no reason"],
  ["q15", "cannot_think", "Cannot think clearly"],
  ["q16", "worthless", "Feels worthless"],
  ["q17", "special_thoughts", "Has to think special thoughts to stop bad things"],
  ["q18", "death", "Thinks about death"],
  ["q19", "not_want_move", "Feels like not wanting to move"],
  ["q20", "fear_scared", "Worries about suddenly feeling scared for no reason"],
  ["q21", "tired", "Is tired a lot"],
  ["q22", "fear_fool", "Afraid of making a fool of themselves"],
  ["q23", "just_right", "Has to do things just right to stop bad things"],
  ["q24", "restless", "Feels restless"],
  ["q25", "worry_bad_to_me", "Worries something bad will happen to them"],
]);

const swemwbs = scaleItems("swemwbs", "swemwbs", "SWEMWBS", [
  ["optimistic", "optimistic", "Feeling optimistic about the future"],
  ["useful", "useful", "Feeling useful"],
  ["relaxed", "relaxed", "Feeling relaxed"],
  ["problems", "problems", "Dealing with problems well"],
  ["thinking", "thinking", "Thinking clearly"],
  ["close", "close", "Feeling close to other people"],
  ["mind", "own_mind", "Able to make up own mind about things"],
]);

const stai = scaleItems("stai5_s", "stai", "STAI-5", [
  ["upset", "upset", "Feels upset right now"],
  ["frightened", "frightened", "Feels frightened right now"],
  ["nervous", "nervous", "Feels nervous right now"],
  ["jittery", "jittery", "Feels jittery right now"],
  ["confused", "confused", "Feels confused right now"],
]);

const bis = scaleItems("bisbas12_ybm", "bis", "BIS", [
  ["bis1", "mistakes", "Worries about making mistakes"],
  ["bis2", "criticism", "Hurt by criticism or scolding"],
  ["bis3", "someone_angry", "Worried or upset when someone is angry with them"],
  ["bis4", "did_poorly", "Worried after doing poorly at something important"],
]);
const basReward = scaleItems("bisbas12_ybm", "bas_reward", "BAS reward", [
  ["rr1", "energised", "Excited and energised on getting what they want"],
  ["rr2", "keep_at_it", "Loves to keep at something they are doing well"],
  ["rr3", "win_contest", "Would be excited to win a contest"],
  ["rr4", "opportunity", "Excited right away by an opportunity"],
]);
const basDrive = scaleItems("bisbas12_ybm", "bas_drive", "BAS drive", [
  ["dr1", "all_out", "Goes all-out to get what they want"],
  ["dr2", "out_of_way", "Goes out of their way to get things they want"],
  ["dr3", "move_on_it", "Moves on a chance right away"],
  ["dr4", "no_holds", "Uses a no-holds-barred approach"],
]);

const doomscroll = scaleItems("doomscroll4", "doom", "Doomscrolling", [
  ["q1", "urge", "Urge to seek bad news on social media"],
  ["q2", "lose_track", "Loses track of time reading bad news"],
  ["q3", "browse_negative", "Continuously browses negative news"],
  ["q4", "addicted", "Feels addicted to negative news"],
]);

const e = (name: string, label: string): CodebookEntry => ({ name, label });
const platform = (key: string, name: string) => [`ybm_social_media.time_${key}`, e(`sm_bout_${key}`, `${name}: usual time in one go`)] as const;
const game = (n: number) => [`ybm_gaming.game_time_${n}`, e(`gaming_game${n}_hours`, `Game ${n} (as they named it): hours a week`)] as const;

export const DEFAULT_CODEBOOK: Readonly<Record<string, CodebookEntry>> = {
  // Introduction and identity (identity answers never leave the linkage area)
  "ybm_intro_consent.consent": e("consent", "Consent statements agreed to"),
  "ybm_intro_consent.linkage_consent": e("linkage_consent", "Agrees to linkage via Connected Yorkshire (r9.0.0 on)"),
  "ybm_identity.first_name": e("first_name", "First name"),
  "ybm_identity.last_name": e("last_name", "Last name"),
  "ybm_identity.dob": e("date_of_birth", "Date of birth"),
  "ybm_identity.ps_id": e("secret_code_parts", "Secret code parts, one question (r1.0.0–r3.1.0)"),
  "ybm_identity.val_id": e("validation_id", "Validation ID digits (r1.0.0–r3.1.0)"),
  "ybm_identity.ps_mother_initials": e("code_mother_initials", "Secret code: first two letters of mother's first name"),
  "ybm_identity.ps_house_digit": e("code_house_digit", "Secret code: first digit of house number"),
  "ybm_identity.ps_birth_month": e("code_birth_month", "Secret code: month of birth"),
  "ybm_identity.ps_postcode_letters": e("code_postcode_letters", "Secret code: last two letters of postcode"),
  "ybm_identity.home_address": e("home_address", "Home address: postcode, house, street (r8.0.0 on)"),

  // About them
  "ybm_demographics.ethnicity": e("ethnicity", "Ethnic origin"),
  "ybm_demographics.gender": e("gender", "Gender"),
  "ybm_demographics.medication": e("mh_medication", "Taking prescribed mental-health medication"),
  "ybm_eeg_practical.hair_type": e("hair_type", "Hair type (for fitting the EEG cap)"),

  // Handedness, social status, sleepiness
  "ehi_sf.writing": e("ehi_writing", "Handedness: writing"),
  "ehi_sf.throwing": e("ehi_throwing", "Handedness: throwing a ball"),
  "ehi_sf.toothbrush": e("ehi_toothbrush", "Handedness: holding a toothbrush"),
  "ehi_sf.spoon": e("ehi_spoon", "Handedness: holding a spoon"),
  "macarthur_ssy.family": e("ladder_society", "Family's place in society (ladder, 1–10)"),
  "macarthur_ssy.self": e("ladder_school", "Own standing at school (ladder, 1–10)"),
  "kss.q1": e("kss_sleepiness", "Sleepiness right now (KSS, 1–9)"),
  "sqs.q1": e("sqs_sleep_quality", "Sleep quality over the past 7 days (SQS, 0–10; r9.0.0 on)"),
  "ybm_sleep_priorities.importance": e("sleep_priorities", "What matters most for a good night's sleep (r1.0.0–r5.0.0)"),
  "ybm_sleep_priorities.know_own": e("sleep_wants_to_know", "What they would like to know about their own sleep (r1.0.0–r5.0.0)"),

  // Questionnaires
  ...swemwbs,
  ...sdq,
  ...sdq18,
  ...rcads,
  ...stai,
  ...bis,
  ...basReward,
  ...basDrive,
  ...doomscroll,

  // Phones and social media
  "ybm_smartphone.own": e("smartphone_own", "Has their own smartphone"),
  "ybm_smartphone.age_smartphone": e("age_first_smartphone", "Age at first smartphone"),
  "ybm_smartphone.sm_use": e("sm_use", "Uses social media"),
  "ybm_smartphone.sm_use_confirm": e("sm_use_confirm", "Uses any of the listed apps (check after saying no)"),
  "ybm_smartphone.age_sm": e("age_first_social_media", "Age started using social media"),
  "ybm_social_media.overuse": e("sm_overuse", "Thinks they spend too much time on social media"),
  "ybm_social_media.apps_owned": e("sm_apps_owned", "Apps they have on their phone, ranked"),
  ...Object.fromEntries([
    platform("facebook", "Facebook"),
    platform("instagram", "Instagram"),
    platform("tiktok", "TikTok"),
    platform("snapchat", "Snapchat"),
    platform("youtube", "YouTube"),
    platform("reddit", "Reddit"),
    platform("x", "X (Twitter)"),
    platform("discord", "Discord"),
    platform("twitch", "Twitch"),
    platform("kick", "Kick"),
    platform("threads", "Threads"),
  ]),
  "ybm_social_media.account_privacy": e("sm_account_privacy", "Most-used account is public or private"),
  "ybm_social_media.active_passive": e("sm_active_passive", "Active or passive user"),
  "ybm_social_media.functions": e("sm_reasons", "Reasons for using social media"),
  "ybm_social_media.night_checks": e("sm_night_checks", "Times they wake and check social media at night"),
  "ybm_social_media.morning_latency": e("sm_morning_check_delay", "Time from waking to first checking social media"),
  "ybm_social_media.time_school_day": e("sm_time_school_day", "Social media on a school day (time band)"),
  "ybm_social_media.time_nonschool_day": e("sm_time_nonschool_day", "Social media on a non-school day (time band)"),
  "ybm_social_media.lose_track": e("sm_lose_track", "Loses track of time on social media (agreement)"),
  "ybm_social_media.limit_features": e("sm_limit_features", "Uses features that limit screen time"),
  "ybm_social_media.abstain_effect": e("sm_abstain_effect", "Expected effect of giving up social media"),
  "ybm_social_media.abstain_days": e("sm_abstain_days", "Days they think they could go without social media"),
  "ybm_social_media.family_control": e("sm_family_control", "Family manages their social media use"),
  "ybm_social_media.family_control_how": e("sm_family_control_how", "How family manage their social media use (r9.0.0 on)"),
  "ybm_social_media.family_control_other": e("sm_family_control_other", "Other ways family manage it, in their words"),
  "ybm_screen_attitudes.control": e("screen_can_control", "Can control their screen use (agreement)"),
  "ybm_screen_attitudes.dependent": e("screen_dependent", "Depends on screens to function day to day (agreement)"),
  "ybm_screen_attitudes.addicted": e("screen_addicted", "Feels addicted to screen activities (agreement)"),
  "ybm_screen_attitudes.impact_positive": e("sm_impact_positive", "Social media mostly good for their wellbeing (agreement)"),
  "ybm_screen_attitudes.impact_negative": e("sm_impact_negative", "Social media mostly bad for their wellbeing (agreement)"),
  "ybm_screen_attitudes.impact_essential": e("sm_essential", "Social media is essential for daily life (agreement)"),
  "ybm_screen_attitudes.impact_avoid": e("sm_avoid_some", "Avoids some social media (agreement)"),

  // Gaming and the last question
  "ybm_gaming.hours_week": e("gaming_hours_week", "Video games per week (hours band)"),
  "ybm_gaming.top_games": e("gaming_top_games", "Up to five games they play most"),
  ...Object.fromEntries([1, 2, 3, 4, 5].map(game)),
  "ybm_gaming.social_pct": e("gaming_with_others_pct", "Share of gaming time spent playing with others (%)"),
  "ybm_future_self.message": e("future_self_message", "One sentence to their future self"),
};
