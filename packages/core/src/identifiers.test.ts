import { describe, expect, it } from "vitest";
import { authoriseExport, exportFileName, identityApprovalProblem, isSensitive, parseExportSpec, ExportSpecError } from "./exportSpec.js";
import { identifiersTable } from "./identifiers.js";
import { can } from "./roles.js";
import { toCsv } from "./csv.js";

// Synthetic identities only: never real participant data in tests.
describe("identifying-information export", () => {
  const spec = parseExportSpec({ kind: "identifiers", format: "csv", scope: "filtered" });

  it("is administrators only, in the role table and on the server", () => {
    expect(can("owner", "export.identity")).toBe(true);
    expect(can("researcher", "export.identity")).toBe(false);
    expect(can("analyst", "export.identity")).toBe(false);
    expect(authoriseExport("owner", spec)).toEqual({ ok: true });
    expect(authoriseExport("researcher", spec)).toMatchObject({ ok: false, reason: expect.stringContaining("only administrators") });
    expect(authoriseExport("analyst", spec).ok).toBe(false);
    expect(isSensitive(spec)).toBe(true);
  });

  it("is a CSV or Excel file, never with answers, never de-identified", () => {
    expect(spec).toMatchObject({ includeAnswers: false, includeFreeText: false, deidentified: false, identityConfirmed: false });
    expect(() => parseExportSpec({ kind: "identifiers", format: "bids", scope: "all" })).toThrow(ExportSpecError);
    expect(() => parseExportSpec({ kind: "identifiers", format: "csv", scope: "all", deidentified: true })).toThrow(/cannot be de-identified/);
    expect(exportFileName(spec, { fromDay: null, toDay: null }, new Date("2026-11-16T10:00:00Z"), { study: "ybm" })).toMatch(/^myself_ybm_identifiers_all-time_created-/);
  });

  it("needs a stated purpose and a confirmation before it is made", () => {
    expect(identityApprovalProblem(spec)).toMatch(/what the identifying information is needed for/);
    const short = parseExportSpec({ kind: "identifiers", format: "csv", scope: "all", identityPurpose: "linkage", identityConfirmed: true });
    expect(identityApprovalProblem(short)).toMatch(/needed for/);
    const unconfirmed = parseExportSpec({ kind: "identifiers", format: "csv", scope: "all", identityPurpose: "Linkage list for Connected West Yorkshire" });
    expect(identityApprovalProblem(unconfirmed)).toMatch(/confirm/);
    const ok = parseExportSpec({ kind: "identifiers", format: "csv", scope: "all", identityPurpose: "  Linkage list for Connected West Yorkshire  ", identityConfirmed: true });
    expect(ok.identityPurpose).toBe("Linkage list for Connected West Yorkshire");
    expect(identityApprovalProblem(ok)).toBeNull();
    // Other exports carry neither, whatever is sent.
    const other = parseExportSpec({ kind: "sessions", format: "csv", scope: "all", identityPurpose: "anything at all here", identityConfirmed: true });
    expect(other.identityConfirmed).toBe(false);
    expect(other.identityPurpose).toBeUndefined();
    expect(identityApprovalProblem(other)).toBeNull();
  });

  it("lays out one row per sitting, the address split into its parts, formula-safe", () => {
    const table = identifiersTable(
      [
        { sessionId: "s1", participant: "PABCDEFGHJK", wave: 1, site: "NDC", studyCode: "NDC0001", startedAt: "2026-11-10T09:00:00Z", linkageChoice: "No, don't link my records" },
        { sessionId: "s2", participant: null, wave: null, site: "NDC", studyCode: "NDC0002", startedAt: "2026-11-10T09:05:00Z", linkageChoice: null },
      ],
      [
        { sessionId: "s1", variable: "first_name", value: "=Alex" },
        { sessionId: "s1", variable: "last_name", value: "Testperson" },
        { sessionId: "s1", variable: "dob", value: "2010-02-03" },
        { sessionId: "s1", variable: "home_address", value: JSON.stringify({ house: "1", street: "Example Road", postcode: "ZZ99 9ZZ", uprn: "123" }) },
        { sessionId: "s9", variable: "first_name", value: "Not chosen" },
      ],
    );
    expect(table.headers).toEqual([
      "participant_code", "wave", "session_id", "study_code", "site", "started_at", "first_name", "last_name", "dob",
      "address_house", "address_street", "address_area", "address_postcode", "address_postcode_district", "address_uprn", "linkage_choice_16_plus",
    ]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toEqual(["PABCDEFGHJK", 1, "s1", "NDC0001", "NDC", "2026-11-10T09:00:00Z", "=Alex", "Testperson", "2010-02-03", "1", "Example Road", null, "ZZ99 9ZZ", null, "123", "No, don't link my records"]);
    expect(table.rows[1]!.slice(6, 9)).toEqual([null, null, null]);
    expect(toCsv(table.headers, table.rows)).not.toContain(",=Alex");
    expect(JSON.stringify(table.rows)).not.toContain("Not chosen");
  });
});
