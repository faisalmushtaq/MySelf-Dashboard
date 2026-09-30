import type { Edit, Workspace } from "@myself-dashboard/core";
import { Committed } from "./Committed";

const SCREEN_NAMES: Record<string, string> = {
  finish: "The finish screen (after the last question, and after MyStory when there is one)",
  review: "The review screen (the summary before finishing)",
};

/** The survey's labels and fixed screens. */
export function ScreensPanel({ ws, push }: { ws: Workspace; push: (e: Edit) => string | null }) {
  const d = ws.draft;
  return (
    <div className="screens">
      <div className="card">
        <h2>Labels</h2>
        <Committed
          label="Label on the opening screen (participants see it; in practice the site and year)"
          value={d.studyLabel ?? ""}
          onCommit={(text) => push({ op: "setStudyLabel", text })}
        />
        <Committed label="Full title (researchers only: catalogues, exports, the audit)" value={d.title} onCommit={(text) => push({ op: "setTitle", text })} />
      </div>
      {Object.entries(d.screens).map(([key, screen]) => (
        <div className="card" key={key}>
          <h2>{SCREEN_NAMES[key] ?? `The ${key} screen`}</h2>
          <Committed label="Heading (optional)" value={screen.title?.text ?? ""} onCommit={(text) => push({ op: "setScreenText", screen: key, field: "title", text })} />
          <Committed label="Text" multiline rows={5} value={screen.body.text} onCommit={(text) => push({ op: "setScreenText", screen: key, field: "body", text })} />
          {screen.body.pipes && Object.keys(screen.body.pipes).length > 0 ? (
            <p className="hint">Keep the placeholders in braces — {Object.keys(screen.body.pipes).map((p) => `{${p}}`).join(", ")} — the survey fills them in.</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
