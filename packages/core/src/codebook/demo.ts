import type { CodebookEntry } from "./names.js";

/**
 * Names for the synthetic demo survey's own questions (node/synthetic.ts), so
 * the emulator and the demo study read like the real one. Never used for the
 * real survey: its keys (demo_*) do not occur there.
 */
const e = (name: string, label: string): CodebookEntry => ({ name, label });

export const DEMO_CODEBOOK: Readonly<Record<string, CodebookEntry>> = {
  "demo_consent.assent": e("assent", "Assent statements agreed to"),
  "demo_about.first_name": e("first_name", "First name"),
  "demo_about.age": e("age_years", "Age in years"),
  "demo_about.year_group": e("year_group", "School year group"),
  "demo_about.school_travel": e("school_travel", "Usual way of getting to school"),
  "demo_sleep.sleep_hours": e("sleep_hours_last_night", "Hours slept last night"),
  "demo_sleep.sleep_quality": e("sleep_quality", "How well they slept"),
  "demo_phone.has_phone": e("has_phone", "Has their own mobile phone"),
  "demo_social.platforms": e("sm_platforms", "Social-media platforms used"),
  "demo_social.sm_hours": e("sm_hours_school_day", "Social media on a school day (hours)"),
  "demo_social.sm_feel": e("sm_feel_after", "How they feel after using social media"),
  "demo_wellbeing.wb1": e("wb_01_optimistic", "Wellbeing 1: Feeling optimistic about the future"),
  "demo_wellbeing.wb2": e("wb_02_useful", "Wellbeing 2: Feeling useful"),
  "demo_wellbeing.wb3": e("wb_03_relaxed", "Wellbeing 3: Feeling relaxed"),
  "demo_wellbeing.wb4": e("wb_04_problems", "Wellbeing 4: Dealing with problems well"),
  "demo_wellbeing.wb5": e("wb_05_close", "Wellbeing 5: Feeling close to other people"),
  "demo_wellbeing.wb6": e("wb_06_own_mind", "Wellbeing 6: Able to make up own mind"),
  "demo_wellbeing.wb_extra": e("wb_anything_else", "Anything else about how they have been feeling"),
  "demo_gaming.plays_games": e("plays_games", "Plays video games"),
  "demo_gaming.game_hours": e("gaming_hours_week", "Video games per week (hours)"),
  "demo_finish.ladder": e("ladder_self", "Where they put themselves on the ladder (1–10)"),
  "demo_finish.future_message": e("future_message", "Message to themselves in five years"),
};
