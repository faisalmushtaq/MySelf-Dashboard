import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { unfreeze, type Edit, type Workspace } from "@myself-dashboard/core";
import { useAuth } from "../../app/auth";
import { Icon } from "../../components/Icon";
import { PageHeader } from "../../components/Metric";
import { ErrorState, Loading, Notice } from "../../components/States";
import { api, explain } from "../../lib/api";
import { useLoad } from "../../lib/hooks";
import { ChangesPanel } from "./editor/ChangesPanel";
import { MyStoryPanel } from "./editor/MyStoryPanel";
import { Outline } from "./editor/Outline";
import { ScreensPanel } from "./editor/ScreensPanel";
import { SectionEditor } from "./editor/SectionEditor";
import { useDraft } from "./editor/useDraft";
import "./survey.css";

/**
 * Survey → a draft (docs/11). A draft starts from a published version and is a
 * list of edits on it; everything on this page is worked out from those two
 * things, in the browser with the same code the server runs. Saving stores the
 * edits; publishing (owners) sends them to the server, which rebuilds the draft
 * with the survey's own builder and publish checks before anything reaches an
 * iPad.
 */

type Tab = "questions" | "screens" | "mystory" | "changes";
const TABS: [Tab, string][] = [
  ["questions", "Sections and questions"],
  ["screens", "Labels and screens"],
  ["mystory", "MyStory"],
  ["changes", "Changes and publish"],
];

export default function Editor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const isNew = id === "new";
  const draft = useLoad(() => (isNew ? Promise.resolve(null) : api.getSurveyDraft({ id: id! })), [id]);
  const baseHash = isNew ? params.get("from") ?? "" : draft.data?.baseHash ?? "";
  const manifest = useLoad(() => api.getSurveyManifest({ hash: baseHash }), [baseHash], { enabled: !!baseHash });
  const versions = useLoad(() => api.listSurveyVersions({}), []);

  const base: Workspace | null = useMemo(() => (manifest.data ? unfreeze(JSON.parse(manifest.data.manifestJson)) : null), [manifest.data]);
  const highest = useMemo(() => [...(versions.data?.versions ?? [])].map((v) => v.version).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1) ?? "0.0.0", [versions.data]);

  if (draft.error) return <ErrorState message={draft.error.message} onRetry={draft.reload} />;
  if (manifest.error) return <ErrorState message={manifest.error.message} onRetry={manifest.reload} />;
  if (!baseHash) return <ErrorState message="Choose a version to start the draft from, on Survey versions." />;
  if (!base || !versions.data || (!isNew && !draft.data)) return <Loading label="Opening the draft" />;
  return <DraftEditor key={id} id={isNew ? null : id!} base={base} baseHash={baseHash} highest={highest} initialName={draft.data?.name ?? `Changes to v${base.base.version}`} initialEdits={draft.data?.edits ?? []} initialRev={draft.data?.rev ?? 0} published={draft.data?.status === "published"} canPublish={versions.data.canPublish} />;
}

function DraftEditor({
  id,
  base,
  baseHash,
  highest,
  initialName,
  initialEdits,
  initialRev,
  published,
  canPublish,
}: {
  id: string | null;
  base: Workspace;
  baseHash: string;
  highest: string;
  initialName: string;
  initialEdits: Edit[];
  initialRev: number;
  published: boolean;
  canPublish: boolean;
}) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const d = useDraft(base, initialEdits, highest);
  const [tab, setTab] = useState<Tab>("questions");
  const [section, setSection] = useState<string | null>(base.draft.sections[0]?.key ?? null);
  const [name, setName] = useState(initialName);
  const [rev, setRev] = useState(initialRev);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "warn"; text: string } | null>(null);
  const readOnly = published || !can("survey.edit");

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (d.dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [d.dirty]);

  if (!d.derived) return <Loading />;
  const { workspace: ws, failed, changes, next } = d.derived;
  const push = (e: Edit | Edit[]) => (readOnly ? "This draft cannot be changed." : d.push(e));

  /** Save, and say under which id (a new draft gets one on its first save). */
  const save = async (): Promise<string | null> => {
    setSaving(true);
    setMessage(null);
    try {
      const r = await api.saveSurveyDraft({ ...(id ? { id, rev } : {}), name, baseHash, edits: d.edits });
      setRev(r.rev);
      d.setDirty(false);
      setMessage({ tone: "info", text: "Saved." });
      if (!id) navigate(`/survey/drafts/${r.id}`, { replace: true });
      return r.id;
    } catch (e) {
      setMessage({ tone: "warn", text: explain(e).message });
      return null;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page survey-editor">
      <PageHeader
        title={name}
        description={
          <>
            A draft of the survey, starting from v{base.base.version}.{" "}
            {changes.length === 0 ? (
              "No changes yet."
            ) : (
              <>
                With its {changes.length} change{changes.length === 1 ? "" : "s"} it would become <strong>v{next.version}</strong> ({next.level}).
              </>
            )}{" "}
            Nothing reaches an iPad until an owner publishes it.
          </>
        }
        actions={
          readOnly ? (
            <span className="tag">{published ? "published — read only" : "read only"}</span>
          ) : (
            <>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : d.dirty || !id ? "Save the draft" : "Saved"}
              </button>
              {id ? (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={async () => {
                    if (!window.confirm("Delete this draft? Published versions are not affected.")) return;
                    await api.deleteSurveyDraft({ id });
                    navigate("/survey");
                  }}
                >
                  <Icon name="trash" size={16} /> Delete
                </button>
              ) : null}
            </>
          )
        }
      />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {failed ? (
        <Notice tone="warn">
          Edit {failed.index + 1} ({failed.message}) no longer applies; the edits after it are not shown. Undo it on the Changes tab.
        </Notice>
      ) : null}
      {!readOnly ? (
        <label className="draft-name">
          Draft name
          <input type="text" value={name} maxLength={120} onChange={(e) => { setName(e.target.value); d.setDirty(true); }} />
        </label>
      ) : null}

      <div className="segmented" role="tablist" aria-label="Parts of the editor">
        {TABS.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-on" : undefined} onClick={() => setTab(t)}>
            {label}
            {t === "changes" && changes.length > 0 ? ` (${changes.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "questions" ? (
        <div className="editor-grid">
          <Outline base={base} ws={ws} selected={section} onSelect={setSection} push={push} />
          <div>{section ? <SectionEditor ws={ws} sectionKey={section} push={push} /> : null}</div>
        </div>
      ) : tab === "screens" ? (
        <ScreensPanel ws={ws} push={push} />
      ) : tab === "mystory" ? (
        <MyStoryPanel ws={ws} push={push} />
      ) : (
        <ChangesPanel
          changes={changes}
          next={next}
          edits={d.edits}
          level={d.level}
          setLevel={d.setLevel}
          onRemoveEdit={d.remove}
          check={() => api.previewSurveyDraft({ baseHash, edits: d.edits, ...(d.level ? { level: d.level } : {}) })}
          canPublish={canPublish && !readOnly}
          onPublish={async (notes) => {
            const draftId = d.dirty || !id ? await save() : id;
            const r = await api.publishSurveyVersion({ baseHash, edits: d.edits, notes, ...(d.level ? { level: d.level } : {}), ...(draftId ? { draftId } : {}) });
            d.setDirty(false);
            navigate(`/survey?published=${encodeURIComponent(r.version)}`);
          }}
        />
      )}
    </div>
  );
}
