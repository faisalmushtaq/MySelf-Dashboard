/**
 * A minimal SVG tree and serialiser. Every string that reaches the output —
 * question wording, option labels, site names — passes through `escapeXml`, so
 * survey content can never become markup in a figure or in the page showing it.
 */

export type AttrValue = string | number | null | undefined;
export interface El {
  t: string;
  a: Record<string, AttrValue>;
  c: Child[];
}
export type Child = El | string | null | undefined | false;

export function el(t: string, a: Record<string, AttrValue> = {}, ...c: (Child | Child[])[]): El {
  return { t, a, c: c.flat() };
}

// XML 1.0 forbids most C0 control characters even when escaped.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escapeXml(s: string): string {
  return s
    .replace(FORBIDDEN, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Coordinates to 0.01 pt: exact enough for print, small enough to read. */
export function n(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

function attrs(a: Record<string, AttrValue>): string {
  let out = "";
  for (const [k, v] of Object.entries(a)) {
    if (v === null || v === undefined) continue;
    out += ` ${k}="${typeof v === "number" ? n(v) : escapeXml(v)}"`;
  }
  return out;
}

export function render(node: El, depth = 0): string {
  const pad = "  ".repeat(depth);
  const kids = node.c.filter((c): c is El | string => c !== null && c !== undefined && c !== false);
  if (kids.length === 0) return `${pad}<${node.t}${attrs(node.a)}/>`;
  if (kids.every((k) => typeof k === "string")) {
    return `${pad}<${node.t}${attrs(node.a)}>${kids.map((k) => escapeXml(k as string)).join("")}</${node.t}>`;
  }
  const inner = kids.map((k) => (typeof k === "string" ? `${pad}  ${escapeXml(k)}` : render(k, depth + 1))).join("\n");
  return `${pad}<${node.t}${attrs(node.a)}>\n${inner}\n${pad}</${node.t}>`;
}

/** A polyline path through points, with straight segments. */
export function pathOf(points: readonly [number, number][]): string {
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${n(x)} ${n(y)}`).join("");
}
