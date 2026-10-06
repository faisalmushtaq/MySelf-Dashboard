import { isStudyId, isSurveyId, participantLink, STUDY_ID_PATTERN, SURVEY_ID_PATTERN, type SurveyChoice } from "./vendor/myself/schema/link.js";
import type { Role } from "./roles.js";
import { emailAllowed } from "./roles.js";

/**
 * Study spaces and their surveys, as the dashboard sees them (docs/12; the
 * survey's docs/16 §11, D-56).
 *
 * A STUDY is everything under `studies/{study}/` in the survey's database: its
 * surveys, sittings and access lists. The deployment's default study (`ybm`)
 * is registered whether or not it has a registry document; any other exists
 * because a project owner created it in the Studio.
 *
 * A SURVEY is one Studio survey in a study. A sitting's survey is
 * `release.assessment` of the release it was collected under, resolved in the
 * sitting's own study — never guessed from its release key.
 *
 * The id patterns and the participant link are the survey's own
 * (vendor/myself/schema/link.ts), so the dashboard accepts exactly the ids, and
 * builds exactly the links, that the Studio and the iPads do.
 */

export { isStudyId, isSurveyId, participantLink, STUDY_ID_PATTERN, SURVEY_ID_PATTERN, type SurveyChoice };

export type StudyStatus = "open" | "closed";

/**
 * A registry document's status, failing closed as the survey's functions read
 * it: anything but exactly "open" is closed.
 */
export function studyStatus(value: unknown): StudyStatus {
  return value === "open" ? "open" : "closed";
}

/** A study as the switcher lists it. */
export interface StudyView {
  study: string;
  /** The registry's title; for the default study with no document, its live survey's title. */
  title: string;
  status: StudyStatus;
  /** The deployment's default study (`ybm`), registered with or without a document. */
  isDefault: boolean;
}

/** One survey of a study, for the survey filter and the Survey versions page. */
export interface SurveyView {
  surveyId: string;
  /** Its release's `composition.title`; the id when no release can be read. */
  title: string;
  /** Studio's live pointer, when the survey has a live version. */
  live: { version: string; hash: string } | null;
  /** The registered versions collected under it, by content hash. */
  releases: string[];
}

export interface SurveysResponse {
  study: string;
  surveys: SurveyView[];
}

/** Who else may see a study (not the default one): addresses and Workspace domains. */
export interface StudyAccessList {
  emails: string[];
  domains: string[];
}

/**
 * May someone the dashboard already admits (on its access list, with a role)
 * see `study`? Administrators see every study; everyone sees the default study,
 * whose access list is the dashboard's own; anyone else only a study whose own
 * list names them or their domain. A study with no list admits only
 * administrators: a new study is closed until someone is added to it.
 */
export function decideStudyAccess(input: { role: Role; email: string; study: string; defaultStudy: string; list: StudyAccessList | null }): boolean {
  if (input.role === "owner") return true;
  if (input.study === input.defaultStudy) return true;
  return input.list !== null && emailAllowed(input.email, input.list);
}

/**
 * Mail services anyone can sign up to. A domain rule admits everybody with an
 * address at that domain, so it is for a domain an organisation manages in
 * Google Workspace — never one of these. A single address at one is fine.
 */
export const PUBLIC_MAIL_DOMAINS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "live.co.uk",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.co.uk",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "btinternet.com",
  "sky.com",
  "virginmedia.com",
  "talktalk.net",
];

export function isPublicMailDomain(domain: string): boolean {
  return PUBLIC_MAIL_DOMAINS.includes(domain.trim().toLowerCase().replace(/^@/, ""));
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/;
export const MAX_ACCESS_ENTRIES = 500;

/**
 * Tidy an access list as it arrives from a browser: strings only, trimmed,
 * lower case, a leading "@" dropped from a domain, duplicates removed.
 */
export function readAccessList(raw: unknown): StudyAccessList {
  const r = (raw ?? {}) as { emails?: unknown; domains?: unknown };
  const strings = (x: unknown) =>
    Array.isArray(x) ? [...new Set(x.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim().toLowerCase()))] : [];
  return { emails: strings(r.emails), domains: [...new Set(strings(r.domains).map((d) => d.replace(/^@/, "")))] };
}

/** Why an access list cannot be saved, or null when it can. */
export function accessListProblem(list: StudyAccessList): string | null {
  for (const e of list.emails) if (!EMAIL.test(e)) return `${e} is not an email address`;
  for (const d of list.domains) {
    if (!DOMAIN.test(d)) return `${d} is not a domain`;
    if (isPublicMailDomain(d)) return `${d} is a public mail service: anyone can have an address there. List the people's addresses instead.`;
  }
  if (list.emails.length + list.domains.length > MAX_ACCESS_ENTRIES) return "that list is too long";
  return null;
}

/**
 * Where to edit a survey in MySelf Studio: its versions page, in its study.
 * `studioUrl` is Studio's survey list (`…/researcher/#/surveys`). Studio's
 * addresses name the study as a prefix, `#/study/<id>/…`, except the default
 * study's, which keep the addresses they had before study spaces (the
 * survey's apps/researcher/src/studio/route.ts, D-56).
 */
export function studioLink(studioUrl: string, choice: SurveyChoice | null, defaultStudy: string): string {
  const base = studioUrl.split("#")[0]!;
  const study = choice && choice.study !== defaultStudy && isStudyId(choice.study) ? `#/study/${encodeURIComponent(choice.study)}` : "#";
  return choice && isSurveyId(choice.surveyId) ? `${base}${study}/surveys/${encodeURIComponent(choice.surveyId)}/versions` : `${base}${study}/surveys`;
}
