import { useMemo, useState } from "react";
import {
  builtInProtocols,
  checkProtocol,
  myStoryOf,
  parseProtocolFile,
  protocolToToml,
  type Edit,
  type NarrativeProtocol,
  type Workspace,
} from "@myself-dashboard/core";
import { Notice } from "../../../components/States";

/**
 * MyStory for this version: on or off, which protocol, and the protocol itself.
 *
 * It always comes last — the survey, then MyStory, then the finish screen and
 * the hand-back to the researcher — so there is nothing to place. The
 * protocol is the same TOML file the MyStory lab and the survey's protocol
 * editor read and write, checked here on every keystroke with the survey's own
 * rules; the survey's publish checks run on it again when the version is
 * published. Only an approved protocol can be fielded.
 */
/**
 * A protocol as its TOML file, or null for one the file format cannot express
 * (a protocol defined in the survey's code with its own stages): writing one
 * would quietly lose those stages, so it is offered to use as it is.
 */
function tomlOf(p: NarrativeProtocol | undefined): string | null {
  if (!p) return null;
  try {
    return protocolToToml(p);
  } catch {
    return null;
  }
}

export function MyStoryPanel({ ws, push }: { ws: Workspace; push: (e: Edit | Edit[]) => string | null }) {
  const current = myStoryOf(ws);
  const available = useMemo(() => {
    const byId = new Map<string, NarrativeProtocol>();
    for (const p of builtInProtocols) byId.set(`${p.key}@${p.version}`, p);
    for (const [id, p] of Object.entries(ws.narrativeProtocols)) byId.set(id, p as unknown as NarrativeProtocol);
    return [...byId.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [ws.narrativeProtocols]);
  // Start from the protocol in use, else the first one that can be edited as a file.
  const [chosen, setChosen] = useState<string>(
    current ? `${current.key}@${current.version}` : ((available.find(([, p]) => tomlOf(p) !== null) ?? available[0])?.[0] ?? ""),
  );
  const protocol = available.find(([id]) => id === chosen)?.[1];
  const [toml, setToml] = useState<string>(() => tomlOf(protocol) ?? "");
  const editableAsFile = tomlOf(protocol) !== null;
  const [problem, setProblem] = useState<string | null>(null);

  const parsed = useMemo((): {
    protocol?: NarrativeProtocol;
    errors: string[];
  } => {
    if (!toml.trim()) return { errors: ["The file is empty."] };
    try {
      const p = parseProtocolFile(toml, "protocol.toml");
      return { protocol: p, errors: checkProtocol(p) };
    } catch (e) {
      return { errors: [(e as Error).message] };
    }
  }, [toml]);

  const choose = (id: string) => {
    setChosen(id);
    const p = available.find(([x]) => x === id)?.[1];
    setToml(tomlOf(p) ?? "");
    setProblem(null);
  };

  const use = (p: NarrativeProtocol) => {
    const id = `${p.key}@${p.version}`;
    const setOn: Edit = { op: "setMyStory", protocol: { key: p.key, version: p.version } };
    const problem = push(ws.narrativeProtocols[id] ? setOn : [{ op: "putProtocol", protocol: p as unknown as Record<string, unknown> }, setOn]);
    setProblem(problem);
    if (!problem) setChosen(id);
  };

  return (
    <div className="mystory">
      <div className="card">
        <h2>MyStory in this version</h2>
        <p>
          {current ? (
            <>
              This version ends with MyStory, using{" "}
              <strong>
                {current.key}@{current.version}
              </strong>
              . The order on the iPad: the survey, then MyStory, then the finish screen, then the hand-back to the researcher.
            </>
          ) : (
            "This version does not include MyStory: the survey goes straight to its finish screen and the hand-back."
          )}
        </p>
        {current ? (
          <button type="button" className="btn" onClick={() => setProblem(push({ op: "setMyStory", protocol: null }))}>
            Remove MyStory from this version
          </button>
        ) : null}
      </div>

      <div className="card">
        <h2>Protocol</h2>
        <label>
          Start from
          <select value={chosen} onChange={(e) => choose(e.target.value)}>
            {available.map(([id, p]) => (
              <option key={id} value={id}>
                {p.name ?? p.key} — {id} ({p.approvalStatus})
              </option>
            ))}
          </select>
        </label>
        {!editableAsFile && protocol ? (
          <>
            <p>
              {protocol.name} is defined in the survey's code with stages a protocol file cannot express, so it cannot be edited here — only used as it is. Its
              approval status is “{protocol.approvalStatus}”
              {protocol.approvalStatus === "approved" ? "." : ": publishing will refuse it until it is approved in the survey's code."}
            </p>
            {problem ? <Notice tone="warn">{problem}</Notice> : null}
            <div className="button-row">
              <button type="button" className="btn btn-primary" onClick={() => use(protocol)}>
                {current ? "Use this protocol instead" : "End this version with MyStory, using this protocol"}
              </button>
            </div>
          </>
        ) : (
          <>
            <label>
              <span>
                The protocol file (TOML) — edit it here. If you change a published protocol, change its <code>version</code> in <code>[myself]</code> too.
              </span>
              <textarea className="code" rows={22} spellCheck={false} value={toml} onChange={(e) => setToml(e.target.value)} />
            </label>
            {parsed.errors.length > 0 ? (
              <Notice tone="warn">
                <strong>{parsed.protocol ? "The protocol reads, but its checks fail:" : "The file does not read as a protocol:"}</strong>
                <ul>
                  {parsed.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </Notice>
            ) : parsed.protocol ? (
              <p className="hint">
                {parsed.protocol.key}@{parsed.protocol.version} reads and passes its checks.{" "}
                {parsed.protocol.approvalStatus === "approved"
                  ? "It is approved for fielding."
                  : `Its approval status is “${parsed.protocol.approvalStatus}”: set approval_status = "approved" in [myself] once it has been approved, or publishing will refuse it.`}
              </p>
            ) : null}
            {problem ? <Notice tone="warn">{problem}</Notice> : null}
            <div className="button-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!parsed.protocol || parsed.errors.length > 0}
                onClick={() => parsed.protocol && use(parsed.protocol)}
              >
                {current ? "Use this protocol instead" : "End this version with MyStory, using this protocol"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
