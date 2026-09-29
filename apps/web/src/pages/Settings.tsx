import { useEffect, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Policy, type SettingsResponse } from "@myself-dashboard/core";
import { api, explain } from "../lib/api";
import { dateTime, relative } from "../lib/format";
import { usePreference } from "../lib/hooks";
import { useAuth } from "../app/auth";
import { useAnnounce } from "../app/announcer";
import { PageHeader } from "../components/Metric";
import { ErrorState, Loading, Notice } from "../components/States";
import { Icon } from "../components/Icon";

/**
 * Settings. Everyone gets their display preferences; administrators also manage
 * who has access, what the numbers mean, the survey-version registry and data
 * maintenance. Every administrative change is audited on the server.
 */
export default function Settings() {
  const { can } = useAuth();
  return (
    <div className="page">
      <PageHeader title="Settings" />
      <Preferences />
      <section className="card">
        <h2>Scoring, schools and year groups</h2>
        <p className="hint">How each instrument is scored, its threshold bands and benchmarks, school names and where year groups come from.</p>
        <Link className="btn" to="/settings/scoring">
          Open scoring settings <Icon name="chevronRight" size={14} />
        </Link>
      </section>
      {can("settings.access") ? <Admin /> : <p className="hint">Access, study settings and survey versions are managed by dashboard administrators.</p>}
    </div>
  );
}

function Preferences() {
  const [density, setDensity] = usePreference<"comfortable" | "compact">("sessions.density", "comfortable");
  const [size, setSize] = usePreference<number>("sessions.pageSize", 50);
  return (
    <section className="card">
      <h2>Display preferences</h2>
      <p className="hint">Stored in this browser only.</p>
      <div className="field-row">
        <label>
          Table density
          <select value={density} onChange={(e) => setDensity(e.target.value as "comfortable" | "compact")}>
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <label>
          Sessions per page
          <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function Admin() {
  const announce = useAnnounce();
  const { me } = useAuth();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emails, setEmails] = useState("");
  const [domains, setDomains] = useState("");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantRole, setGrantRole] = useState("researcher");
  const [msg, setMsg] = useState<{ tone: "info" | "warn"; text: string } | null>(null);

  const load = async () => {
    try {
      const s = await api.getSettings({});
      setData(s);
      setEmails(s.access.emails.join("\n"));
      setDomains(s.access.domains.join("\n"));
      setPolicy(s.policy);
      setError(null);
    } catch (e) {
      setError(explain(e).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setMsg(null);
    try {
      const text = await fn();
      setMsg({ tone: "info", text });
      announce(text, "success");
      await load();
    } catch (e) {
      const m = explain(e).message;
      setMsg({ tone: "warn", text: m });
      announce(m, "error");
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorState title="Settings could not be loaded" message={error} onRetry={() => void load()} />;
  if (!data || !policy) return <Loading label="Loading settings" />;

  const lines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const onManifest = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const text = await f.text();
    let manifest: unknown;
    try {
      manifest = JSON.parse(text);
    } catch {
      setMsg({ tone: "warn", text: "That file is not JSON." });
      return;
    }
    await run("release", async () => {
      const r = await api.registerReleaseManifest({ manifest });
      return `Registered survey version ${r.version}. Sessions that arrived before it can be re-summarised under Data maintenance.`;
    });
  };

  return (
    <>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <section className="card">
        <h2>Access</h2>
        <p>
          A person can use the dashboard only if their Google account's email is listed here (or belongs to a listed Google Workspace domain) <strong>and</strong> they
          hold a role. Both are checked on every request and by the database's security rules.
        </p>
        <div className="field-row">
          <label className="grow">
            Approved accounts (one per line)
            <textarea rows={4} value={emails} onChange={(e) => setEmails(e.target.value)} spellCheck={false} />
          </label>
          <label className="grow">
            Approved Google Workspace domains
            <textarea rows={4} value={domains} onChange={(e) => setDomains(e.target.value)} spellCheck={false} placeholder="e.g. brainpop.example" />
          </label>
        </div>
        <p className="hint">Only list a domain your organisation manages in Google Workspace: anyone with a Google account at that domain could otherwise qualify.</p>
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => void run("access", async () => {
            await api.updateAccessPolicy({ emails: lines(emails), domains: lines(domains) });
            return "Access list saved.";
          })}
        >
          Save access list
        </button>

        <h3>People and roles</h3>
        <dl className="defs">
          {ROLES.map((r) => (
            <div key={r}>
              <dt>{ROLE_LABELS[r]}</dt>
              <dd>{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
        <form
          className="field-row"
          onSubmit={(e) => {
            e.preventDefault();
            void run("grant", async () => {
              const r = await api.setDashboardRole({ email: grantEmail.trim(), role: grantRole });
              setGrantEmail("");
              return `${r.email} is now a ${ROLE_LABELS[r.role as keyof typeof ROLE_LABELS]}. The change applies within a minute.`;
            });
          }}
        >
          <label className="grow">
            Email (must have signed in once)
            <input type="email" value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} required />
          </label>
          <label>
            Role
            <select value={grantRole} onChange={(e) => setGrantRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn" disabled={busy !== null}>
            Grant role
          </button>
        </form>
        <div className="table-scroll">
          <table className="data">
            <caption className="sr-only">People who have signed in</caption>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">On access list</th>
                <th scope="col">Role</th>
                <th scope="col">Last sign-in</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.uid}>
                  <td>
                    {p.email}
                    {p.disabled ? <span className="tag tag-warn">disabled</span> : null}
                  </td>
                  <td>{p.allowed ? "Yes" : <span className="muted">No</span>}</td>
                  <td>{p.role ? ROLE_LABELS[p.role] : <span className="muted">None</span>}</td>
                  <td>{p.lastSignIn ? relative(p.lastSignIn) : "—"}</td>
                  <td>
                    {p.role && p.uid !== me?.uid ? (
                      <button
                        type="button"
                        className="btn btn-small btn-quiet"
                        disabled={busy !== null}
                        onClick={() => {
                          if (!window.confirm(`Remove ${p.email}'s dashboard role? They will lose access within a minute.`)) return;
                          void run("revoke", async () => {
                            await api.setDashboardRole({ email: p.email!, role: null });
                            return `${p.email}'s role was removed.`;
                          });
                        }}
                      >
                        Remove role
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Study settings</h2>
        <p className="hint">These change what the numbers mean. Changes are audited; changing the required levels needs a summary rebuild to take effect.</p>
        <div className="settings-grid">
          <fieldset className="check-list">
            <legend>Required levels counted in completeness</legend>
            {(["hard", "soft", "optional"] as const).map((l) => (
              <label key={l}>
                <input
                  type="checkbox"
                  checked={policy.requiredLevels.includes(l)}
                  onChange={() => setPolicy({ ...policy, requiredLevels: policy.requiredLevels.includes(l) ? policy.requiredLevels.filter((x) => x !== l) : [...policy.requiredLevels, l] })}
                />
                {l}
              </label>
            ))}
          </fieldset>
          <label>
            Abandoned after (hours without contact)
            <input type="number" min={1} max={1440} value={policy.abandonAfterHours} onChange={(e) => setPolicy({ ...policy, abandonAfterHours: Number(e.target.value) })} />
          </label>
          <label>
            Test study-code patterns (one regular expression per line)
            <textarea rows={3} value={policy.testCodePatterns.join("\n")} onChange={(e) => setPolicy({ ...policy, testCodePatterns: lines(e.target.value) })} spellCheck={false} />
          </label>
          <label className="check">
            <input type="checkbox" checked={policy.reviewerCanViewFreeText} onChange={(e) => setPolicy({ ...policy, reviewerCanViewFreeText: e.target.checked })} />
            Read-only reviewers may read free-text answers
          </label>
          <label>
            Keep exports for (hours)
            <input type="number" min={1} max={336} value={policy.exportRetentionHours} onChange={(e) => setPolicy({ ...policy, exportRetentionHours: Number(e.target.value) })} />
          </label>
          <label>
            Study time zone
            <input type="text" value={policy.timeZone} onChange={(e) => setPolicy({ ...policy, timeZone: e.target.value })} />
          </label>
          <label>
            Too-fast answers that raise a review signal
            <input type="number" min={1} value={policy.tooFastWarningCount} onChange={(e) => setPolicy({ ...policy, tooFastWarningCount: Number(e.target.value) })} />
          </label>
          <label>
            Active survey version
            <select value={policy.activeReleaseHash ?? ""} onChange={(e) => setPolicy({ ...policy, activeReleaseHash: e.target.value || null })}>
              <option value="">Newest registered version</option>
              {data.releases.map((r) => (
                <option key={r.hash} value={r.hash}>
                  v{r.version}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy !== null || policy.requiredLevels.length === 0}
          onClick={() => void run("policy", async () => {
            const r = await api.updatePolicy(policy);
            return r.rebuildRecommended ? "Settings saved. Rebuild the summaries (below) for the new required levels to apply." : "Settings saved.";
          })}
        >
          Save study settings
        </button>
      </section>

      <section className="card">
        <h2>Survey versions</h2>
        <p className="hint">Each registered release is verified against its content hash; the dashboard reads every session through the version it was collected under.</p>
        <ul className="release-list">
          {data.releases.map((r) => (
            <li key={r.hash}>
              <strong>v{r.version}</strong> <code>{r.key}</code> · published {dateTime(r.publishedAt)} · {r.questionCount} questions · <code title={r.hash}>{r.hash.slice(0, 19)}…</code>
            </li>
          ))}
        </ul>
        <label className="file-btn btn">
          <Icon name="plus" size={16} /> Register a release manifest (JSON)
          <input type="file" accept="application/json,.json" onChange={(e) => void onManifest(e)} className="sr-only" />
        </label>
      </section>

      <section className="card">
        <h2>Data maintenance</h2>
        <p>Re-read the survey's sessions and rebuild the dashboard's summaries. Read-only against participant data; safe to repeat.</p>
        <div className="button-row">
          <button type="button" className="btn" disabled={busy !== null} onClick={() => void run("rebuild-unknown", async () => {
            const r = await api.rebuildSummaries({ onlyUnknownRelease: true });
            return `Checked ${r.scanned} sessions; re-summarised ${r.written}.`;
          })}>
            Re-summarise sessions with unknown versions
          </button>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => {
            if (!window.confirm("Rebuild every summary? This reads every session and can take a few minutes.")) return;
            void run("rebuild", async () => {
              const r = await api.rebuildSummaries({});
              return `Rebuilt ${r.written} summaries${r.unreadable ? ` (${r.unreadable} unreadable)` : ""}.`;
            });
          }}>
            Rebuild all summaries
          </button>
          {busy?.startsWith("rebuild") ? <Loading label="Rebuilding" /> : null}
        </div>
      </section>
    </>
  );
}
