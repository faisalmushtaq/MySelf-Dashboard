import { findItem, type Workspace } from "@myself-dashboard/core";

/**
 * Conditions in words. A show-only-if rule stored as a logic tree is
 * unreadable; "if they answered Yes to 'Do you have a smartphone?'" is not.
 */

type Expr = { op?: string; target?: { item?: { instrument: string; item: string } }; code?: number; value?: unknown; years?: number; arg?: Expr; args?: Expr[] };

const quote = (s: string, n = 48) => `“${s.length > n ? `${s.slice(0, n - 1)}…` : s}”`;

export function describeCondition(expr: unknown, ws: Workspace): string {
  const e = (expr ?? {}) as Expr;
  const q = () => {
    const t = e.target?.item;
    if (!t) return "an earlier answer";
    const hit = findItem(ws, `${t.instrument}.${t.item}`);
    return hit ? quote(hit.item.stem.text) : `${t.instrument}.${t.item}`;
  };
  const option = () => {
    const t = e.target?.item;
    const hit = t ? findItem(ws, `${t.instrument}.${t.item}`) : undefined;
    const scale = hit?.item.scale ? ws.scales[hit.item.scale] : undefined;
    return scale?.options.find((o) => o.code === e.code)?.label ?? `option ${e.code}`;
  };
  switch (e.op) {
    case "selected":
      return `${option()} was chosen for ${q()}`;
    case "not_selected":
      return `${option()} was not chosen for ${q()}`;
    case "answered":
    case "not_empty":
      return `${q()} was answered`;
    case "age_gte":
      return `they are ${e.years} or older (from ${q()})`;
    case "eq":
      return `${q()} is ${String(e.value)}`;
    case "ne":
      return `${q()} is not ${String(e.value)}`;
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return `${q()} is ${{ gt: "more than", gte: "at least", lt: "less than", lte: "at most" }[e.op]} ${String(e.value)}`;
    case "not":
      return `not (${describeCondition(e.arg, ws)})`;
    case "all":
      return (e.args ?? []).map((a) => describeCondition(a, ws)).join(", and ");
    case "any":
      return (e.args ?? []).map((a) => describeCondition(a, ws)).join(", or ");
    default:
      return "a condition this page cannot put into words";
  }
}

/** Whether the simple builder can show (and so replace) a condition as it is. */
export function isSimple(expr: unknown): expr is { op: "selected" | "not_selected"; target: { item: { instrument: string; item: string } }; code: number } {
  const e = (expr ?? {}) as Expr;
  return (e.op === "selected" || e.op === "not_selected") && !!e.target?.item && typeof e.code === "number";
}

export const TYPE_LABELS: Record<string, string> = {
  info: "Information",
  single_choice: "One option",
  multi_choice: "Several options",
  checkbox_set: "Tick each statement",
  rank_group: "Sort and rank",
  numeric: "Number",
  slider: "Slider",
  ladder: "Ladder",
  text_short: "Short text",
  text_long: "Long text",
  form_fields: "Several short texts",
  date: "Date",
};

export const REQUIRED_LABELS = { hard: "Required", soft: "Asked to answer (can skip after a reminder)", optional: "Optional" } as const;
