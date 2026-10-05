/**
 * Dashboard roles and what each may do.
 *
 * The dashboard reuses the survey's existing `role` custom claim so a person has
 * one role across the platform (docs/02 §2.2, assumption A1):
 *
 *   owner      → Administrator
 *   researcher → Researcher
 *   analyst    → Read-only reviewer
 *
 * One table, read by the backend (authorisation), the web app (what to show) and
 * the tests. The interface hiding a button is a courtesy; the backend and the
 * rules are the control.
 */
export const ROLES = ["owner", "researcher", "analyst"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Administrator",
  researcher: "Researcher",
  analyst: "Read-only reviewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Manages access and settings, and can do everything a researcher can.",
  researcher: "Views permitted data, reviews sessions and creates exports.",
  analyst: "Views permitted data. Cannot change flags or create sensitive exports.",
};

export const CAPABILITIES = [
  "view.dashboard",
  "view.studyCode",
  "view.participantCode",
  "view.freeText",
  "review.write",
  "views.private",
  "views.share",
  "export.aggregate",
  "export.sessions",
  "export.freeText",
  "export.studyCode",
  "export.json",
  "audit.readAll",
  "audit.readOwn",
  "settings.access",
  "settings.policy",
  "data.rebuild",
  /** Read the survey's version history, as MySelf Studio published it (docs/11). */
  "survey.versions",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const MATRIX: Record<Role, ReadonlySet<Capability>> = {
  owner: new Set(CAPABILITIES),
  researcher: new Set<Capability>([
    "view.dashboard",
    "view.studyCode",
    "view.participantCode",
    "view.freeText",
    "review.write",
    "views.private",
    "views.share",
    "export.aggregate",
    "export.sessions",
    "export.freeText",
    "export.studyCode",
    "audit.readOwn",
    "survey.versions",
  ]),
  analyst: new Set<Capability>(["view.dashboard", "views.private", "export.aggregate", "audit.readOwn", "survey.versions"]),
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Whether `role` has `capability`. `reviewerCanViewFreeText` is the one
 * policy-controlled exception (assumption A5).
 */
export function can(
  role: Role | null | undefined,
  capability: Capability,
  policy?: { reviewerCanViewFreeText?: boolean },
): boolean {
  if (!role || !isRole(role)) return false;
  if (role === "analyst" && capability === "view.freeText") return policy?.reviewerCanViewFreeText === true;
  return MATRIX[role].has(capability);
}

/** "NDC0042" → "NDC••42": enough to recognise a site, not enough to identify a child. */
export function maskStudyCode(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code.length <= 4) return "•".repeat(code.length);
  return `${code.slice(0, 3)}${"•".repeat(Math.max(1, code.length - 5))}${code.slice(-2)}`;
}

/**
 * Whether an email is allowed by the access policy (allowlist or Workspace
 * domain). Case-insensitive; an email with no domain is never allowed.
 */
export function emailAllowed(email: string | null | undefined, access: { emails: readonly string[]; domains: readonly string[] }): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return false;
  if (access.emails.some((x) => x.trim().toLowerCase() === e)) return true;
  const domain = e.slice(at + 1);
  return access.domains.some((d) => d.trim().toLowerCase().replace(/^@/, "") === domain);
}
