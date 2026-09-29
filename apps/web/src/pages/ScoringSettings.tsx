import { useState } from "react";
import { Link } from "react-router-dom";
import type { ScoringSettingsView } from "@myself-dashboard/core";
import { api } from "../lib/api";
import { useLoad } from "../lib/hooks";
import { PageHeader } from "../components/Metric";
import { ErrorState, Loading, Notice } from "../components/States";
import { Icon } from "../components/Icon";
import { SchemeList } from "./scoring-settings/SchemeList";
import { SchemeEditor } from "./scoring-settings/SchemeEditor";
import { GroupsCard } from "./scoring-settings/GroupsCard";

/**
 * Scoring settings: how each instrument is scored, what its bands and
 * benchmarks are, and how sittings are grouped into schools and year groups.
 * Everyone can read it — a score is only as good as its definition — and
 * administrators change it. Every change is a new, kept version, with a reason;
 * nothing is overwritten.
 */

export default function ScoringSettings() {
  const settings = useLoad<ScoringSettingsView>(() => api.getScoringSettings({}), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const data = settings.data;
  const current = data?.schemes.find((s) => s.scheme.key === selected) ?? null;
  return (
    <div className="page">
      <PageHeader
        title="Scoring"
        description="How each instrument is scored, the bands and benchmarks its scores are read against, and how sittings are grouped into schools and year groups. Every change is kept as a new version with who made it and why."
        actions={
          <Link className="btn btn-quiet" to="/scores">
            <Icon name="scores" size={16} /> Scores
          </Link>
        }
      />
      {settings.error ? <ErrorState message={settings.error.message} onRetry={() => void settings.reload()} /> : null}
      {!data && !settings.error ? <Loading /> : null}
      {data ? (
        <>
          {!data.canEdit ? <Notice>Read-only: scoring is changed by dashboard administrators.</Notice> : null}
          <SchemeList
            data={data}
            selected={selected}
            onSelect={(k) => {
              setSelected(k);
              setSaved(null);
            }}
          />
          {saved ? (
            <div role="status">
              <Notice>{saved}</Notice>
            </div>
          ) : null}
          {current ? (
            <SchemeEditor
              key={`${current.scheme.key}@${current.scheme.version}`}
              entry={current}
              data={data}
              onSaved={(text) => {
                setSaved(text);
                void settings.reload();
              }}
              onClose={() => {
                setSelected(null);
                setSaved(null);
              }}
            />
          ) : null}
          <GroupsCard data={data} onSaved={() => void settings.reload()} />
        </>
      ) : null}
    </div>
  );
}
