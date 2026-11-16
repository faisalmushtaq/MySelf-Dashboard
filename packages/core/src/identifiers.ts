import type { CsvValue } from "./csv.js";
import type { Table } from "./exportData.js";

/**
 * The identifying-information export (administrators only, docs/02 §2.5.1).
 *
 * One row per sitting: who it belongs to (participant code and wave, so the
 * file can be joined to a research export), then the name, date of birth and
 * home address the participant gave, and their answer about record linkage
 * where the survey asked it. Nothing else: no answers, so identities and
 * responses are never in the same file.
 */

/** One identifying answer, as the survey's ingest sets it apart. */
export interface IdentityAnswer {
  sessionId: string;
  variable: string;
  value: string;
}

export interface IdentitySitting {
  sessionId: string;
  participant: string | null;
  wave: number | null;
  site: string | null;
  studyCode: string | null;
  startedAt: string | null;
  /** The answer to the 16+ linkage question (survey D-95), as its label, or null. */
  linkageChoice: string | null;
}

/** The parts of a home address the survey stores (its `HomeAddress`, r8.0.0 on). */
const ADDRESS_PARTS = ["house", "street", "area", "postcode", "postcode_district", "uprn"] as const;
const ADDRESS_VARIABLES = new Set(["home_address", "address"]);

/** First the columns every study uses, in reading order; then anything else identifying, by name. */
const KNOWN = ["first_name", "last_name", "dob"] as const;

export function parseAddress(raw: string): Partial<Record<(typeof ADDRESS_PARTS)[number], string>> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: Partial<Record<(typeof ADDRESS_PARTS)[number], string>> = {};
  for (const part of ADDRESS_PARTS) {
    const v = (parsed as Record<string, unknown>)[part];
    if (typeof v === "string" && v.trim() !== "") out[part] = v.trim();
  }
  return Object.keys(out).length ? out : null;
}

export function identifiersTable(sittings: readonly IdentitySitting[], answers: readonly IdentityAnswer[]): Table {
  const bySession = new Map<string, Map<string, string>>();
  const others = new Set<string>();
  let anyAddress = false;
  for (const a of answers) {
    const m = bySession.get(a.sessionId) ?? new Map<string, string>();
    m.set(a.variable, a.value);
    bySession.set(a.sessionId, m);
    if (ADDRESS_VARIABLES.has(a.variable)) anyAddress = true;
    else if (!(KNOWN as readonly string[]).includes(a.variable)) others.add(a.variable);
  }
  const extra = [...others].sort();
  const headers = [
    "participant_code",
    "wave",
    "session_id",
    "study_code",
    "site",
    "started_at",
    ...KNOWN,
    ...(anyAddress ? ADDRESS_PARTS.map((p) => `address_${p}`) : []),
    ...extra,
    "linkage_choice_16_plus",
  ];
  const rows: CsvValue[][] = sittings.map((s) => {
    const m = bySession.get(s.sessionId) ?? new Map<string, string>();
    const rawAddress = [...ADDRESS_VARIABLES].map((v) => m.get(v)).find((v) => v !== undefined);
    const address = rawAddress ? parseAddress(rawAddress) : null;
    return [
      s.participant,
      s.wave,
      s.sessionId,
      s.studyCode,
      s.site,
      s.startedAt,
      ...KNOWN.map((k) => m.get(k) ?? null),
      ...(anyAddress ? ADDRESS_PARTS.map((p) => address?.[p] ?? null) : []),
      ...extra.map((k) => m.get(k) ?? null),
      s.linkageChoice,
    ];
  });
  return { name: "identifiers", headers, rows };
}
