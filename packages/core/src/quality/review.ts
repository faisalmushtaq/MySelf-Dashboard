import { BUILT_IN_CODEBOOK, codebookProblems, type Codebook } from "../codebook/index.js";
import { compareVersions, type QuestionDef, type ReleaseIndex } from "../manifest.js";
import { checkScheme } from "../scoring/check.js";
import type { ScoringScheme } from "../scoring/scheme.js";
import { LABEL_EXPECTATIONS, PUBLISHED_BANDS, PUBLISHED_KEYS, REVIEW_NOTES, VERSION_ESCALATIONS } from "./expectations.js";
import type { CodebookRow, QualityFinding, QualityReport, QualitySeverity, ScoringUse } from "./types.js";

/**
 * The data-quality review: every question of every survey version checked
 * against its labels, and against the scoring schemes the study uses now.
 *
 * It needs no answers, so it runs on the survey definitions alone and shows the
 * same thing to everyone. What it checks, and why, is set out in docs/09.
 */

const NON_SUBSTANTIVE_LABEL = /prefer not|don['’]?t know|not sure|unsure|can['’]?t remember|rather not/i;

/** A label without a leading "3 - " the way early versions numbered their options. */
export const bareLabel = (label: string) => label.trim().replace(/^\d+\s*[-–]\s+/, "");
const digits = (label: string) => (bareLabel(label).match(/\d+/g) ?? []).join(",");

/** The value a code scores under a scheme, after its reversals and recodes, as the engine computes it. Null = missing. */
export function itemValue(scheme: ScoringScheme, item: string, code: number): number | null {
  let v: number | null = code;
  for (const t of scheme.transforms) {
    if (!t.items.includes(item) || v === null) continue;
    if (t.op === "reverse") v = t.maxPlusMin - v;
    else {
      const mapped: number | null | undefined = t.map[String(v)];
      v = mapped === undefined ? null : mapped;
    }
  }
  return v;
}

function transformOf(scheme: ScoringScheme, item: string): ScoringUse["transform"] {
  const t = scheme.transforms.filter((x) => x.items.includes(item));
  if (t.some((x) => x.op === "recode")) return "recoded";
  if (t.some((x) => x.op === "reverse")) return "reversed";
  return null;
}

/** Every score a question feeds directly, with what each of its options scores. */
export function scoringUses(q: QuestionDef, schemes: readonly ScoringScheme[]): ScoringUse[] {
  const uses: ScoringUse[] = [];
  for (const s of schemes) {
    if (s.instrument !== q.instrument) continue;
    for (const o of s.outputs) {
      const c = o.calc;
      const direct = c.op === "sum" || c.op === "mean" ? c.items.includes(q.item) : c.op === "item" ? c.item === q.item : false;
      if (!direct) continue;
      uses.push({
        scheme: s.key,
        schemeName: s.abbreviation ?? s.name,
        schemeVersion: s.version,
        output: o.key,
        outputLabel: o.label,
        ...(q.options?.length ? { values: q.options.map((opt) => (opt.kind === "substantive" ? itemValue(s, q.item, opt.code) : null)) } : {}),
        transform: transformOf(s, q.item),
      });
    }
  }
  return uses;
}

const bySemver = (releases: readonly ReleaseIndex[]) => [...releases].sort((a, b) => compareVersions(a.version, b.version));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const short = (text: string, n = 90) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function reviewQuality(input: { releases: readonly ReleaseIndex[]; schemes: readonly ScoringScheme[]; codebook?: Codebook }): QualityFinding[] {
  const releases = bySemver(input.releases);
  const codebook = input.codebook ?? BUILT_IN_CODEBOOK;
  const findings: QualityFinding[] = [];
  const nameOf = (key: string) => codebook[key]?.name ?? key;

  // ── Names and labels ──────────────────────────────────────────────────────
  const allQuestions = releases.flatMap((r) => r.questions);
  for (const p of codebookProblems(allQuestions, codebook)) {
    findings.push({ id: `names.${p.key}.${p.level}`, severity: p.level, area: "names", title: p.message, detail: p.level === "error" ? "Add or correct the entry in packages/core/src/codebook/names.ts." : "Shorten the label.", keys: [p.key] });
  }

  // ── Response options, version by version ─────────────────────────────────
  const optionIssues = new Map<string, QualityFinding>();
  const addOptionIssue = (id: string, make: () => Omit<QualityFinding, "keys" | "versions">, key: string, version: string) => {
    const f = optionIssues.get(id) ?? { ...make(), keys: [], versions: [] };
    if (!f.keys.includes(key)) f.keys.push(key);
    if (!f.versions!.includes(version)) f.versions!.push(version);
    optionIssues.set(id, f);
  };
  for (const r of releases) {
    for (const q of r.questions) {
      const opts = q.options ?? [];
      if (!opts.length) continue;
      const codes = opts.map((o) => o.code);
      if (new Set(codes).size !== codes.length) {
        addOptionIssue(`responses.duplicate_code.${q.key}`, () => ({ id: `responses.duplicate_code.${q.key}`, severity: "error", area: "responses", instrument: q.instrument, title: `${nameOf(q.key)}: two options share a code`, detail: "An answer stored under a shared code cannot be told apart. Give each option its own code in a new survey version." }), q.key, r.version);
      }
      for (const o of opts) {
        if (!o.label.trim()) {
          addOptionIssue(`responses.empty_label.${q.key}`, () => ({ id: `responses.empty_label.${q.key}`, severity: "error", area: "responses", instrument: q.instrument, title: `${nameOf(q.key)}: an option has no label`, detail: `Code ${o.code} has no text, so nobody can say what it meant.` }), q.key, r.version);
        }
        if (o.kind === "substantive" && NON_SUBSTANTIVE_LABEL.test(o.label)) {
          const id = `responses.kind.${q.scaleKey ?? q.key}.${o.code}`;
          addOptionIssue(id, () => ({ id, severity: "warning", area: "responses", instrument: q.instrument, title: `'${o.label}' is recorded as a real answer`, detail: `Code ${o.code} ('${o.label}') is marked substantive, so it would be counted in scores and averages as if it were a level of the scale. Mark it as 'don't know' or 'decline' in the survey's scale.` }), q.key, r.version);
        }
      }
    }
  }
  findings.push(...optionIssues.values());

  // Agreement scales that run in opposite directions within one version.
  for (const r of [releases.at(-1)].filter((x): x is ReleaseIndex => !!x)) {
    const agreeFirst: string[] = [];
    const disagreeFirst: string[] = [];
    for (const q of r.questions) {
      const opts = q.options ?? [];
      const agree = opts.find((o) => /^strongly agree$/i.test(bareLabel(o.label)));
      const disagree = opts.find((o) => /^strongly disagree$/i.test(bareLabel(o.label)));
      if (!agree || !disagree) continue;
      (agree.code < disagree.code ? agreeFirst : disagreeFirst).push(q.key);
    }
    if (agreeFirst.length && disagreeFirst.length) {
      findings.push({
        id: "responses.agreement_direction",
        severity: "note",
        area: "responses",
        title: "Agreement scales run in opposite directions",
        detail: `In survey ${r.version}, ${plural(agreeFirst.length, "question")} store 1 = strongly agree (${agreeFirst.map(nameOf).join(", ")}) and ${plural(disagreeFirst.length, "question")} store 1 = strongly disagree (${disagreeFirst.map(nameOf).join(", ")}). The dashboard's scores put them on one direction (checked below); raw codes in exports keep the survey's direction, so read the codebook before analysing raw answers. Survey anomaly A-18.`,
        keys: [...agreeFirst, ...disagreeFirst],
        versions: [r.version],
      });
    }
  }

  // ── Scoring: the schemes against each version ─────────────────────────────
  for (const s of input.schemes) {
    const issues = new Map<string, { level: "error" | "warning"; versions: string[] }>();
    for (const r of releases) {
      for (const i of checkScheme(s, r).issues) {
        const e = issues.get(i.message) ?? { level: i.level, versions: [] };
        e.versions.push(r.version);
        issues.set(i.message, e);
      }
    }
    let n = 0;
    for (const [message, e] of issues) {
      n += 1;
      findings.push({ id: `scoring.check.${s.key}.${n}`, severity: e.level, area: "scoring", scheme: s.key, instrument: s.instrument, title: `${s.abbreviation ?? s.name}: ${message}`, detail: "Found by checking the scheme against the survey version's questions and codes (Settings → Scoring shows the same).", keys: [], versions: e.versions });
    }
  }

  // Published item keys.
  for (const k of PUBLISHED_KEYS) {
    const s = input.schemes.find((x) => x.key === k.scheme);
    const o = s?.outputs.find((x) => x.key === k.output);
    if (!s || !o) continue;
    const items = o.calc.op === "sum" || o.calc.op === "mean" ? o.calc.items : o.calc.op === "item" ? [o.calc.item] : [];
    const extra = items.filter((i) => !k.items.includes(i));
    const missing = k.items.filter((i) => !items.includes(i));
    if (extra.length || missing.length) {
      findings.push({
        id: `scoring.key.${s.key}.${o.key}`,
        severity: "error",
        area: "scoring",
        scheme: s.key,
        instrument: s.instrument,
        title: `${s.abbreviation ?? s.name} ${o.label}: items differ from the published key`,
        detail: `${missing.length ? `Missing ${missing.map((i) => nameOf(`${s.instrument}.${i}`)).join(", ")}. ` : ""}${extra.length ? `Not in the published key: ${extra.map((i) => nameOf(`${s.instrument}.${i}`)).join(", ")}. ` : ""}Scheme v${s.version}. Correct it in Settings → Scoring.`,
        keys: [...missing, ...extra].map((i) => `${s.instrument}.${i}`),
        source: k.source,
      });
    }
  }

  // What each response label scores, in every version that asks the item.
  const labelIssues = new Map<string, QualityFinding>();
  for (const x of LABEL_EXPECTATIONS) {
    const s = input.schemes.find((y) => y.key === x.scheme);
    if (!s) continue;
    for (const r of releases) {
      for (const item of x.items) {
        const q = r.byKey.get(`${s.instrument}.${item}`);
        if (!q?.options?.length) continue;
        const opt = q.options.find((o) => x.label.test(bareLabel(o.label)));
        if (!opt) {
          const id = `scoring.anchor_missing.${s.key}.${x.label.source}`;
          const f = labelIssues.get(id) ?? { id, severity: "warning" as QualitySeverity, area: "scoring" as const, scheme: s.key, instrument: s.instrument, title: `${s.abbreviation ?? s.name}: no option reads '${x.label.source.replace(/[\^$\\/]/g, "")}'`, detail: `The review expects this option (${x.why}) but the survey's labels have changed, so it cannot confirm how the item is scored. Check the options and the scheme together.`, keys: [], versions: [] };
          if (!f.keys.includes(q.key)) f.keys.push(q.key);
          if (!f.versions!.includes(r.version)) f.versions!.push(r.version);
          labelIssues.set(id, f);
          continue;
        }
        const got = opt.kind === "substantive" ? itemValue(s, item, opt.code) : null;
        const same = got === x.value || (got !== null && x.value !== null && Math.abs(got - x.value) < 1e-9);
        if (!same) {
          const id = `scoring.anchor.${s.key}.${item}.${x.label.source}`;
          const f = labelIssues.get(id) ?? {
            id,
            severity: "error" as QualitySeverity,
            area: "scoring" as const,
            scheme: s.key,
            instrument: s.instrument,
            title: `${nameOf(q.key)}: '${opt.label}' scores ${got ?? "missing"}, not ${x.value ?? "missing"}`,
            detail: `${x.why} Under ${s.abbreviation ?? s.name} v${s.version} the answer '${opt.label}' (code ${opt.code}) scores ${got ?? "as missing"}. A reversal, recode or option order is wrong.`,
            keys: [],
            versions: [],
          };
          if (!f.keys.includes(q.key)) f.keys.push(q.key);
          if (!f.versions!.includes(r.version)) f.versions!.push(r.version);
          labelIssues.set(id, f);
        }
      }
    }
  }
  findings.push(...labelIssues.values());

  // Scores that do not rise or fall steadily along the options.
  const latest = releases.at(-1);
  if (latest) {
    for (const q of latest.questions) {
      for (const use of scoringUses(q, input.schemes)) {
        const vals = (use.values ?? []).filter((v): v is number => v !== null);
        if (vals.length < 3) continue;
        const up = vals.every((v, i) => i === 0 || v >= vals[i - 1]!);
        const down = vals.every((v, i) => i === 0 || v <= vals[i - 1]!);
        if (!up && !down) {
          findings.push({ id: `scoring.monotone.${use.scheme}.${use.output}.${q.item}`, severity: "error", area: "scoring", scheme: use.scheme, instrument: q.instrument, title: `${q.name}: its options do not score in order for ${use.outputLabel}`, detail: `In the order the options are shown they score ${vals.join(", ")}. An ordered scale should score in order; check the recode.`, keys: [q.key], versions: [latest.version] });
        }
      }
    }
  }

  // Published cut-points.
  for (const b of PUBLISHED_BANDS) {
    const s = input.schemes.find((x) => x.key === b.scheme);
    const set = s?.outputs.find((o) => o.key === b.output)?.thresholds.find((t) => t.key === b.set);
    if (!s || !set) continue;
    const uppers = set.bands.map((x) => x.max);
    if (JSON.stringify(uppers) !== JSON.stringify(b.uppers)) {
      findings.push({
        id: `scoring.bands.${s.key}.${b.output}.${b.set}`,
        severity: "warning",
        area: "scoring",
        scheme: s.key,
        instrument: s.instrument,
        title: `${s.abbreviation ?? s.name} ${b.output.replace(/_/g, " ")}: '${set.label}' cut-points differ from the published ones`,
        detail: `Bands end at ${uppers.map((u) => u ?? "top").join(" / ")}; the published self-report cut-points end at ${b.uppers.map((u) => u ?? "top").join(" / ")}. If the study changed them on purpose, say so where the bands are reported.`,
        keys: [],
        source: b.source,
      });
    }
  }

  // ── Changes between versions ─────────────────────────────────────────────
  const history = new Map<string, { version: string; q: QuestionDef }[]>();
  for (const r of releases) for (const q of r.questions) history.set(q.key, [...(history.get(q.key) ?? []), { version: r.version, q }]);
  const optionChanges = new Map<string, QualityFinding>();
  const wordingByVersion = new Map<string, string[]>();
  for (const [key, h] of history) {
    for (let i = 1; i < h.length; i += 1) {
      const [a, b] = [h[i - 1]!, h[i]!];
      if (a.q.variable !== b.q.variable) {
        findings.push({ id: `versions.variable.${key}.${b.version}`, severity: "warning", area: "versions", instrument: b.q.instrument, title: `${nameOf(key)}: survey variable renamed in ${b.version}`, detail: `${a.q.variable} → ${b.q.variable}. The dashboard joins on the question key, not the variable, so the two are one column; check any analysis written against the old name.`, keys: [key], versions: [b.version] });
      }
      if (a.q.responseType !== b.q.responseType) {
        findings.push({ id: `versions.type.${key}.${b.version}`, severity: "warning", area: "versions", instrument: b.q.instrument, title: `${nameOf(key)}: answer type changed in ${b.version}`, detail: `${a.q.responseType} → ${b.q.responseType}. Answers before and after are not directly comparable.`, keys: [key], versions: [b.version] });
      }
      if (a.q.text.replace(/\s+/g, " ").trim() !== b.q.text.replace(/\s+/g, " ").trim()) wordingByVersion.set(b.version, [...(wordingByVersion.get(b.version) ?? []), key]);
      const before = new Map((a.q.options ?? []).map((o) => [o.code, o.label]));
      const changed = (b.q.options ?? []).filter((o) => before.has(o.code) && before.get(o.code) !== o.label);
      const added = (b.q.options ?? []).filter((o) => !before.has(o.code));
      const removed = (a.q.options ?? []).filter((o) => !(b.q.options ?? []).some((x) => x.code === o.code));
      if (!changed.length && !added.length && !removed.length) continue;
      const signature = JSON.stringify([b.version, changed.map((o) => [o.code, before.get(o.code), o.label]), added.map((o) => o.code), removed.map((o) => o.code)]);
      const escalation = VERSION_ESCALATIONS.find((x) => x.version === b.version && x.keys.test(key));
      // Rewording that keeps every number ('1-2 times' → '1 or 2 times') leaves the codes meaning the same.
      const sameNumbers = !added.length && !removed.length && changed.every((o) => digits(before.get(o.code)!) === digits(o.label));
      const f = optionChanges.get(signature) ?? {
        id: `versions.options.${b.version}.${optionChanges.size + 1}`,
        severity: escalation?.severity ?? ("note" as QualitySeverity),
        area: "versions" as const,
        instrument: b.q.instrument,
        title: "",
        detail: [
          escalation?.detail,
          changed.length ? `Relabelled: ${changed.map((o) => `${o.code} '${short(before.get(o.code)!, 40)}' → '${short(o.label, 40)}'`).join("; ")}.` : "",
          added.length ? `New codes: ${added.map((o) => `${o.code} '${short(o.label, 40)}'`).join("; ")}.` : "",
          removed.length ? `Codes no longer offered: ${removed.map((o) => `${o.code} '${short(o.label, 40)}'`).join("; ")}.` : "",
          escalation ? "" : sameNumbers ? "Only the wording around the numbers changed, so each code means the same in both versions." : "Check the change leaves each code's meaning intact before pooling the versions.",
        ].filter(Boolean).join(" "),
        keys: [],
        versions: [b.version],
      };
      f.keys.push(key);
      f.title = `Response options changed in ${b.version}: ${f.keys.map(nameOf).join(", ")}`;
      if (f.title.length > 160) f.title = `Response options changed in ${b.version} for ${plural(f.keys.length, "question")}`;
      optionChanges.set(signature, f);
    }
  }
  findings.push(...optionChanges.values());
  for (const [version, keys] of wordingByVersion) {
    findings.push({
      id: `versions.wording.${version}`,
      severity: "note",
      area: "versions",
      title: `Wording changed in ${version} for ${plural(keys.length, "question")}`,
      detail: `${keys.map(nameOf).join(", ")}. The codebook shows the wording of the version you choose; check a change is presentation only (a shorter stem, context moved to the lede) before pooling.`,
      keys,
      versions: [version],
    });
  }
  // Questions added or retired.
  for (let i = 1; i < releases.length; i += 1) {
    const [a, b] = [releases[i - 1]!, releases[i]!];
    const added = b.questions.filter((q) => !a.byKey.has(q.key)).map((q) => q.key);
    const retired = a.questions.filter((q) => !b.byKey.has(q.key)).map((q) => q.key);
    if (added.length || retired.length) {
      findings.push({
        id: `versions.set.${b.version}`,
        severity: "note",
        area: "versions",
        title: `Questions ${[added.length ? "added" : "", retired.length ? "retired" : ""].filter(Boolean).join(" and ")} in ${b.version}`,
        detail: [added.length ? `Added: ${added.map(nameOf).join(", ")}.` : "", retired.length ? `No longer asked: ${retired.map(nameOf).join(", ")}.` : ""].filter(Boolean).join(" "),
        keys: [...added, ...retired],
        versions: [b.version],
      });
    }
  }

  // ── The reviewer's findings ───────────────────────────────────────────────
  for (const n of REVIEW_NOTES) findings.push({ id: n.id, severity: n.severity, area: n.area, title: n.title, detail: n.detail, keys: n.keys, ...(n.instrument ? { instrument: n.instrument } : {}), ...(n.source ? { source: n.source } : {}), status: n.status });

  const order: Record<QualitySeverity, number> = { error: 0, warning: 1, note: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** The codebook of one version, with the review of every version around it. */
export function buildQualityReport(input: { releases: readonly ReleaseIndex[]; release: ReleaseIndex; schemes: readonly ScoringScheme[]; codebook?: Codebook }): QualityReport {
  const findings = reviewQuality(input);
  const versionsOf = new Map<string, string[]>();
  for (const r of bySemver(input.releases)) for (const q of r.questions) versionsOf.set(q.key, [...(versionsOf.get(q.key) ?? []), r.version]);
  const findingsOf = new Map<string, string[]>();
  for (const f of findings) for (const k of f.keys) findingsOf.set(k, [...(findingsOf.get(k) ?? []), f.id]);
  const rows: CodebookRow[] = input.release.questions.map((q) => ({
    key: q.key,
    instrument: q.instrument,
    item: q.item,
    name: q.name,
    label: q.label,
    named: q.named,
    variable: q.variable,
    legacyVariable: q.legacyVariable ?? null,
    section: q.sectionTitle,
    text: q.text,
    lede: q.lede ?? null,
    instructions: q.instructions ?? null,
    unit: q.unit ?? null,
    researcherNote: q.researcherNote ?? null,
    responseType: q.responseType,
    required: q.required,
    identifying: q.identifying,
    freeText: q.freeText,
    conditional: q.displayIf !== undefined,
    options: (q.options ?? []).map((o) => ({ ...o })),
    scoring: scoringUses(q, input.schemes),
    versions: versionsOf.get(q.key) ?? [],
    findings: findingsOf.get(q.key) ?? [],
  }));
  const counts: Record<QualitySeverity, number> = { error: 0, warning: 0, note: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return { release: { hash: input.release.hash, version: input.release.version }, rows, findings, counts };
}
