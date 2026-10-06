import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { collection, doc, getDocs, onSnapshot, Timestamp } from "firebase/firestore";
import { compareVersions, type ReleaseMetaView, type StudyView, type SurveyView } from "@myself-dashboard/core";
import { api } from "../lib/api";
import { firebase } from "../lib/firebase";
import { REFRESH_EVENT } from "../lib/hooks";
import { useAuth } from "./auth";
import { useFilters } from "./filters";

/**
 * Study-wide reference data every page needs, for the study on screen: the
 * registered survey versions and the data-freshness marker, read directly from
 * Firestore — the security rules let anyone who may see the study read them —
 * with freshness live; and the study's surveys, from the server, which reads
 * Studio's live pointers (docs/12 §12.2).
 *
 * The provider is mounted afresh for each study (App.tsx), so nothing of one
 * study is ever on screen beside another's.
 */

interface StudyData {
  /** The study on screen, as the switcher lists it. */
  study: StudyView;
  studies: StudyView[];
  releases: ReleaseMetaView[];
  releasesLoaded: boolean;
  releasesError: string | null;
  /** Newest first. */
  byNewest: ReleaseMetaView[];
  activeRelease: ReleaseMetaView | null;
  versionLabel: (hash: string) => string;
  /** The study's surveys; one, for a study that has never had another. */
  surveys: SurveyView[];
  surveyTitle: (surveyId: string) => string;
  /** The survey a registered version belongs to. */
  surveyOf: (hash: string) => string | null;
  lastSummaryAt: string | null;
  freshnessError: boolean;
}

const Ctx = createContext<StudyData | null>(null);

export function StudyDataProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [releases, setReleases] = useState<ReleaseMetaView[]>([]);
  const [releasesLoaded, setLoaded] = useState(false);
  const [releasesError, setReleasesError] = useState<string | null>(null);
  const [surveys, setSurveys] = useState<SurveyView[]>([]);
  const [lastSummaryAt, setLast] = useState<string | null>(null);
  const [freshnessError, setFreshnessError] = useState(false);
  const studyId = me?.study ?? null;

  useEffect(() => {
    if (!studyId) return;
    const { db } = firebase();
    let cancelled = false;
    const load = () => {
      getDocs(collection(db, `studies/${studyId}/releases`))
        .then((snap) => {
          if (cancelled) return;
          setReleases(snap.docs.map((d) => d.data() as ReleaseMetaView));
          setLoaded(true);
        })
        .catch(() => {
          if (!cancelled) setReleasesError("The list of survey versions could not be loaded.");
        });
      // The surveys only shape the filters: a page still works without them.
      api
        .getSurveys({})
        .then((r) => {
          if (!cancelled && r.study === studyId) setSurveys(r.surveys);
        })
        .catch(() => undefined);
    };
    load();
    window.addEventListener(REFRESH_EVENT, load);
    const unsub = onSnapshot(
      doc(db, `studies/${studyId}/meta/freshness`),
      (snap) => {
        const v = snap.data()?.["lastSummaryAt"];
        setLast(v instanceof Timestamp ? v.toDate().toISOString() : null);
        setFreshnessError(false);
      },
      () => setFreshnessError(true),
    );
    return () => {
      cancelled = true;
      window.removeEventListener(REFRESH_EVENT, load);
      unsub();
    };
  }, [studyId]);

  const value = useMemo<StudyData>(() => {
    const byNewest = [...releases].sort((a, b) => compareVersions(b.version, a.version));
    const active = (me?.policy?.activeReleaseHash && releases.find((r) => r.hash === me.policy!.activeReleaseHash)) || byNewest[0] || null;
    const map = new Map(releases.map((r) => [r.hash, r]));
    const surveyByHash = new Map(surveys.flatMap((s) => s.releases.map((h) => [h, s.surveyId] as const)));
    const studies = me?.studies ?? [];
    return {
      study: studies.find((s) => s.study === me?.study) ?? { study: me?.study ?? "", title: me?.study ?? "", status: "open", isDefault: true },
      studies,
      releases,
      releasesLoaded,
      releasesError,
      byNewest,
      activeRelease: active,
      versionLabel: (hash: string) => (hash === "unknown" ? "Unknown version" : map.get(hash) ? `v${map.get(hash)!.version}` : hash.slice(7, 15)),
      surveys,
      surveyTitle: (id: string) => surveys.find((s) => s.surveyId === id)?.title ?? id,
      surveyOf: (hash: string) => surveyByHash.get(hash) ?? null,
      lastSummaryAt,
      freshnessError,
    };
  }, [releases, releasesLoaded, releasesError, surveys, lastSummaryAt, freshnessError, me]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStudyData(): StudyData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStudyData outside StudyDataProvider");
  return v;
}

/**
 * The versions of the survey(s) chosen in the survey filter, newest first, and
 * the active one among them: the study's active version when it is one of
 * them, else their newest. Every version when no survey is chosen.
 */
export function useSurveyReleases(): { byNewest: ReleaseMetaView[]; activeRelease: ReleaseMetaView | null } {
  const { filters } = useFilters();
  const { byNewest, activeRelease, surveyOf } = useStudyData();
  return useMemo(() => {
    if (filters.surveys.length === 0) return { byNewest, activeRelease };
    const mine = byNewest.filter((r) => filters.surveys.includes(surveyOf(r.hash) ?? ""));
    return { byNewest: mine, activeRelease: mine.find((r) => r.hash === activeRelease?.hash) ?? mine[0] ?? null };
  }, [filters.surveys, byNewest, activeRelease, surveyOf]);
}
