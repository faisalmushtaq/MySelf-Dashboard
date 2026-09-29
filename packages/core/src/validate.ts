import type { QuestionDef } from "./manifest.js";

/**
 * Whether a recorded value is a valid answer to this question AS THIS RELEASE
 * DEFINES IT.
 *
 * `empty` distinguishes a legitimately empty answer the definition allows (a
 * multi-choice with no minimum and nothing ticked) from a missing one. `reason`
 * is shown to the researcher, so it says what is wrong in words.
 */
export interface ValidationResult {
  valid: boolean;
  empty: boolean;
  reason?: string;
}

const ok = (empty = false): ValidationResult => ({ valid: true, empty });
const bad = (reason: string): ValidationResult => ({ valid: false, empty: false, reason });

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
const num = (c: Record<string, unknown>, k: string): number | undefined =>
  typeof c[k] === "number" ? (c[k] as number) : undefined;

function testPattern(pattern: unknown, text: string): boolean {
  if (typeof pattern !== "string") return true;
  try {
    return new RegExp(pattern).test(text);
  } catch {
    // A pattern the reader cannot compile is not the participant's fault.
    return true;
  }
}

export function validateAnswer(q: QuestionDef, value: unknown): ValidationResult {
  if (value === null || value === undefined || typeof value !== "object") {
    return bad("no value was recorded with the answer (corrupted)");
  }
  const v = value as Record<string, unknown>;
  const c = q.constraints;
  const codes = new Set((q.options ?? []).map((o) => o.code));

  switch (q.responseType) {
    case "single_choice": {
      if (v["kind"] !== "choice" || !isInt(v["code"])) return bad("expected a single option code");
      if (codes.size > 0 && !codes.has(v["code"])) return bad(`option code ${v["code"]} does not exist in this version`);
      return ok();
    }
    case "multi_choice": {
      if (v["kind"] !== "multi" || !Array.isArray(v["codes"])) return bad("expected a list of option codes");
      const list = v["codes"] as unknown[];
      if (!list.every(isInt)) return bad("option codes must be whole numbers");
      const unknown = (list as number[]).filter((x) => codes.size > 0 && !codes.has(x));
      if (unknown.length > 0) return bad(`option code(s) ${unknown.join(", ")} do not exist in this version`);
      const min = num(c, "minSelections") ?? 0;
      const max = num(c, "maxSelections");
      if (list.length < min) return bad(`at least ${min} selection(s) required`);
      if (max !== undefined && list.length > max) return bad(`at most ${max} selection(s) allowed`);
      return ok(list.length === 0);
    }
    case "slider":
    case "numeric": {
      if (v["kind"] !== "number" || typeof v["value"] !== "number" || !Number.isFinite(v["value"])) {
        return bad("expected a number");
      }
      const n = v["value"] as number;
      const min = num(c, "min");
      const max = num(c, "max");
      if (min !== undefined && n < min) return bad(`${n} is below the minimum ${min}`);
      if (max !== undefined && n > max) return bad(`${n} is above the maximum ${max}`);
      if (q.responseType === "numeric" && c["integerOnly"] !== false && !Number.isInteger(n)) {
        return bad(`${n} is not a whole number`);
      }
      return ok();
    }
    case "ladder": {
      if (v["kind"] !== "number" || !isInt(v["value"])) return bad("expected a rung number");
      const low = num(c, "lowestValue") ?? 1;
      const rungs = num(c, "rungs");
      const n = v["value"] as number;
      if (n < low || (rungs !== undefined && n > low + rungs - 1)) return bad(`rung ${n} is outside the ladder`);
      return ok();
    }
    case "date": {
      if (v["kind"] !== "date" || typeof v["iso"] !== "string" || Number.isNaN(Date.parse(v["iso"] as string))) {
        return bad("expected a date");
      }
      const year = new Date(v["iso"] as string).getUTCFullYear();
      const minY = num(c, "minYear");
      const maxY = num(c, "maxYear");
      if (minY !== undefined && year < minY) return bad(`year ${year} is before ${minY}`);
      if (maxY !== undefined && year > maxY) return bad(`year ${year} is after ${maxY}`);
      return ok();
    }
    case "text_short":
    case "text_long": {
      if (v["kind"] !== "text" || typeof v["value"] !== "string") return bad("expected text");
      const text = v["value"] as string;
      const min = num(c, "minChars") ?? 0;
      const max = num(c, "maxChars");
      if (text.length < min) return bad(`shorter than ${min} characters`);
      if (max !== undefined && text.length > max) return bad(`longer than ${max} characters`);
      if (!testPattern(c["pattern"], text)) return bad("does not match the expected format");
      return ok(text.trim().length === 0);
    }
    case "form_fields": {
      if (v["kind"] !== "fields" || typeof v["values"] !== "object" || v["values"] === null) return bad("expected form fields");
      const values = v["values"] as Record<string, unknown>;
      const fields = (Array.isArray(c["fields"]) ? c["fields"] : []) as { key: string; required?: boolean; pattern?: string }[];
      for (const f of fields) {
        const raw = values[f.key];
        if (raw !== undefined && typeof raw !== "string") return bad(`field ${f.key} is not text`);
        if (f.required && (!raw || raw.trim().length === 0)) return bad(`required field ${f.key} is empty`);
        // Judged on the trimmed value, as the device judges it: "LS6 2AA " is a postcode.
        if (raw && raw.trim().length > 0 && !testPattern(f.pattern, raw.trim())) return bad(`field ${f.key} does not match its format`);
      }
      const known = new Set(fields.map((f) => f.key));
      const stray = Object.keys(values).filter((k) => known.size > 0 && !known.has(k));
      if (stray.length > 0) return bad(`unknown field(s) ${stray.join(", ")}`);
      return ok(Object.values(values).every((x) => typeof x !== "string" || x.trim().length === 0));
    }
    case "rank_group": {
      if (v["kind"] !== "group_rank" || typeof v["assignments"] !== "object" || v["assignments"] === null) {
        return bad("expected a grouping");
      }
      const groups = new Set(
        ((Array.isArray(c["groups"]) ? c["groups"] : []) as { key: string }[]).map((g) => g.key),
      );
      for (const [code, a] of Object.entries(v["assignments"] as Record<string, { group?: unknown }>)) {
        if (codes.size > 0 && !codes.has(Number(code))) return bad(`option code ${code} does not exist in this version`);
        if (groups.size > 0 && !groups.has(String(a?.group))) return bad(`group ${String(a?.group)} does not exist`);
      }
      return ok(Object.keys(v["assignments"] as object).length === 0);
    }
    case "checkbox_set": {
      if (v["kind"] !== "checkboxes" || !Array.isArray(v["checked"])) return bad("expected ticked statements");
      const statements = (Array.isArray(c["statements"]) ? c["statements"] : []) as { key: string }[];
      const known = new Set(statements.map((s) => s.key));
      const stray = (v["checked"] as unknown[]).filter((k) => typeof k !== "string" || (known.size > 0 && !known.has(k)));
      if (stray.length > 0) return bad("a ticked statement does not exist in this version");
      return ok((v["checked"] as unknown[]).length === 0);
    }
    default:
      // A response type this reader does not know: record it as given rather
      // than calling a participant's answer invalid because the reader is old.
      return ok();
  }
}
