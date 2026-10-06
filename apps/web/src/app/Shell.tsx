import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { ROLE_LABELS, type Capability } from "@myself-dashboard/core";
import { Icon, type IconName } from "../components/Icon";
import { Popover } from "../components/Popover";
import { Dialog } from "../components/Dialog";
import { useAuth } from "./auth";
import { useStudyData } from "./data";
import { filterQuery, surveyQuery } from "./filters";
import { DateRangeControl, SurveyControl, VersionControl } from "./FilterControls";
import { HelpContent } from "../pages/Help";
import { firebase } from "../lib/firebase";
import { explain } from "../lib/api";
import { refreshAll, useOnline, useSessionState } from "../lib/hooks";
import { relative } from "../lib/format";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  capability?: Capability;
  /** Follows every global filter: the date, survey and version controls show, and the filters carry over. */
  filtered?: boolean;
  /** Follows the survey filter alone (docs/12 §12.6). */
  surveyed?: boolean;
}

const NAV: NavItem[] = [
  { to: "/overview", label: "Overview", icon: "overview", filtered: true },
  { to: "/sessions", label: "Sessions", icon: "sessions", filtered: true },
  { to: "/completeness", label: "Completeness", icon: "completeness", filtered: true },
  { to: "/questions", label: "Questions", icon: "questions", filtered: true },
  { to: "/codebook", label: "Codebook", icon: "book", surveyed: true },
  { to: "/scores", label: "Scores", icon: "scores", filtered: true },
  { to: "/figures", label: "Figures", icon: "figure", filtered: true },
  { to: "/participants", label: "Participants", icon: "people", surveyed: true },
  { to: "/survey", label: "Survey versions", icon: "note", capability: "survey.versions", surveyed: true },
  { to: "/reports", label: "Reports and exports", icon: "reports", capability: "export.aggregate" },
  { to: "/views", label: "Saved views", icon: "views", capability: "views.private" },
  { to: "/audit", label: "Audit activity", icon: "audit", capability: "audit.readOwn" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

/** Minutes after which the "data last refreshed" marker is called stale. */
const STALE_MINUTES = 24 * 60;

/**
 * The study switcher (docs/12 §12.7): the studies this person may see, as the
 * server listed them. Shown only when there is more than one. Choosing one
 * asks the server, which remembers it, and opens that study's Overview.
 */
function StudySwitcher() {
  const { me, switchStudy } = useAuth();
  const { study, studies } = useStudyData();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!me || studies.length < 2) return null;
  const choose = async (next: string) => {
    if (next === study.study) return;
    setBusy(true);
    setProblem(null);
    try {
      await switchStudy(next, () => navigate("/overview"));
    } catch (e) {
      setProblem(explain(e).message);
      setBusy(false);
    }
  };
  return (
    <label className="study-ctl" title={problem ?? "The study you are working in"}>
      <Icon name="layers" size={16} />
      <span className="ctl-caption" aria-hidden="true">
        Study
      </span>
      <select value={study.study} onChange={(e) => void choose(e.target.value)} disabled={busy} aria-label="Study" aria-invalid={problem ? true : undefined}>
        {studies.map((s) => (
          <option key={s.study} value={s.study}>
            {s.title}
            {s.status === "closed" ? " (closed)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Shell() {
  const { me, can, signOut } = useAuth();
  const { lastSummaryAt, freshnessError, study } = useStudyData();
  const online = useOnline();
  const location = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [help, setHelp] = useState(false);
  const [notes, setNotes] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [search, setSearch] = useSessionState("sessions.search", "");
  const [draft, setDraft] = useState(search);
  const [readyExports, setReadyExports] = useState<{ id: string; fileName: string }[]>([]);
  const [, tick] = useState(0);

  // The top bar wraps onto a second row on narrower screens; sticky panels sit below its real height.
  const topbar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = topbar.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-h", `${Math.ceil(el.getBoundingClientRect().height)}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setDraft(search), [search]);
  useEffect(() => setNavOpen(false), [location.pathname]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // Exports finished for this person: a notification until downloaded or expired.
  useEffect(() => {
    if (!me?.uid) return;
    const q = query(collection(firebase().db, `studies/${me.study}/exportJobs`), where("requestedBy", "==", me.uid), orderBy("createdAt", "desc"), limit(10));
    return onSnapshot(
      q,
      (snap) => {
        let seen: string[] = [];
        try {
          seen = JSON.parse(localStorage.getItem("exports.downloaded") ?? "[]") as string[];
        } catch {
          seen = [];
        }
        setReadyExports(snap.docs.filter((d) => d.data()["status"] === "ready" && !seen.includes(d.id)).map((d) => ({ id: d.id, fileName: String(d.data()["fileName"]) })));
      },
      () => setReadyExports([]),
    );
  }, [me?.uid, me?.study]);

  const here = NAV.find((n) => location.pathname.startsWith(n.to));
  const filterScoped = here?.filtered ?? location.pathname.startsWith("/sessions");
  const surveyScoped = here?.surveyed === true;
  const carry = filterQuery(params);
  const carrySurvey = surveyQuery(params);
  const stale = lastSummaryAt ? (Date.now() - Date.parse(lastSummaryAt)) / 60_000 > STALE_MINUTES : false;
  const noticeCount = readyExports.length + (online ? 0 : 1) + (freshnessError ? 1 : 0);

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setSearch(draft.trim());
    navigate(`/sessions${carry}`);
  };

  if (!me) return null;
  return (
    <div className={`shell ${navOpen ? "nav-open" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Primary">
        <Link to={`/overview${carry}`} className="brand">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span>
            <strong>MySelf</strong>
            <span className="brand-sub">Research Dashboard</span>
          </span>
        </Link>
        <nav>
          <ul>
            {NAV.filter((n) => !n.capability || can(n.capability)).map((n) => (
              <li key={n.to}>
                <NavLink to={`${n.to}${n.filtered ? carry : n.surveyed ? carrySurvey : ""}`} className={({ isActive }) => (isActive ? "active" : "")}>
                  <Icon name={n.icon} />
                  <span>{n.to === "/audit" && !can("audit.readAll") ? "My activity" : n.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-foot">
          <span className="study-tag" title={study.study}>
            Study: {study.title}
            {study.status === "closed" ? " (closed)" : ""}
          </span>
        </div>
      </aside>

      <header className="topbar" ref={topbar}>
        <button type="button" className="icon-btn nav-toggle" aria-label="Menu" aria-expanded={navOpen} onClick={() => setNavOpen((o) => !o)}>
          <Icon name="menu" />
        </button>
        <StudySwitcher />
        <form role="search" className="global-search" onSubmit={submitSearch}>
          <label htmlFor="global-search" className="sr-only">
            Search sessions by session ID{can("view.studyCode") ? " or study code" : ""}
          </label>
          <Icon name="search" size={16} />
          <input
            id="global-search"
            type="search"
            placeholder={can("view.studyCode") ? "Session ID or study code" : "Session ID"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </form>
        {filterScoped ? (
          <div className="global-controls">
            <DateRangeControl />
            <SurveyControl />
            <VersionControl />
          </div>
        ) : surveyScoped ? (
          <div className="global-controls">
            <SurveyControl />
          </div>
        ) : (
          <div className="global-controls" />
        )}
        <div className="topbar-right">
          <div className={`freshness ${!online ? "offline" : stale ? "stale" : ""}`} title="When the dashboard's summaries were last updated from the survey data">
            {!online ? (
              <>
                <Icon name="wifiOff" size={16} /> Offline
              </>
            ) : (
              <>
                <span className="fresh-dot" aria-hidden="true" />
                <span>
                  Data updated <strong>{lastSummaryAt ? relative(lastSummaryAt) : "—"}</strong>
                  {stale ? " (stale)" : ""}
                </span>
              </>
            )}
            <button type="button" className="icon-btn" aria-label="Refresh data" title="Refresh data" onClick={refreshAll}>
              <Icon name="refresh" size={16} />
            </button>
          </div>
          <button type="button" className="icon-btn with-badge" aria-label={`Notifications${noticeCount ? ` (${noticeCount})` : ""}`} onClick={() => setNotes(true)}>
            <Icon name="bell" />
            {noticeCount ? <span className="count-badge" aria-hidden="true">{noticeCount}</span> : null}
          </button>
          <button type="button" className="icon-btn" aria-label="Help" onClick={() => setHelp(true)}>
            <Icon name="help" />
          </button>
          <Popover
            label="Account"
            align="right"
            className="user-menu"
            button={
              <>
                <Icon name="user" />
                <span className="user-email">{me.email}</span>
              </>
            }
          >
            {() => (
              <div className="account">
                <p>
                  <strong>{me.email}</strong>
                  <br />
                  {me.role ? ROLE_LABELS[me.role] : ""}
                </p>
                <button type="button" className="btn" onClick={() => void signOut("You have signed out.")}>
                  <Icon name="signout" size={16} /> Sign out
                </button>
              </div>
            )}
          </Popover>
        </div>
      </header>

      {!online ? (
        <div className="banner banner-warn" role="status">
          <Icon name="wifiOff" size={16} /> You are offline. What is on screen may be out of date; the dashboard will reload when the connection returns.
        </div>
      ) : stale ? (
        <div className="banner" role="status">
          <Icon name="clock" size={16} /> No new survey data has been summarised for over a day. That is normal between fieldwork days; if sittings were collected, check they have synced.
        </div>
      ) : null}

      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>

      <Dialog open={help} onClose={() => setHelp(false)} title="Help and definitions" wide>
        <HelpContent />
      </Dialog>
      <Dialog open={notes} onClose={() => setNotes(false)} title="Notifications">
        <ul className="notices">
          {!online ? <li>You are offline.</li> : null}
          {freshnessError ? <li>The data-freshness marker could not be read. Numbers may be out of date.</li> : null}
          {readyExports.map((x) => (
            <li key={x.id}>
              Export ready: <Link to="/reports" onClick={() => setNotes(false)}>{x.fileName}</Link>
            </li>
          ))}
          <li>
            <Link to={`/sessions?st=needs_review`} onClick={() => setNotes(false)}>
              Open the sessions that need review
            </Link>
          </li>
          {noticeCount === 0 ? <li className="muted-note">Nothing new.</li> : null}
        </ul>
      </Dialog>
    </div>
  );
}
