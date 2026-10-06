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
 *           the newer app on every iPad first;
 *    3 Oct  a second survey of the YBM study, a short MyPhone MyBrain
 *           follow-up, is created and published, with its own link;
 *    4 Oct  an owner creates a second study space, "Perspectives of the
 *           future", and publishes its first survey there (docs/12).
 *
 * None of the versions published in Studio is in the dashboard's registry. The
 * dashboard meets each in the sittings collected under it, checks Studio's copy
 * against their hash and registers it in its own study, as it would in
 * production (docs/11, docs/12).
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
  followUpCreated: "2026-10-03T09:00:00.000Z",
  followUp: "2026-10-03T15:20:00.000Z",
  futureCreated: "2026-10-04T10:00:00.000Z",
  future: "2026-10-04T14:45:00.000Z",
};
/** The school day r10.0.0 was on the iPads, for the sittings collected under it. */
export const MYSTORY_DAY = "2026-10-01T00:00:00.000Z";
/** The follow-up survey's first school day, and the future study's fortnight. */
export const FOLLOW_UP_DAY = "2026-10-05T00:00:00.000Z";
export const FUTURE_DAYS = { from: "2026-10-05T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" };
export const FOLLOW_UP = "ybm_mpmb_followup";
export const FUTURE = { study: "future", title: "Perspectives of the future", survey: "future_perspectives" };
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

/**
 * A new survey made in Studio from r9.0.0's questions: some of its sections,
 * under its own survey id, title, study and version 1.0.0, hashed as Studio
 * publishes it.
 */
function surveyFromR9({ study, surveyId, title, sections, publishedAt, publishedBy }) {
  const { hash, ...r9 } = readRelease("9.0.0");
  void hash;
  const keep = new Set(sections);
  const body = {
    ...r9,
    release: { ...r9.release, study, assessment: surveyId, key: `${surveyId}_r1_0_0`, version: "1.0.0", publishedAt, publishedBy, decisionRefs: [] },
    composition: { ...r9.composition, key: surveyId, study, title, sections: r9.composition.sections.filter((s) => keep.has(s.key)) },
  };
  return { ...body, hash: contentHash(body) };
}

/** The YBM study's second survey: a short follow-up about phones, gaming and how they feel right now. */
export const followUpRelease = (publishedBy) =>
  surveyFromR9({ study: "ybm", surveyId: FOLLOW_UP, title: "MyPhone MyBrain: follow-up", sections: ["welcome", "about_you", "phones", "social_media", "gaming", "right_now"], publishedAt: AT.followUp, publishedBy });

/** The future study's survey: wellbeing, and the message to their future self. */
export const futureRelease = (publishedBy) =>
  surveyFromR9({ study: FUTURE.study, surveyId: FUTURE.survey, title: FUTURE.title, sections: ["welcome", "about_you", "wellbeing", "right_now"], publishedAt: AT.future, publishedBy });

/** A survey made and published in Studio from scratch: its survey, version, frozen manifest, live pointer and audit rows. */
function newSurveyDocuments({ study, m, owner, releaseNote, at, audit }) {
  const base = `studies/${study}`;
  const surveyId = m.release.assessment;
  const idx = indexRelease(m);
  const manifest = JSON.stringify(m);
  const pointer = { surveyId, study, hash: m.hash, version: "1.0.0", releaseKey: m.release.key, engineVersion: m.release.engineVersion, generation: 1, publishedAt: ts(at.published) };
  return [
    [`${base}/surveys/${surveyId}`, { surveyId, study, title: m.composition.title, createdAt: ts(at.created), createdBy: owner.uid, active: { ...pointer, publishedBy: owner.uid, publishedByEmail: owner.email }, latestVersion: "1.0.0", versionCount: 1, draftEditors: [] }],
    [`${base}/surveys/${surveyId}/versions/1.0.0`, {
      surveyId, version: "1.0.0", hash: m.hash, releaseKey: m.release.key, engineVersion: m.release.engineVersion, releaseNote, changeSummary: null, bump: "major",
      itemKeys: idx.questions.map((q) => q.key), variables: idx.questions.map((q) => q.variable), source: "studio", draftRevision: 6, basedOnVersion: null, authors: [owner.email],
      publishedAt: ts(at.published), publishedBy: owner.uid, publishedByEmail: owner.email, manifestPublishedAt: m.release.publishedAt,
    }],
    [`${base}/publicReleases/${m.hash.slice("sha256:".length)}`, { surveyId, study, hash: m.hash, version: "1.0.0", releaseKey: m.release.key, engineVersion: m.release.engineVersion, manifest, bytes: Buffer.byteLength(manifest, "utf8"), publishedAt: ts(at.published) }],
    [`${base}/published/${surveyId}`, pointer],
    [`${base}/studioAudit/${audit}-created`, { at: ts(at.created), actor: owner.uid, actorEmail: owner.email, action: "survey.created", surveyId, subject: surveyId, detail: { title: m.composition.title } }],
    [`${base}/studioAudit/${audit}-published`, { at: ts(at.published), actor: owner.uid, actorEmail: owner.email, action: "version.published", surveyId, subject: "1.0.0", detail: { version: "1.0.0", hash: m.hash, releaseKey: m.release.key, releaseNote, bump: "major", generation: 1 } }],
  ];
}

/**
 * The second study space (survey docs/16 §11.4): its registry document, as
 * the Studio's "New study space" writes it, and its first survey.
 */
export function futureStudyDocuments({ owner, release }) {
  return [
    [`studies/${FUTURE.study}`, { study: FUTURE.study, title: FUTURE.title, status: "open", createdAt: ts(AT.futureCreated), createdBy: owner.uid, updatedAt: ts(AT.futureCreated), updatedBy: owner.uid, closedAt: null }],
    [`studies/${FUTURE.study}/studioAudit/demo-1`, { at: ts(AT.futureCreated), actor: owner.uid, actorEmail: owner.email, action: "study.created", surveyId: null, subject: FUTURE.study, detail: { title: FUTURE.title } }],
    ...newSurveyDocuments({
      study: FUTURE.study,
      m: release,
      owner,
      releaseNote: "A standalone study of how young people see their future: wellbeing, and a message to their future self.",
      at: { created: AT.futureCreated, published: AT.future },
      audit: "demo-2",
    }),
  ];
}

/** Every Studio document, as [path, data]. */
export function studioDocuments({ study, owner, colleague, mystory, followUp }) {
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
  if (followUp) {
    docs.push(
      ...newSurveyDocuments({
        study,
        m: followUp,
        owner,
        releaseNote: "A short follow-up for the MyPhone MyBrain stage: phones, social media, gaming and how they feel right now.",
        at: { created: AT.followUpCreated, published: AT.followUp },
        audit: "demo-5",
      }),
    );
  }
  return docs;
}
