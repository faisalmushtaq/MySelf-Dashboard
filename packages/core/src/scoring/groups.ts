import { z } from "zod";

/**
 * Schools and year groups: how sittings are grouped for benchmarking.
 *
 * The school is the site a study code opens with (the survey's own rule: the
 * letters are the site, the digits the cohort), shown under a name the study
 * sets. The survey does not ask for a year group, so it is taken, in the order
 * the study chooses, from
 *   - a rule on the study code (for cohorts issued per year group),
 *   - a year-group question, in a release that has one,
 *   - the date of birth and the sitting date, by the school-year cut-off.
 * The date of birth itself is read on the server and never leaves it.
 */

export const YEAR_GROUP_SOURCES = ["studyCode", "item", "dob"] as const;
export type YearGroupSource = (typeof YEAR_GROUP_SOURCES)[number];
export const YEAR_GROUP_SOURCE_LABELS: Record<YearGroupSource, string> = {
  studyCode: "Study-code rule",
  item: "Year-group question",
  dob: "Date of birth (school-year cut-off)",
};

const pattern = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((p) => {
    try {
      new RegExp(p, "i");
      return true;
    } catch {
      return false;
    }
  }, "not a valid pattern");

export const groupSettings = z.object({
  /** Display names by site code, e.g. { "NDC": "Northdale College" }. */
  schools: z.record(z.string().regex(/^[A-Z]{2,}$/), z.string().trim().min(1).max(120)).default({}),
  yearGroup: z
    .object({
      order: z.array(z.enum(YEAR_GROUP_SOURCES)).min(1).max(3).default(["studyCode", "item", "dob"]),
      /** The variable of a year-group question, where a release asks one. */
      itemVariable: z.string().trim().min(1).max(80).default("year_group"),
      /** Study-code patterns (regular expressions, case-insensitive) and the year group they mean; first match wins. */
      rules: z.array(z.object({ pattern, yearGroup: z.number().int().min(1).max(13) })).max(200).default([]),
      /** First month of the school year (9 = September, England and Wales). */
      startMonth: z.number().int().min(1).max(12).default(9),
    })
    .default({}),
  /** Groups smaller than this are marked small in the dashboard and suppressed in reports for schools. */
  minCell: z.number().int().min(3).max(50).default(10),
});
export type GroupSettings = z.infer<typeof groupSettings>;
export const DEFAULT_GROUP_SETTINGS: GroupSettings = groupSettings.parse({});

export const yearGroupLabel = (y: number | null | undefined) => (y === null || y === undefined ? "Year group unknown" : `Year ${y}`);
/** The school's name where the study has set one, else its site code. */
export const schoolLabel = (site: string | null | undefined, settings: Pick<GroupSettings, "schools">) => (site ? (settings.schools[site] ?? site) : "School unknown");

/**
 * The school year a child born on `dobIso` is in on `atIso`: in England and
 * Wales, Year N is the year that starts in the September after they turn
 * N + 4 (so Year 7 are 11 on 31 August). Outside Years 1–13, null.
 */
export function schoolYearOn(dobIso: string, atIso: string, startMonth = 9): number | null {
  const dob = /^(\d{4})-(\d{2})-(\d{2})/.exec(dobIso);
  const at = new Date(atIso);
  if (!dob || Number.isNaN(at.getTime())) return null;
  const [by, bm, bd] = [Number(dob[1]), Number(dob[2]), Number(dob[3])];
  const startYear = at.getUTCMonth() + 1 >= startMonth ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
  // Age on the last day before the school year starts.
  const cutMonth = startMonth === 1 ? 12 : startMonth - 1;
  const cutYear = startMonth === 1 ? startYear - 1 : startYear;
  const cutDay = new Date(Date.UTC(cutYear, cutMonth, 0)).getUTCDate();
  let age = cutYear - by;
  if (bm > cutMonth || (bm === cutMonth && bd > cutDay)) age -= 1;
  const year = age - 4;
  return year >= 1 && year <= 13 ? year : null;
}

/** The year group a study-code rule gives, if any. */
export function yearGroupFromCode(studyCode: string | null | undefined, rules: GroupSettings["yearGroup"]["rules"]): number | null {
  if (!studyCode) return null;
  for (const r of rules) if (new RegExp(r.pattern, "i").test(studyCode)) return r.yearGroup;
  return null;
}

/** "Year 8", "Y8", "8" → 8. */
export function yearGroupFromAnswer(label: string | null, value: number | null): number | null {
  const m = label ? /(\d{1,2})/.exec(label) : null;
  const n = m ? Number(m[1]) : value;
  return n !== null && Number.isInteger(n) && n >= 1 && n <= 13 ? n : null;
}
