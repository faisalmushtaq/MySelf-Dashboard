import { z } from "zod";

/**
 * Study-level settings that change what the numbers mean. Stored in
 * `config/policy` in the dashboard database and editable by an administrator, so
 * none of these is a constant somebody has to find in the code.
 */
export const policySchema = z.object({
  /** Which `required` levels count as required for completeness (A2). */
  requiredLevels: z.array(z.enum(["hard", "soft", "optional"])).min(1).default(["hard", "soft"]),
  /** A sitting not heard from for this long is abandoned (A3). */
  abandonAfterHours: z.number().min(1).max(24 * 60).default(24),
  /** Study codes matching any of these (case-insensitive regex) are test sittings (A4). */
  testCodePatterns: z.array(z.string().max(200)).max(50).default(["^TST", "^ZZZ"]),
  /** May read-only reviewers read free-text answers? (A5) */
  reviewerCanViewFreeText: z.boolean().default(false),
  /** Hours an export file is kept before it is deleted (A7). */
  exportRetentionHours: z.number().min(1).max(24 * 14).default(24),
  /** Study time zone for "today", "this month" and daily buckets (A6). */
  timeZone: z.string().min(1).default("Europe/London"),
  /** Too-fast answers in one sitting that raise an automatic review signal. */
  tooFastWarningCount: z.number().int().min(1).default(10),
  /** The release the survey is currently serving, if the team wants to pin it. */
  activeReleaseHash: z.string().nullable().default(null),
});

export type Policy = z.infer<typeof policySchema>;

export const DEFAULT_POLICY: Policy = policySchema.parse({});

/** Merge a stored policy over the defaults, tolerating fields added later. */
export function readPolicy(raw: unknown): Policy {
  const parsed = policySchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_POLICY;
}

export function isTestCode(studyCode: string | undefined, policy: Pick<Policy, "testCodePatterns">): boolean {
  if (!studyCode) return false;
  return policy.testCodePatterns.some((p) => {
    try {
      return new RegExp(p, "i").test(studyCode);
    } catch {
      return false;
    }
  });
}
