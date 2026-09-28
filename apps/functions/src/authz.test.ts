import { describe, expect, it } from "vitest";
import { decideAccess, tokenFacts } from "./authz.js";

const access = { emails: ["brainpopresearch@gmail.com"], domains: [] };
const google = (email: string, extra: Record<string, unknown> = {}) =>
  tokenFacts({ email, email_verified: true, firebase: { sign_in_provider: "google.com" }, ...extra }, "uid1");
const account = (role?: string, disabled = false) => ({ disabled, claims: role ? { role } : {} });

describe("who may use the dashboard", () => {
  it("admits an allowlisted, verified Google account with a role", () => {
    const d = decideAccess(google("BrainPOPResearch@gmail.com"), account("researcher"), access);
    expect(d).toEqual({ ok: true, role: "researcher", email: "brainpopresearch@gmail.com" });
  });

  it("refuses without a token", () => {
    expect(decideAccess(null, null, access)).toMatchObject({ ok: false, code: "unauthenticated" });
  });

  it("refuses a Google account that is not on the allowlist, even with a role", () => {
    // A role granted through the survey's own setRole does not open the dashboard.
    expect(decideAccess(google("someone@gmail.com"), account("owner"), access)).toMatchObject({ ok: false, audit: "not_allowlisted" });
  });

  it("refuses an allowlisted account with no role, and says so", () => {
    const d = decideAccess(google("brainpopresearch@gmail.com"), account(), access);
    expect(d).toMatchObject({ ok: false, audit: "no_role" });
    if (!d.ok) expect(d.reason).toMatch(/has not been given a dashboard role/);
  });

  it("refuses unverified emails, non-Google providers, anonymous devices and device claims", () => {
    expect(decideAccess(tokenFacts({ email: "brainpopresearch@gmail.com", email_verified: false, firebase: { sign_in_provider: "google.com" } }, "u"), account("owner"), access)).toMatchObject({ ok: false, audit: "email_unverified" });
    expect(decideAccess(tokenFacts({ email: "brainpopresearch@gmail.com", email_verified: true, firebase: { sign_in_provider: "password" } }, "u"), account("owner"), access)).toMatchObject({ ok: false, audit: "provider" });
    expect(decideAccess(tokenFacts({ firebase: { sign_in_provider: "anonymous" } }, "u"), account(), access)).toMatchObject({ ok: false, audit: "device" });
    expect(decideAccess(google("brainpopresearch@gmail.com", { device: true }), account("owner"), access)).toMatchObject({ ok: false, audit: "device" });
  });

  it("uses the account's CURRENT role, not the token's", () => {
    // The token still says owner, but the role was removed a minute ago.
    const d = decideAccess(google("brainpopresearch@gmail.com", { role: "owner" }), account(), access);
    expect(d.ok).toBe(false);
  });

  it("refuses a disabled account and an unknown role", () => {
    expect(decideAccess(google("brainpopresearch@gmail.com"), account("owner", true), access)).toMatchObject({ ok: false, audit: "disabled" });
    expect(decideAccess(google("brainpopresearch@gmail.com"), account("superuser"), access)).toMatchObject({ ok: false, audit: "no_role" });
  });

  it("an empty access policy admits nobody", () => {
    expect(decideAccess(google("brainpopresearch@gmail.com"), account("owner"), { emails: [], domains: [] }).ok).toBe(false);
  });

  it("supports a Workspace domain", () => {
    expect(decideAccess(google("a.researcher@brainpop.example"), account("analyst"), { emails: [], domains: ["brainpop.example"] })).toMatchObject({ ok: true, role: "analyst" });
  });
});
