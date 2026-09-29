import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { collection, doc, getDocs, onSnapshot, Timestamp } from "firebase/firestore";
import { compareVersions, type ReleaseMetaView } from "@myself-dashboard/core";
import { firebase, STUDY } from "../lib/firebase";
import { useAuth } from "./auth";

/**
 * Study-wide reference data every page needs: the registered survey versions and
 * the data-freshness marker. Both are read directly from Firestore — the security
 * rules let any dashboard member read them — and freshness is live.
 */

interface StudyData {
  releases: ReleaseMetaView[];
  releasesLoaded: boolean;
  releasesError: string | null;
  /** Newest first. */
  byNewest: ReleaseMetaView[];
  activeRelease: ReleaseMetaView | null;
  versionLabel: (hash: string) => string;
  lastSummaryAt: string | null;
  freshnessError: boolean;
}

const Ctx = createContext<StudyData | null>(null);

export function StudyDataProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [releases, setReleases] = useState<ReleaseMetaView[]>([]);
  const [releasesLoaded, setLoaded] = useState(false);
  const [releasesError, setReleasesError] = useState<string | null>(null);
  const [lastSummaryAt, setLast] = useState<string | null>(null);
  const [freshnessError, setFreshnessError] = useState(false);

  useEffect(() => {
    if (!me) return;
    const { db } = firebase();
    let cancelled = false;
    getDocs(collection(db, `studies/${STUDY}/releases`))
      .then((snap) => {
        if (cancelled) return;
        setReleases(snap.docs.map((d) => d.data() as ReleaseMetaView));
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setReleasesError("The list of survey versions could not be loaded.");
      });
    const unsub = onSnapshot(
      doc(db, `studies/${STUDY}/meta/freshness`),
      (snap) => {
        const v = snap.data()?.["lastSummaryAt"];
        setLast(v instanceof Timestamp ? v.toDate().toISOString() : null);
        setFreshnessError(false);
      },
      () => setFreshnessError(true),
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [me]);

  const value = useMemo<StudyData>(() => {
    const byNewest = [...releases].sort((a, b) => compareVersions(b.version, a.version));
    const active = (me?.policy?.activeReleaseHash && releases.find((r) => r.hash === me.policy!.activeReleaseHash)) || byNewest[0] || null;
    const map = new Map(releases.map((r) => [r.hash, r]));
    return {
      releases,
      releasesLoaded,
      releasesError,
      byNewest,
      activeRelease: active,
      versionLabel: (hash: string) => (hash === "unknown" ? "Unknown version" : map.get(hash) ? `v${map.get(hash)!.version}` : hash.slice(7, 15)),
      lastSummaryAt,
      freshnessError,
    };
  }, [releases, releasesLoaded, releasesError, lastSummaryAt, freshnessError, me]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStudyData(): StudyData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStudyData outside StudyDataProvider");
  return v;
}
