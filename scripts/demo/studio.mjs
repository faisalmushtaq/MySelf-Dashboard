/**
 * MySelf Studio's records for the made-up YBM study: the documents Studio
 * would hold in the survey's database after a believable fortnight (survey
 * docs/16 §5.2; the shapes are its packages/studio/src/contract.ts). Invented,
 * like the rest of the demo; the people are the demo's own.
 *
 *   30 Sep  an administrator sets Studio up from the live survey: r5.0.0 to
 *           r9.0.0 come in from the repository, with r9.0.0, already on the
 *           iPads, live;
 *    1 Oct  r10.0.0 is published in Studio: r9.0.0 ending with MyStory;
 *    2 Oct  r9.0.0 is made live again, with a reason, because MyStory needs
 *           the newer app on every iPad first.
 *
 * r10.0.0 is not in the dashboard's registry. The dashboard meets it in the
 * sittings collected under it, checks Studio's copy against their hash and
 * registers it, as it would in production (docs/11).
 */
import { indexRelease } from "@myself-dashboard/core";
import { contentHash } from "@myself-dashboard/core/node";
import { Timestamp } from "firebase-admin/firestore";
import { readRelease } from "./ybm-study.mjs";

export const SURVEY = "ybm_nd2026_standard";
const IMPORTED = ["5.0.0", "6.0.0", "7.0.0", "7.0.1", "7.1.0", "7.2.0", "7.3.0", "8.0.0", "9.0.0"];
const AT = {
  setUp: "2026-09-30T16:10:00.000Z",
  edited: "2026-10-01T07:05:00.000Z",
  published: "2026-10-01T07:40:00.000Z",
  madeLiveAgain: "2026-10-02T07:30:00.000Z",
};
/** The school day r10.0.0 was on the iPads, for the sittings collected under it. */
export const MYSTORY_DAY = "2026-10-01T00:00:00.000Z";
const REPOSITORY_RELEASE_NOTE = "Published from the repository before MySelf Studio";
const MYSTORY = { protocol: "np.phone_wellbeing", protocolVersion: "0.1.1" };

const ts = (iso) => Timestamp.fromDate(new Date(iso));

/** r10.0.0: r9.0.0 with MyStory as its last section, its protocol frozen in, as Studio publishes it. */
export function mystoryRelease(publishedBy) {
  const { hash, ...r9 } = readRelease("9.0.0");
  void hash;
  const body = {
    ...r9,
    release: { ...r9.release, key: "ybm_nd2026_standard_r10_0_0", version: "10.0.0", publishedAt: AT.published, publishedBy, engineVersion: "0.4.0", decisionRefs: [] },
    composition: { ...r9.composition, sections: [...r9.composition.sections, { key: "mystory", title: "MyStory", components: [{ kind: "narrative", ...MYSTORY }] }] },
    narrativeProtocols: {
      [`${MYSTORY.protocol}@${MYSTORY.protocolVersion}`]: { key: MYSTORY.protocol, version: MYSTORY.protocolVersion, name: "Phones and wellbeing", owner: publishedBy, approval_status: "approved", language: "en-GB", estimated_minutes: 10, age_min: 11, age_max: 18 },
    },
  };
  return { ...body, hash: contentHash(body) };
}

/** Every Studio document, as [path, data]. */
export function studioDocuments({ study, owner, colleague, mystory }) {
  const base = `studies/${study}`;
  const docs = [];
  const versionDoc = (m, more) => {
    const idx = indexRelease(m);
    return {
      surveyId: SURVEY, version: m.release.version, hash: m.hash, releaseKey: m.release.key, engineVersion: m.release.engineVersion,
      releaseNote: REPOSITORY_RELEASE_NOTE, changeSummary: null, bump: null,
      itemKeys: idx.questions.map((q) => q.key), variables: idx.questions.map((q) => q.variable),
      source: "repository", draftRevision: null, basedOnVersion: null, authors: [],
      publishedAt: ts(m.release.publishedAt), publishedBy: "repository", publishedByEmail: null, manifestPublishedAt: m.release.publishedAt,
      ...more,
    };
  };
  const publicRelease = (m, publishedAt) => {
    const manifest = JSON.stringify(m);
    return { surveyId: SURVEY, study, hash: m.hash, version: m.release.version, releaseKey: m.release.key, engineVersion: m.release.engineVersion, manifest, bytes: Buffer.byteLength(manifest, "utf8"), publishedAt: ts(publishedAt) };
  };

  for (const v of IMPORTED) {
    const m = readRelease(v);
    docs.push([`${base}/publicReleases/${m.hash.slice("sha256:".length)}`, publicRelease(m, m.release.publishedAt)]);
    docs.push([`${base}/surveys/${SURVEY}/versions/${v}`, versionDoc(m, {})]);
  }
  const summary = {
    bump: "major",
    entries: [{ kind: "mystory.added", bump: "major", breaking: false, message: `MyStory added (${MYSTORY.protocol}@${MYSTORY.protocolVersion})` }],
    counts: { added: 0, removed: 0, archived: 0, changed: 0, moved: 0 },
  };
  docs.push([`${base}/publicReleases/${mystory.hash.slice("sha256:".length)}`, publicRelease(mystory, AT.published)]);
  docs.push([
    `${base}/surveys/${SURVEY}/versions/10.0.0`,
    versionDoc(mystory, {
      releaseNote: "The survey now ends with MyStory: after the last section and before the finish screen, each child tells Sam about their phone.",
      changeSummary: summary, bump: "major", source: "studio", draftRevision: 14, basedOnVersion: "9.0.0", authors: [owner.email, colleague.email],
      publishedAt: ts(AT.published), publishedBy: owner.uid, publishedByEmail: owner.email,
    }),
  ]);

  const r9 = readRelease("9.0.0");
  const live = { version: "9.0.0", hash: r9.hash, releaseKey: r9.release.key, generation: 3, publishedAt: ts(r9.release.publishedAt), publishedBy: "repository", publishedByEmail: null };
  docs.push([`${base}/surveys/${SURVEY}`, { surveyId: SURVEY, study, title: r9.composition.title, createdAt: ts(AT.setUp), createdBy: owner.uid, active: live, latestVersion: "10.0.0", versionCount: IMPORTED.length + 1, draftEditors: [] }]);
  docs.push([`${base}/published/${SURVEY}`, { surveyId: SURVEY, study, hash: r9.hash, version: "9.0.0", releaseKey: r9.release.key, engineVersion: r9.release.engineVersion, generation: 3, publishedAt: ts(r9.release.publishedAt) }]);

  const row = (at, who, action, subject, detail) => ({ at: ts(at), actor: who.uid, actorEmail: who.email, action, surveyId: SURVEY, subject, detail });
  docs.push([`${base}/studioAudit/demo-1`, row(AT.setUp, owner, "survey.imported", SURVEY, { imported: IMPORTED, active: "9.0.0", createdSurvey: true, createdDraft: true })]);
  docs.push([`${base}/studioAudit/demo-2`, row(AT.edited, colleague, "draft.edited", "mystory", { questions: [], revisions: [12, 14] })]);
  docs.push([`${base}/studioAudit/demo-3`, row(AT.published, owner, "version.published", "10.0.0", { version: "10.0.0", hash: mystory.hash, releaseKey: mystory.release.key, releaseNote: "The survey now ends with MyStory.", bump: "major", required: "major", counts: summary.counts, draftRevision: 14, generation: 2 })]);
  docs.push([
    `${base}/studioAudit/demo-4`,
    row(AT.madeLiveAgain, owner, "version.activated", "9.0.0", {
      version: "9.0.0", hash: r9.hash, previous: { version: "10.0.0", hash: mystory.hash, generation: 2 },
      reason: "MyStory needs the newer app on every iPad first; back to 9.0.0 until they all have it.", generation: 3,
    }),
  ]);
  return docs;
}
