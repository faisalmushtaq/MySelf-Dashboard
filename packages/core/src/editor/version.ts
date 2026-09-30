import type { Change } from "./diff.js";

/**
 * The next version number, from what changed (survey docs/06 §3).
 *
 * MAJOR — anything a participant could read, choose or be routed through
 *         differently. Wording is never a PATCH, however small: a one-letter
 *         fix is MAJOR on the form it touches (the SDQ "Clearly/Certainly
 *         true" lesson).
 * MINOR — additions that leave every existing path and every existing
 *         variable's meaning alone. Nothing the editor can do today is one of
 *         those (every addition it offers is something a participant sees);
 *         the level exists so an owner can choose it deliberately, never by
 *         default.
 * PATCH — researcher-facing metadata only.
 *
 * An owner may raise the level the editor chose, never lower it: lowering it
 * is how two versions that cannot be pooled end up looking as if they can.
 */

export type Level = "major" | "minor" | "patch";
const ORDER: Level[] = ["patch", "minor", "major"];

export interface NextVersion {
  version: string;
  level: Level;
  /** The level the changes require, before any owner raised it. */
  required: Level;
  reasons: string[];
}

export function requiredLevel(changes: readonly Change[]): { level: Level; reasons: string[] } {
  const visible = changes.filter((c) => c.participantVisible);
  if (visible.length > 0) {
    return { level: "major", reasons: [`${visible.length} change${visible.length === 1 ? "" : "s"} a participant could see or be routed by, e.g. ${visible[0]!.summary}`] };
  }
  if (changes.length > 0) return { level: "patch", reasons: ["only researcher-facing details changed"] };
  return { level: "patch", reasons: ["nothing changed"] };
}

/**
 * `from` is the highest version already published, not necessarily the one the
 * draft started from: a draft begun from r9.0.0 after r10.0.0 went out becomes
 * r11.0.0, so no two versions ever share a number.
 */
export function nextVersion(from: string, changes: readonly Change[], chosen?: Level): NextVersion {
  const { level: required, reasons } = requiredLevel(changes);
  const level = chosen && ORDER.indexOf(chosen) > ORDER.indexOf(required) ? chosen : required;
  const [major = 0, minor = 0, patch = 0] = from.split(".").map(Number);
  const version = level === "major" ? `${major + 1}.0.0` : level === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  return { version, level, required, reasons: chosen && level !== required ? [...reasons, `raised to ${level} by the publisher`] : reasons };
}
