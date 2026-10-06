/**
 * The study the dashboard is working in (docs/12 §12.7): chosen in the header,
 * remembered for the person on the server, and named in every call and every
 * direct read, so nothing is ever asked of one study while another is on screen.
 *
 * Set from `whoAmI`'s answer (app/auth.tsx). Before that answer there is none,
 * and the first `whoAmI` names no study: the server picks the one last chosen.
 */
let current: string | null = null;

export function currentStudy(): string | null {
  return current;
}

export function setCurrentStudy(study: string): void {
  current = study;
}

/** A path under the current study in the dashboard's database. */
export function studyPath(rest: string): string {
  if (!current) throw new Error("No study has been chosen yet.");
  return `studies/${current}/${rest}`;
}
