import type { ReleaseManifest } from "../vendor/myself/schema/index.js";
import { buildBidsExport, type BidsFile } from "../vendor/myself/store/bids.js";
import type { StoredNarrativeRun } from "../vendor/myself/store/narratives.js";
import { buildZip } from "../vendor/myself/store/zip.js";
import type { Sitting } from "../types.js";
import { pseudonymiseDataset, subsetDataset, withoutVariables, type StudyDataset } from "./dataset.js";
import { bandRange, type SchemeScores } from "../scoring/engine.js";
import { SCHEME_STATUS_LABELS, type ScoringScheme } from "../scoring/scheme.js";

/**
 * The dashboard's BIDS export: the survey's own BIDS layout (built by the
 * survey's code, unchanged) for the sittings a researcher chose, plus what an
 * export made by a person rather than a nightly job has to carry — who made
 * it, from which filters, what was left out and why, a linkage file when
 * identifiers are included, and a checksum for every file.
 */

export interface BidsExportInput {
  study: string;
  /** The whole study, derived once (see deriveStudyDataset). */
  studyData: StudyDataset;
  /** The sittings the researcher chose. */
  selected: ReadonlySet<string>;
  /** Raw sittings, for the linkage file's device ids and times. */
  sittings: ReadonlyMap<string, Sitting>;
  /** Wording and codes for the data dictionaries: the newest release included. */
  manifest: ReleaseManifest;
  releaseVersions: ReadonlyMap<string, string>;
  identifiers: boolean;
  includeFreeText: boolean;
  /** Free-text variables across the included releases (left out unless included). */
  freeTextVariables: ReadonlySet<string>;
  narratives: readonly StoredNarrativeRun[];
  provenance: {
    exportId: string;
    createdAt: string;
    createdBy: string;
    role: string;
    scope: string;
    dateRange: string;
    filters: string[];
    rulesVersion: string;
  };
  /** SHA-256 hex of a file's content. */
  hash: (content: string) => string;
  /**
   * Scores from the dashboard's scoring schemes, by sitting. When given they
   * replace the survey's own derived scores in phenotype/scores.tsv.
   */
  scoring?: { schemes: readonly ScoringScheme[]; bySession: ReadonlyMap<string, Record<string, SchemeScores>> };
}

export interface BidsExportResult {
  files: BidsFile[];
  zip: Uint8Array;
  participants: number;
  sessions: number;
  excluded: { sessionId: string; reason: string }[];
  collisions: { participantId: string; sessionIds: string[] }[];
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const cell = (v: unknown) => (v === null || v === undefined || v === "" ? "n/a" : String(v).replace(/[\t\r\n]+/g, " "));
const tsv = (columns: string[], rows: Record<string, unknown>[]) =>
  `${[columns.join("\t"), ...rows.map((r) => columns.map((c) => cell(r[c])).join("\t"))].join("\n")}\n`;
const label = (raw: string) => raw.replace(/[^A-Za-z0-9]/g, "");
const ses = (wave: number) => `ses-${String(wave).padStart(2, "0")}`;

export function buildDashboardBids(input: BidsExportInput): BidsExportResult {
  const { studyData, provenance: p } = input;
  const inDataset = new Set(studyData.dataset.sessions.map((s) => s.sessionId));
  const chosen = new Set([...input.selected].filter((id) => inDataset.has(id)));
  const excluded = studyData.excluded.filter((e) => input.selected.has(e.sessionId));
  const collisions = studyData.collisions
    .map((c) => ({ ...c, sessionIds: c.sessionIds.filter((id) => chosen.has(id)) }))
    .filter((c) => c.sessionIds.length > 0);

  let data = subsetDataset(studyData.dataset, chosen);
  if (input.scoring) data = { ...data, scores: scoreRows(data.sessions, input.scoring) };
  const withheld = input.includeFreeText ? [] : [...new Set(data.responses.filter((r) => input.freeTextVariables.has(r.variable)).map((r) => r.variable))].sort();
  if (!input.includeFreeText) data = withoutVariables(data, input.freeTextVariables);
  const original = data;
  let labels: Map<string, string> | null = null;
  if (!input.identifiers) {
    const pseudo = pseudonymiseDataset(data);
    data = pseudo.dataset;
    labels = pseudo.labels;
  }
  // Narrative runs are the participant's own words: included with free text,
  // joined to the chosen sittings by the survey's builder.
  const narratives = input.includeFreeText ? input.narratives.filter((n) => chosen.has(n.sessionId)) : [];
  // participants.tsv in label order, so it reads like the folder listing.
  data = { ...data, participants: [...data.participants].sort((a, b) => a.participantId.localeCompare(b.participantId)) };

  const files = buildBidsExport(data, {
    manifest: input.manifest,
    datasetName: `MySelf ${input.study}`,
    narratives: [...narratives],
    description: {
      GeneratedBy: [
        {
          Name: "MySelf",
          Description:
            "Exported from the MySelf research platform. Questionnaire data follows the BIDS phenotype convention; this dataset is BIDS-style rather than a validated BIDS dataset, since it carries no imaging.",
          CodeURL: "https://github.com/faisalmushtaq/MySelf",
        },
        {
          Name: "MySelf Research Dashboard",
          Description: `Export ${p.exportId}: ${p.scope}; ${p.dateRange}${p.filters.length ? `; ${p.filters.join("; ")}` : ""}. ${input.identifiers ? "Includes identifiers (participant codes; linkage.tsv)." : "De-identified: participant codes replaced by export-specific labels."}`,
          CodeURL: "https://github.com/faisalmushtaq/MySelf-Dashboard",
        },
      ],
      SourceDatasets: [...new Set(data.sessions.map((s) => s.releaseHash))].map((h) => ({
        ReleaseHash: h,
        ReleaseVersion: input.releaseVersions.get(h) ?? "unknown",
      })),
    },
  }).filter((f) => f.path !== ".bidsignore");

  // ── linkage.tsv: the identifiers, in one file that can be kept apart ─────
  if (input.identifiers) {
    const rows = [...original.sessions]
      .sort((a, b) => a.participantId.localeCompare(b.participantId) || a.wave - b.wave)
      .map((s) => {
        const raw = input.sittings.get(s.sessionId);
        return {
          participant_id: `sub-${label(s.participantId)}`,
          session_id: ses(s.wave),
          wave: s.wave,
          participant_code: s.participantId,
          study_code: s.studyCode ?? raw?.studyCode,
          site: s.site,
          dashboard_session_id: s.sessionId,
          device_id: raw?.deviceId,
          started_at: s.startedAt,
          completed_at: s.completedAt ?? raw?.completedAt,
          release_version: input.releaseVersions.get(s.releaseHash),
          release_hash: s.releaseHash,
        };
      });
    const columns = ["participant_id", "session_id", "wave", "participant_code", "study_code", "site", "dashboard_session_id", "device_id", "started_at", "completed_at", "release_version", "release_hash"];
    files.push({ path: "linkage.tsv", content: tsv(columns, rows) });
    files.push({
      path: "linkage.json",
      content: json({
        Description:
          "Identifiers for linkage, one row per sitting. Pseudonymous, not anonymous: the participant code is built from the child's secret-code answers and the study code is issued by the research team. Keep this file under the study's data management plan; delete it (with the sub- folders' codes) before sharing a de-identified copy. Names, dates of birth, UPNs and NHS numbers are never in this dataset.",
        participant_id: { Description: "BIDS subject label (sub- + participant code)." },
        session_id: { Description: "BIDS session label for this wave." },
        wave: { Description: "The participant's wave, numbered across the whole study in the order sittings happened." },
        participant_code: { Description: "Derived from the participant's secret code, after the study's code corrections and twin assignments." },
        study_code: { Description: "Researcher-issued code entered at the start of the sitting (site letters + number)." },
        site: { Description: "Site, from the study code's letters." },
        dashboard_session_id: { Description: "The sitting's identifier in the survey and the dashboard." },
        device_id: { Description: "Installation identifier of the device used." },
        started_at: { Description: "Start time on the device clock (ISO 8601)." },
        completed_at: { Description: "Completion time on the device clock (ISO 8601), where finished." },
        release_version: { Description: "Survey version administered." },
        release_hash: { Description: "Content hash of that version." },
      }),
    });
  }

  if (input.scoring) {
    const i = files.findIndex((f) => f.path === "phenotype/scores.json");
    const sidecar = { path: "phenotype/scores.json", content: json(scoresSidecar(input.scoring.schemes, data.scores)) };
    if (i >= 0) files[i] = sidecar;
    else if (data.scores.length) files.push(sidecar);
  }

  // ── README.md ─────────────────────────────────────────────────────────────
  const byReason = new Map<string, number>();
  for (const e of excluded) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
  const readme = [
    `# MySelf ${input.study} — BIDS export`,
    "",
    `Created ${p.createdAt} by ${p.createdBy} (${p.role}) from the MySelf Research Dashboard, export \`${p.exportId}\`.`,
    "",
    "## What is in it",
    "",
    `- **${data.participants.length}** participants and **${data.sessions.length}** sittings (${p.scope}; ${p.dateRange}).`,
    ...(p.filters.length ? [`- Filters: ${p.filters.join("; ")}.`] : []),
    "- `participants.tsv` — one row per participant; `sub-*/sessions.tsv` — one row per sitting (wave).",
    "- `phenotype/<instrument>.tsv` — one row per participant per wave, stored option codes, with a `<variable>_status` column saying why a value is missing; `phenotype/<instrument>.json` gives each question's wording and what every code means.",
    input.scoring
      ? "- `phenotype/scores.tsv` — scores from the dashboard's scoring schemes, with a column per threshold band; `phenotype/scores.json` gives each column's method, scheme version, range and whether the scheme has been verified. Regenerable, never edited."
      : "- `phenotype/scores.tsv` — derived scores, where the survey defines scoring; regenerable, never edited.",
    input.identifiers
      ? "- `linkage.tsv` — identifiers for linkage (participant codes, study codes, sitting and device identifiers, exact times)."
      : "- De-identified: participant codes are replaced by labels (P0001…) that mean nothing outside this export, study codes are removed and times are cut to the day.",
    input.includeFreeText
      ? "- Free-text answers are included, as the participant typed them."
      : `- Free-text answers are **not** included${withheld.length ? ` (${withheld.join(", ")})` : ""}.`,
    "- `export_manifest.json` — provenance and a SHA-256 checksum for every file.",
    "",
    "Missing values are `n/a`, never blank and never zero.",
    "",
    "## Identifiers",
    "",
    input.identifiers
      ? "This export contains **pseudonymous identifiers**. The participant code is built from the child's secret-code answers (mother's initials, a house digit, birth month and postcode letters), so anyone who knows the scheme can read those back from it. Store and share it only as the study's data management plan allows. Names, dates of birth, UPNs and NHS numbers are held in the survey's separate identity project and are never exported here."
      : "This export is **de-identified, not anonymous**: answers themselves (for example a rare combination of age, school and year group) can still identify someone. Share it only as the study's data management plan allows.",
    "",
    ...(excluded.length
      ? [
          "## Sittings not included",
          "",
          ...[...byReason.entries()].map(([reason, n]) => `- ${n} × ${reason}`),
          "",
          input.identifiers
            ? "Their identifiers are listed in `export_manifest.json`."
            : "They are counted in `export_manifest.json`.",
          "",
        ]
      : []),
    ...(collisions.length
      ? [
          "## Unresolved code collisions",
          "",
          `${collisions.length} participant code(s) appear to belong to more than one child — almost always twins, whose secret-code answers are identical. Until a study owner assigns one of them a distinct code, their sittings are filed under one participant and **any analysis of those rows is wrong**. ${input.identifiers ? `Codes: ${collisions.map((c) => c.participantId).join(", ")}.` : ""}`,
          "",
        ]
      : []),
    "## Reading it",
    "",
    "Every answer is interpreted through the survey version it was collected under; `SourceDatasets` in `dataset_description.json` names each version's content hash, which identifies the exact wording and codes. This layout follows the BIDS phenotype convention so imaging or EEG data can be added beside it later; a survey-only dataset is not itself a valid BIDS dataset.",
    "",
  ].join("\n");
  files.push({ path: "README.md", content: readme });

  // ── .bidsignore and export_manifest.json ─────────────────────────────────
  files.push({
    path: ".bidsignore",
    content: ["# Survey-only dataset: no imaging modalities are present yet.", "export_manifest.json", "linkage.*", ""].join("\n"),
  });
  const checksums = Object.fromEntries([...files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => [f.path, input.hash(f.content)]));
  files.push({
    path: "export_manifest.json",
    content: json({
      exportId: p.exportId,
      createdAt: p.createdAt,
      createdBy: p.createdBy,
      role: p.role,
      scope: p.scope,
      dateRange: p.dateRange,
      filters: p.filters,
      completenessRules: p.rulesVersion,
      identifiers: input.identifiers,
      freeText: input.includeFreeText,
      participants: data.participants.length,
      sittings: data.sessions.length,
      releases: [...new Set(data.sessions.map((s) => s.releaseHash))].map((h) => ({ hash: h, version: input.releaseVersions.get(h) ?? "unknown" })),
      notIncluded: input.identifiers ? excluded : [...byReason.entries()].map(([reason, count]) => ({ reason, count })),
      collisions: input.identifiers ? collisions : collisions.length,
      ...(labels ? { note: "Participant labels are specific to this export and cannot be mapped back to codes from it." } : {}),
      sha256: checksums,
    }),
  });

  const sorted = files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    files: sorted,
    zip: buildZip(sorted.map((f) => ({ path: f.path, content: f.content }))),
    participants: data.participants.length,
    sessions: data.sessions.length,
    excluded,
    collisions,
  };
}

type ScoreRowOut = StudyDataset["dataset"]["scores"][number];

/** Dashboard scores as the survey's score rows: a row per output, and one per threshold set holding the band's label. */
function scoreRows(sessions: StudyDataset["dataset"]["sessions"], scoring: NonNullable<BidsExportInput["scoring"]>): ScoreRowOut[] {
  const rows: ScoreRowOut[] = [];
  for (const s of sessions) {
    const scores = scoring.bySession.get(s.sessionId);
    if (!scores) continue;
    for (const scheme of scoring.schemes) {
      const result = scores[scheme.key];
      if (!result) continue;
      for (const o of scheme.outputs) {
        const v = result.outputs[o.key];
        const base = { sessionId: s.sessionId, participantId: s.participantId, instrument: scheme.key, scoringKey: scheme.key, scoringVersion: scheme.version, warnings: [] };
        rows.push({ ...base, output: o.key, value: v?.value ?? null, validCount: v?.valid ?? null });
        for (const t of o.thresholds) {
          const band = v?.bands[t.key];
          rows.push({ ...base, output: `${o.key}_${t.key}`, value: band === null || band === undefined ? null : t.bands[band]!.label, validCount: null });
        }
      }
    }
  }
  return rows;
}

function scoresSidecar(schemes: readonly ScoringScheme[], rows: readonly ScoreRowOut[]): Record<string, unknown> {
  const present = new Set(rows.map((r) => `${r.instrument}_${r.output}`));
  const out: Record<string, unknown> = {
    Description:
      "Scores computed by the MySelf Research Dashboard from the raw responses with the scoring schemes named below. Regenerable, never edited by hand, and never a substitute for the raw data. 'Verified' says whether a researcher has checked the scheme against the instrument's licensed scoring documentation.",
  };
  for (const scheme of schemes) {
    for (const o of scheme.outputs) {
      const col = `${scheme.key}_${o.key}`;
      if (!present.has(col)) continue;
      out[col] = {
        LongName: `${scheme.abbreviation ?? scheme.name}: ${o.label}`,
        Description: o.description ?? o.label,
        Scheme: `${scheme.key} v${scheme.version} (${SCHEME_STATUS_LABELS[scheme.status]})`,
        Method: scheme.method,
        Range: o.range,
        HigherIs: o.higherIs,
        Verified: scheme.verified ? `${scheme.verified.by}, ${scheme.verified.at.slice(0, 10)}` : false,
      };
      for (const t of o.thresholds) {
        const bandCol = `${col}_${t.key}`;
        if (!present.has(bandCol)) continue;
        out[bandCol] = {
          LongName: `${scheme.abbreviation ?? scheme.name}: ${o.label} — ${t.label}`,
          Description: `The band of ${col} under ${t.label}. Source: ${t.source}`,
          Levels: Object.fromEntries(t.bands.map((b, i) => [b.label, `${o.label} ${bandRange(t, i, o)}`])),
          Verified: t.verified,
        };
      }
    }
  }
  return out;
}
