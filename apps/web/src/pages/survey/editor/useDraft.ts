import { useCallback, useMemo, useState } from "react";
import { applyEdits, diffWorkspaces, nextVersion, type Edit, type Level, type Workspace } from "@myself-dashboard/core";

/**
 * A draft in the browser: its base, its edits, and everything that follows
 * from them — the working copy, the change list and the version number —
 * recomputed on every change with the same code the server uses, so what the
 * page shows is what a publish would do. The server still rebuilds and runs
 * the publish checks itself; nothing here is trusted by it.
 */

/** Two edits to the same thing in a row are one edit: typing a word is not twenty changes. */
function sameTarget(a: Edit, b: Edit): boolean {
  if (a.op !== b.op) return false;
  const key = (e: Edit): string | null => {
    switch (e.op) {
      case "setTitle":
      case "setStudyLabel":
        return e.op;
      case "setScreenText":
        return `${e.screen}/${e.field}`;
      case "setSectionText":
        return `${e.section}/${e.field}`;
      case "setQuestionText":
        return `${e.question}/${e.field}`;
      case "setRequired":
      case "setShowIf":
        return e.question;
      case "setOptionLabel":
        return `${e.scale}/${e.code}`;
      case "setMyStory":
        return "mystory";
      default:
        return null;
    }
  };
  const k = key(a);
  return k !== null && k === key(b);
}

export function useDraft(base: Workspace | null, initial: Edit[], highest: string) {
  const [edits, setEdits] = useState<Edit[]>(initial);
  const [level, setLevel] = useState<Level | undefined>(undefined);
  const [dirty, setDirty] = useState(false);

  const derived = useMemo(() => {
    if (!base) return null;
    const { workspace, failed } = applyEdits(base, edits);
    const changes = diffWorkspaces(base, workspace);
    return { workspace, failed: failed ?? null, changes, next: nextVersion(highest, changes, level) };
  }, [base, edits, highest, level]);

  /** Add an edit — refused on the spot if it cannot apply, with the reason. */
  const push = useCallback(
    (edit: Edit): string | null => {
      if (!base || !derived) return "The draft is still loading.";
      const last = edits.at(-1);
      const nextEdits = last && sameTarget(last, edit) ? [...edits.slice(0, -1), edit] : [...edits, edit];
      const check = applyEdits(base, nextEdits);
      if (check.failed) return check.failed.message;
      setEdits(nextEdits);
      setDirty(true);
      return null;
    },
    [base, derived, edits],
  );

  const remove = useCallback((index: number) => {
    setEdits((e) => e.filter((_, i) => i !== index));
    setDirty(true);
  }, []);

  return { edits, setEdits, push, remove, level, setLevel, dirty, setDirty, derived };
}
