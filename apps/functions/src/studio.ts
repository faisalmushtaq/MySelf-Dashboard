import type { StudioLiveEvent, StudioPointer, StudioSurveyRecord, StudioVersionRecord, VersionSource } from "@myself-dashboard/core";
import { Timestamp } from "firebase-admin/firestore";
import { research } from "./env.js";
import { spaths } from "./paths.js";

/**
 * MySelf Studio's records of the survey's versions, read from the survey's
 * database with the Admin SDK (docs/11; survey docs/16 §5.2 and §9.2, typed in
 * its packages/studio/src/contract.ts). Read-only: Studio is the one place a
 * version is edited and published, and nothing in the dashboard writes there.
 *
 * Before an administrator presses "Set up from the live survey" in Studio
 * these collections are empty, and every iPad runs the version built into the
 * survey app.
 */

/** The audit rows that move the live pointer, and how each one moved it. */
const LIVE_ACTIONS = { "survey.imported": "set_up", "version.published": "published", "version.activated": "made_live_again" } as const;
/** And "Restore into draft", for the version a later publish was restored from. */
const TRAIL_ACTIONS = [...Object.keys(LIVE_ACTIONS), "draft.restored"];

const iso = (v: unknown): string | null => (v instanceof Timestamp ? v.toDate().toISOString() : typeof v === "string" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function versionRecord(surveyId: string, d: Record<string, unknown>): StudioVersionRecord | null {
  const version = str(d["version"]);
  const hash = str(d["hash"]);
  if (!version || !hash) return null;
  const summary = d["changeSummary"] as { bump?: unknown; entries?: { message?: unknown }[] } | null | undefined;
  const source: VersionSource = d["source"] === "repository" ? "repository" : "studio";
  return {
    surveyId,
    version,
    hash,
    releaseKey: str(d["releaseKey"]) ?? "",
    engineVersion: str(d["engineVersion"]),
    source,
    releaseNote: str(d["releaseNote"]),
    changes: (summary?.entries ?? []).map((e) => str(e?.message)).filter((m): m is string => m !== null),
    requiredBump: str(summary?.bump),
    chosenBump: str(d["bump"]),
    basedOn: str(d["basedOnVersion"]),
    authors: strings(d["authors"]),
    // An email is how the research team knows one another; a uid says nothing to them.
    publishedBy: str(d["publishedByEmail"]) ?? (d["publishedBy"] === "repository" ? "repository" : null),
    publishedAt: iso(d["publishedAt"]) ?? str(d["manifestPublishedAt"]),
  };
}

function pointerRecord(d: Record<string, unknown> | undefined): StudioPointer | null {
  const hash = str(d?.["hash"]);
  const version = str(d?.["version"]);
  if (!d || !hash || !version) return null;
  return { hash, version, releaseKey: str(d["releaseKey"]) ?? "", generation: typeof d["generation"] === "number" ? d["generation"] : 0, publishedAt: iso(d["publishedAt"]) };
}

function liveEvent(d: Record<string, unknown>): (StudioLiveEvent & { surveyId: string | null }) | null {
  const how = LIVE_ACTIONS[d["action"] as keyof typeof LIVE_ACTIONS];
  const at = iso(d["at"]);
  const detail = (d["detail"] ?? {}) as Record<string, unknown>;
  if (!how || !at) return null;
  // A later set-up of a survey that already existed left its pointer where it was.
  if (how === "set_up" && detail["createdSurvey"] === false) return null;
  const version = how === "set_up" ? str(detail["active"]) : (str(detail["version"]) ?? str(d["subject"]));
  if (!version) return null;
  return {
    surveyId: str(d["surveyId"]),
    at,
    how,
    version,
    hash: how === "set_up" ? null : str(detail["hash"]),
    by: str(d["actorEmail"]),
    reason: how === "made_live_again" ? str(detail["reason"]) : null,
  };
}

function restore(d: Record<string, unknown>): { surveyId: string | null; at: string; version: string } | null {
  const at = iso(d["at"]);
  const version = str(((d["detail"] ?? {}) as Record<string, unknown>)["version"]) ?? str(d["subject"]);
  return d["action"] === "draft.restored" && at && version ? { surveyId: str(d["surveyId"]), at, version } : null;
}

/** Studio's records of every survey in `study`. */
export async function readStudio(study: string): Promise<StudioSurveyRecord[]> {
  const db = research();
  const [surveys, trail] = await Promise.all([
    db.collection(spaths.studioSurveys(study)).get(),
    // Only the few rows about versions: draft edits are most of the trail.
    db.collection(spaths.studioAudit(study)).where("action", "in", TRAIL_ACTIONS).get(),
  ]);
  const events = trail.docs.map((d) => liveEvent(d.data())).filter((e) => e !== null);
  const restores = trail.docs.map((d) => restore(d.data())).filter((r) => r !== null);
  return Promise.all(
    surveys.docs.map(async (s) => {
      const [versions, pointer] = await Promise.all([db.collection(spaths.studioVersions(study, s.id)).get(), db.doc(spaths.publishedPointer(study, s.id)).get()]);
      return {
        surveyId: s.id,
        title: str(s.get("title")) ?? s.id,
        pointer: pointerRecord(pointer.data()),
        versions: versions.docs.map((v) => versionRecord(s.id, v.data())).filter((v) => v !== null),
        events: events.filter((e) => e.surveyId === s.id),
        restores: restores.filter((r) => r.surveyId === s.id),
      };
    }),
  );
}
