import {
  applyReviewChange,
  buildRows,
  compareReleases,
  compareVersions,
  computeAnalytics,
  computeQuestionStats,
  definitionsFrom,
  emptyReview,
  indexRelease,
  makePredicate,
  neighbours,
  orderedRows,
  PAGE_SIZES,
  questionHistory,
  rangeFor,
  readPolicy,
  runQuery,
  sanitiseFilters,
  sanitiseSort,
  toListItem,
  validateNote,
  type NoteView,
  type Policy,
  type ReleaseIndex,
  type ReviewChange,
  type ReviewDoc,
  type SessionSummary,
} from "@myself-dashboard/core";
import firestoreSeed from "./data/firestore.json";

/**
 * The demo's "server": the dashboard running with no Firebase project behind it.
 *
 * `scripts/demo/record.mjs` ran the real dashboard against the Emulator Suite,
 * seeded with a made-up study, and recorded every answer its functions gave.
 * Here those answers are played back, except where the demo can do better by
 * running the same code the functions run — the session list, the overview and
 * the question analysis are computed in the browser from the recorded session
 * summaries with the functions' own core routines, so every filter works; and
 * reviews and notes change in memory, so flagging a session works until the tab
 * is closed. Saving settings and exporting are switched off.
 */

type Data = Record<string, unknown>;
type Call = { name: string; data: unknown; status: number; body?: { result?: unknown; error?: { status?: string; message?: string } }; file?: string };
type Live = { documents: Record<string, Data> };

export const DEMO_USER = { uid: firestoreSeed.uid, email: firestoreSeed.email };
const STUDY = firestoreSeed.study;

// ── Documents the web app reads from Firestore itself ───────────────────────

class DemoTimestamp {
  constructor(readonly ms: number) {}
}
// firebase-firestore.ts swaps these for its Timestamp class on first use.
let revive: (ms: number) => unknown = (ms) => new DemoTimestamp(ms);
export function useTimestamps(make: (ms: number) => unknown): void {
  revive = make;
}
const reviveAll = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(reviveAll);
  if (v && typeof v === "object") {
    const o = v as Data;
    if (typeof o["__ts"] === "number" && Object.keys(o).length === 1) return revive(o["__ts"]);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, reviveAll(x)]));
  }
  return v;
};

let docs: Map<string, Data> | null = null;
const listeners = new Set<() => void>();
export function documents(): Map<string, Data> {
  docs ??= new Map(Object.entries(firestoreSeed.documents).map(([path, value]) => [path, reviveAll(value) as Data]));
  return docs;
}
export function onDocumentsChanged(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
export function touchDocuments(): void {
  setTimeout(() => listeners.forEach((f) => f()), 0);
}
function audit(action: string, target: Data, detail: Data = {}): void {
  documents().set(`studies/${STUDY}/auditLog/demo${Date.now()}${Math.random().toString(36).slice(2, 6)}`, {
    action, actorUid: DEMO_USER.uid, actorEmail: DEMO_USER.email, actorRole: "owner", target, detail: { ...detail, demo: true }, outcome: "success", at: revive(Date.now()),
  });
  touchDocuments();
}

// ── Recorded answers ─────────────────────────────────────────────────────────

const bodies = import.meta.glob<{ default: Call["body"] }>("./data/calls/*.json");
let calls: Promise<Call[]> | null = null;
const recorded = () => (calls ??= import("./data/calls.json").then((m) => m.default as Call[]));

const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as Data).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Data)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
};
// Fields that pick WHICH thing is asked for: an answer about another session or another grouping is never a fair stand-in.
const IDENTITY = ["sessionId", "key", "versionHash", "compareWith", "groupBy", "observation", "focus"];

async function replay(name: string, data: unknown, options: { exact?: (recorded: unknown) => boolean } = {}): Promise<unknown> {
  const mine = (await recorded()).filter((c) => c.name === name && c.status === 200);
  const want = canonical(data);
  let best = options.exact ? mine.find((c) => options.exact!(c.data)) : mine.find((c) => canonical(c.data) === want);
  if (!best && !options.exact) {
    const d = (data ?? {}) as Data;
    let score = -Infinity;
    for (const c of mine) {
      const cd = (c.data ?? {}) as Data;
      let s = 0;
      for (const k of IDENTITY) if (canonical(d[k]) !== canonical(cd[k])) s -= 1000;
      for (const k of Object.keys(d)) if (canonical(d[k]) === canonical(cd[k])) s += 1;
      if (s > score) {
        score = s;
        best = c;
      }
    }
    if (best && score <= -1000) best = undefined;
  }
  if (!best) throw demoError(name === "getSessionDetail" ? "not-found" : "failed-precondition", "This view was not recorded for the demo.");
  const body = best.file ? (await bodies[`./data/calls/${best.file}.json`]!()).default : best.body;
  return structuredClone(body?.result ?? null);
}

function demoError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code: `functions/${code}` });
}

// ── Computed in the browser, as the functions compute them ──────────────────

let live: Promise<{ summaries: SessionSummary[]; reviews: Map<string, ReviewDoc>; policy: Policy; releases: ReleaseIndex[] }> | null = null;
const state = () =>
  (live ??= import("./data/live.json").then((m) => {
    const d = (m.default as Live).documents;
    const under = (col: string) => Object.entries(d).filter(([p]) => p.startsWith(`studies/${STUDY}/${col}/`));
    const strip = <T,>(v: Data): T => {
      const { _ts, ...rest } = v;
      void _ts;
      return rest as T;
    };
    return {
      summaries: under("sessionSummaries").map(([, v]) => strip<SessionSummary>(v)).filter((s) => !(s as unknown as Data)["deleted"]),
      reviews: new Map(under("reviews").map(([p, v]) => [p.split("/").pop()!, strip<ReviewDoc>(v)])),
      policy: readPolicy(d["config/policy"] ?? {}),
      releases: under("releaseManifests").map(([, v]) => indexRelease(JSON.parse(String(v["manifestJson"])))),
    };
  }));
const notesAdded = new Map<string, NoteView[]>();
const drafts = new Map<string, { id: string; name: string; baseHash: string; baseVersion: string; edits: unknown[]; rev: number; updatedAt: string }>();

async function rows(now: Date) {
  const s = await state();
  return { ...s, rows: buildRows(s.summaries, s.reviews, s.policy, now) };
}
const clampInt = (v: unknown, min: number, max: number, fallback: number) => Math.min(max, Math.max(min, typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback));
const search = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : "");

const handlers: Record<string, (data: Data) => Promise<unknown>> = {
  async querySessions(data) {
    const now = new Date();
    const { rows: all, releases, policy } = await rows(now);
    const defs = definitionsFrom(releases);
    const pageSize = (PAGE_SIZES as readonly number[]).includes(data["pageSize"] as number) ? (data["pageSize"] as number) : 50;
    const result = runQuery(
      all,
      { filters: sanitiseFilters(data["filters"]), sort: sanitiseSort(data["sort"]), search: search(data["search"]), page: clampInt(data["page"], 1, 100_000, 1), pageSize },
      { now, timeZone: policy.timeZone },
      { studyCodes: true },
    );
    return { items: result.rows.map((r) => toListItem(r, { studyCodes: true, sectionTitle: defs.section })), total: result.total, page: result.page, pageSize: result.pageSize, pageCount: result.pageCount, computedAt: now.toISOString() };
  },

  async getAnalytics(data) {
    const now = new Date();
    const { rows: all, releases, policy, summaries } = await rows(now);
    const filters = sanitiseFilters(data["filters"]);
    const ctx = { now, timeZone: policy.timeZone };
    const base = (await replay("getAnalytics", data)) as Data;
    const freshness = (base["freshness"] ?? {}) as Data;
    return { ...base, analytics: computeAnalytics(all.filter(makePredicate(filters, ctx)), { ...ctx, range: rangeFor(filters, ctx), releases }), freshness: { ...freshness, summaryCount: summaries.length } };
  },

  async getResearcherView(data) {
    // Computed from the raw sittings, which the demo does not carry: played back for the
    // filters it was recorded with, and never as a stand-in for figures under other filters.
    const want = canonical(sanitiseFilters(data["filters"]));
    return replay("getResearcherView", data, { exact: (d) => canonical(sanitiseFilters((d as Data | null)?.["filters"])) === want });
  },

  async getQuestionAnalytics(data) {
    const now = new Date();
    const { rows: all, releases, policy } = await rows(now);
    const release = releases.find((r) => r.hash === data["versionHash"]);
    if (!release) throw demoError("not-found", "That survey version is not in the registry.");
    const other = releases.find((r) => r.hash === data["compareWith"]) ?? null;
    const filters = { ...sanitiseFilters(data["filters"]), versions: [release.hash] };
    const filtered = all.filter(makePredicate(filters, { now, timeZone: policy.timeZone }));
    return {
      release: { hash: release.hash, key: release.key, version: release.version, publishedAt: release.publishedAt, title: release.title, questionCount: release.questions.length, sectionCount: release.sections.length },
      stats: computeQuestionStats(filtered, release, policy.requiredLevels),
      comparison: other ? (compareVersions(other.version, release.version) < 0 ? compareReleases(other, release) : compareReleases(release, other)) : null,
      sessions: filtered.length,
      computedAt: now.toISOString(),
    };
  },

  async getQuestionHistory(data) {
    const { releases } = await state();
    const key = String(data["key"] ?? "");
    return { key, entries: questionHistory(key, releases) };
  },

  async getSessionDetail(data) {
    const sessionId = String(data["sessionId"] ?? "");
    const detail = (await replay("getSessionDetail", { sessionId, ...(data["context"] ? { context: data["context"] } : {}) })) as Data;
    const now = new Date();
    const { rows: all, releases, policy } = await rows(now);
    const row = all.find((r) => r.summary.sessionId === sessionId);
    const release = releases.find((r) => r.hash === row?.summary.releaseHash);
    const context = data["context"] as Data | undefined;
    audit("session.viewed", { type: "session", id: sessionId });
    return {
      ...detail,
      ...(row ? { item: toListItem(row, { studyCodes: true, ...(release ? { sectionTitle: (k: string) => release.sections.find((x) => x.key === k)?.title } : {}) }), warnings: row.status.signals } : {}),
      review: row?.review ?? emptyReview(sessionId),
      notes: [...((detail["notes"] as NoteView[]) ?? []), ...(notesAdded.get(sessionId) ?? [])],
      neighbours: context
        ? neighbours(orderedRows(all, { filters: sanitiseFilters(context["filters"]), sort: sanitiseSort(context["sort"]), search: search(context["search"]) }, { now, timeZone: policy.timeZone }, { studyCodes: true }), sessionId, clampInt(context["pageSize"], 25, 200, 50))
        : null,
    };
  },

  async updateReview(data) {
    const s = await state();
    const sessionId = String(data["sessionId"] ?? "");
    const current = s.reviews.get(sessionId) ?? emptyReview(sessionId);
    if (typeof data["expectedRev"] === "number" && current.rev !== data["expectedRev"]) throw demoError("aborted", "Someone else changed this review a moment ago.");
    try {
      const { next, before, after } = applyReviewChange(current, data["change"] as ReviewChange, DEMO_USER, new Date(), () => crypto.randomUUID());
      s.reviews.set(sessionId, next);
      audit("review.updated", { type: "session", id: sessionId }, { change: (data["change"] as Data)["kind"], before, after, rev: next.rev });
      return { review: next };
    } catch (e) {
      throw demoError("invalid-argument", (e as Error).message);
    }
  },

  async addNote(data) {
    const s = await state();
    const sessionId = String(data["sessionId"] ?? "");
    let text: string;
    try {
      text = validateNote(data["text"]);
    } catch (e) {
      throw demoError("invalid-argument", (e as Error).message);
    }
    const current = s.reviews.get(sessionId) ?? emptyReview(sessionId);
    const note: NoteView = { id: crypto.randomUUID(), text, authorUid: DEMO_USER.uid, authorEmail: DEMO_USER.email, createdAt: new Date().toISOString() };
    notesAdded.set(sessionId, [...(notesAdded.get(sessionId) ?? []), note]);
    const noteCount = current.noteCount + 1;
    s.reviews.set(sessionId, { ...current, noteCount, updatedAt: note.createdAt!, updatedBy: DEMO_USER.uid, rev: current.rev + 1 });
    audit("note.added", { type: "session", id: sessionId });
    return { id: note.id, noteCount };
  },

  // Survey editor drafts, kept in memory for as long as the tab is open.
  async listSurveyDrafts() {
    return { drafts: [...drafts.values()].map((d) => ({ id: d.id, name: d.name, baseHash: d.baseHash, baseVersion: d.baseVersion, edits: d.edits.length, status: "open", updatedAt: d.updatedAt, updatedBy: DEMO_USER.email, publishedVersion: null })) };
  },
  async getSurveyDraft(data) {
    const d = drafts.get(String(data["id"] ?? ""));
    if (!d) throw demoError("not-found", "No draft with that id.");
    return { ...structuredClone(d), status: "open", updatedBy: DEMO_USER.email };
  },
  async saveSurveyDraft(data) {
    const id = typeof data["id"] === "string" && data["id"] ? data["id"] : `demo${Date.now().toString(36)}`;
    const versions = (await replay("listSurveyVersions", {})) as { versions: { hash: string; version: string }[] };
    const rev = (drafts.get(id)?.rev ?? 0) + 1;
    drafts.set(id, {
      id,
      name: String(data["name"] ?? ""),
      baseHash: String(data["baseHash"] ?? ""),
      baseVersion: versions.versions.find((v) => v.hash === data["baseHash"])?.version ?? "",
      edits: structuredClone((data["edits"] as unknown[]) ?? []),
      rev,
      updatedAt: new Date().toISOString(),
    });
    return { id, rev };
  },
  async deleteSurveyDraft(data) {
    drafts.delete(String(data["id"] ?? ""));
    return { ok: true };
  },

  async logChartDownload() {
    return { ok: true };
  },
  async logFigureExport() {
    return { ok: true };
  },
};

// Changes the demo does not make: nothing is saved and nothing leaves it.
const SWITCHED_OFF: Record<string, string> = {
  createExport: "Exports are switched off in this demo.",
  saveScoringScheme: "Saving is switched off in this demo.",
  saveGroupSettings: "Saving is switched off in this demo.",
  updateAccessPolicy: "Settings cannot be changed in this demo.",
  updatePolicy: "Settings cannot be changed in this demo.",
  setDashboardRole: "Roles cannot be changed in this demo.",
  rebuildSummaries: "This demo has no server to rebuild.",
  registerReleaseManifest: "This demo has no server to register a version with.",
  previewSurveyDraft: "The publish checks and the preview run on the dashboard's server, with the survey's own release builder; this demo has no server.",
  publishSurveyVersion: "Publishing is switched off in this demo: it would change what every iPad runs.",
  activateSurveyVersion: "Changing the active version is switched off in this demo.",
  exportSurveyProvenance: "Exports are switched off in this demo.",
};

export async function callFunction(name: string, data: unknown): Promise<unknown> {
  await new Promise((r) => setTimeout(r, 120));
  if (SWITCHED_OFF[name]) throw demoError("failed-precondition", SWITCHED_OFF[name]);
  const handler = handlers[name];
  return handler ? handler((data ?? {}) as Data) : replay(name, data);
}

