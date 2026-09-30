import type { Edit } from "@myself-dashboard/core";

const clip = (s: string, n = 50) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One edit, in words, for the draft's list of edits. */
export function describeEdit(e: Edit): string {
  switch (e.op) {
    case "setTitle":
      return `Title → “${clip(e.text)}”`;
    case "setStudyLabel":
      return `Opening-screen label → “${clip(e.text)}”`;
    case "setScreenText":
      return `The ${e.screen} screen's ${e.field}`;
    case "setSectionText":
      return `Section ${e.section}: ${e.field}`;
    case "moveSection":
      return `Moved section ${e.section} to position ${e.to + 1}`;
    case "removeSection":
      return `Left out section ${e.section}`;
    case "restoreSection":
      return `Restored section ${e.section}`;
    case "moveComponent":
      return `Moved a part of ${e.section}`;
    case "removeComponent":
      return `Left out a part of ${e.section}`;
    case "restoreComponent":
      return `Restored a part of ${e.section}`;
    case "setQuestionText":
      return `${e.question}: ${e.field === "stem" ? "wording" : e.field === "lede" ? "text under it" : "hint"}`;
    case "setRequired":
      return `${e.question}: ${e.required}`;
    case "setOptionLabel":
      return `${e.scale}: option ${e.code} → “${clip(e.label)}”`;
    case "addOption":
      return `${e.scale}: added “${clip(e.label)}”`;
    case "removeQuestion":
      return `Removed ${e.question}`;
    case "addQuestion":
      return `Added ${e.instrument}.${e.question.key}`;
    case "setShowIf":
      return `${e.question}: who is asked it`;
    case "setMyStory":
      return e.protocol ? `MyStory: ${e.protocol.key}@${e.protocol.version}` : "MyStory removed";
    case "putProtocol":
      return `Protocol ${String(e.protocol["key"])}@${String(e.protocol["version"])} made available`;
  }
}
