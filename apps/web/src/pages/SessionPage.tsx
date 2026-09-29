import { useParams, useNavigate } from "react-router-dom";
import { PAGE_SIZES } from "@myself-dashboard/core";
import { useFilters } from "../app/filters";
import { useSessionState, usePreference } from "../lib/hooks";
import { SessionDetail } from "../components/SessionDetail";

/**
 * A session on its own page. The list it came from travels in the URL (filters,
 * sort, page size), so Previous/Next follow that list, the URL can be shared, and
 * "Back to results" restores the list — page, sort, columns and scroll position.
 */
export default function SessionPage() {
  const { sessionId = "" } = useParams();
  const navigate = useNavigate();
  const { filters, sort, params } = useFilters();
  const [search] = useSessionState("sessions.search", "");
  const [prefSize] = usePreference<number>("sessions.pageSize", 50);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(Number(params.get("size"))) ? Number(params.get("size")) : prefSize;

  const listUrl = (page?: number | null) => {
    const p = new URLSearchParams(params);
    if (page && page > 1) p.set("page", String(page));
    else if (page === 1) p.delete("page");
    const s = p.toString();
    return `/sessions${s ? `?${s}` : ""}`;
  };

  return (
    <div className="page page-detail">
      <SessionDetail
        sessionId={sessionId}
        context={{ filters, sort, search, pageSize }}
        onNavigate={(id) => navigate(`/sessions/${encodeURIComponent(id)}?${params.toString()}`, { replace: false })}
        onBack={(page) => {
          // Return to the list page the CURRENT session sits on (it may differ from
          // where the researcher started after stepping through with Next), and
          // ask the list to focus that session's row.
          const url = listUrl(page ?? (Number(params.get("page") ?? "") || null));
          try {
            const key = `scroll:${url.slice("/sessions".length)}`;
            const prev = JSON.parse(sessionStorage.getItem(key) ?? "null") as { table: number; win: number } | null;
            sessionStorage.setItem(key, JSON.stringify({ table: prev?.table ?? 0, win: prev?.win ?? 0, focus: sessionId }));
          } catch {
            /* ignore */
          }
          navigate(url);
        }}
      />
    </div>
  );
}
