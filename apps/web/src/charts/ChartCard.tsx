import { useState, type ReactNode } from "react";
import { toCsv, type CsvValue } from "@myself-dashboard/core";
import { api } from "../lib/api";
import { Icon } from "../components/Icon";
import { useAuth } from "../app/auth";

/**
 * Every chart ships with its table twin (the WCAG-clean equivalent) and the same
 * rows as a CSV. Chart data is aggregate — no participant-level rows — so the
 * CSV is built here, formula-neutralised by the same writer the server uses, and
 * the download is recorded in the audit log.
 */
export interface ChartTable {
  columns: string[];
  rows: CsvValue[][];
}

export function ChartCard({
  id,
  title,
  description,
  table,
  children,
  footnote,
  dimmed = false,
  actions,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  table: ChartTable;
  children: ReactNode;
  footnote?: ReactNode;
  dimmed?: boolean;
  actions?: ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const { can } = useAuth();
  const download = () => {
    const blob = new Blob([toCsv(table.columns, table.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `myself_chart_${id}_created-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    void api.logChartDownload({ chart: id }).catch(() => undefined);
  };
  return (
    <figure className={`card chart-card ${dimmed ? "dimmed" : ""}`} aria-labelledby={`${id}-title`}>
      <div className="card-head">
        <div>
          <h3 id={`${id}-title`}>{title}</h3>
          {description ? <p className="card-desc">{description}</p> : null}
        </div>
        <div className="card-tools">
          {actions}
          <div className="segmented" role="group" aria-label={`${title}: view as`}>
            <button type="button" aria-pressed={view === "chart"} onClick={() => setView("chart")}>
              Chart
            </button>
            <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>
              Table
            </button>
          </div>
          {can("export.aggregate") ? (
            <button type="button" className="icon-btn" aria-label={`Download ${title} data as CSV`} title="Download data (CSV)" onClick={download} disabled={table.rows.length === 0}>
              <Icon name="download" />
            </button>
          ) : null}
        </div>
      </div>
      {view === "chart" ? (
        children
      ) : (
        <div className="table-wrap chart-table">
          <table className="data">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j} className={typeof v === "number" ? "num" : undefined}>
                      {v === null || v === undefined ? "—" : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {footnote ? <figcaption className="card-foot">{footnote}</figcaption> : null}
    </figure>
  );
}
