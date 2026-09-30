import { definitionOf, type Component, type Edit, type Workspace } from "@myself-dashboard/core";
import { Icon } from "../../../components/Icon";

/**
 * The survey as an outline: its sections in order, each with its parts. Move,
 * leave out and restore sections and parts here; pick one to edit its
 * questions. What was left out stays listed, so it can come back.
 */

export const partName = (ws: Workspace, c: Component): string => {
  if (c.kind === "narrative") return `MyStory (${c.protocol})`;
  if (c.kind === "screen") return `The ${c.screen} screen`;
  return definitionOf(ws, c.ref)?.name ?? c.ref.instrument;
};

/** The same part of the survey, whatever has since changed about how it is shown. */
const samePart = (a: Component, b: Component): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "narrative" && b.kind === "narrative") return a.protocol === b.protocol;
  if (a.kind === "screen" && b.kind === "screen") return a.screen === b.screen;
  return (a as { ref: { instrument: string } }).ref.instrument === (b as { ref: { instrument: string } }).ref.instrument;
};

export function Outline({
  base,
  ws,
  selected,
  onSelect,
  push,
}: {
  base: Workspace;
  ws: Workspace;
  selected: string | null;
  onSelect: (section: string) => void;
  push: (e: Edit) => string | null;
}) {
  const sections = ws.draft.sections;
  const leftOut = base.draft.sections.filter((s) => !sections.some((x) => x.key === s.key));
  const act = (e: Edit) => {
    const problem = push(e);
    if (problem) window.alert(problem);
  };
  return (
    <nav className="outline" aria-label="Sections of the survey">
      <ol>
        {sections.map((s, i) => {
          const story = s.components.every((c) => c.kind === "narrative");
          const baseSection = base.draft.sections.find((b) => b.key === s.key);
          const outParts = (baseSection?.components ?? []).filter((c) => !s.components.some((x) => samePart(x, c)));
          return (
            <li key={s.key} className={selected === s.key ? "outline-section is-selected" : "outline-section"}>
              <div className="outline-row">
                <button type="button" className="outline-name" aria-current={selected === s.key} onClick={() => onSelect(s.key)}>
                  <span className="outline-num">{i + 1}</span> {s.title}
                </button>
                {story ? (
                  <span className="hint">always last</span>
                ) : (
                  <span className="outline-tools">
                    <button type="button" className="icon-btn" aria-label={`Move ${s.title} up`} disabled={i === 0} onClick={() => act({ op: "moveSection", section: s.key, to: i - 1 })}>
                      <Icon name="up" size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Move ${s.title} down`}
                      disabled={i >= sections.length - 1 || sections[i + 1]!.components.every((c) => c.kind === "narrative")}
                      onClick={() => act({ op: "moveSection", section: s.key, to: i + 1 })}
                    >
                      <Icon name="down" size={14} />
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Leave ${s.title} out`} onClick={() => act({ op: "removeSection", section: s.key })}>
                      <Icon name="trash" size={14} />
                    </button>
                  </span>
                )}
              </div>
              {selected === s.key && !story ? (
                <ol className="outline-parts">
                  {s.components.map((c, j) => (
                    <li key={j} className="outline-row">
                      <span>{partName(ws, c)}</span>
                      <span className="outline-tools">
                        <button type="button" className="icon-btn" aria-label={`Move ${partName(ws, c)} up`} disabled={j === 0} onClick={() => act({ op: "moveComponent", section: s.key, from: j, to: j - 1 })}>
                          <Icon name="up" size={14} />
                        </button>
                        <button type="button" className="icon-btn" aria-label={`Move ${partName(ws, c)} down`} disabled={j >= s.components.length - 1} onClick={() => act({ op: "moveComponent", section: s.key, from: j, to: j + 1 })}>
                          <Icon name="down" size={14} />
                        </button>
                        <button type="button" className="icon-btn" aria-label={`Leave ${partName(ws, c)} out`} onClick={() => act({ op: "removeComponent", section: s.key, index: j })}>
                          <Icon name="trash" size={14} />
                        </button>
                      </span>
                    </li>
                  ))}
                  {outParts.map((c, j) => (
                    <li key={`out-${j}`} className="outline-row is-out">
                      <span>{partName(base, c)} — left out</span>
                      <button type="button" className="btn btn-small btn-quiet" onClick={() => act({ op: "restoreComponent", section: s.key, component: c, at: s.components.length })}>
                        Restore
                      </button>
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ol>
      {leftOut.length > 0 ? (
        <div className="outline-out">
          <h3>Left out</h3>
          <ul>
            {leftOut.map((s) => (
              <li key={s.key} className="outline-row is-out">
                <span>{s.title}</span>
                <button type="button" className="btn btn-small btn-quiet" onClick={() => act({ op: "restoreSection", section: s.key, at: base.draft.sections.findIndex((b) => b.key === s.key) })}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}
