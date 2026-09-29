import { inflateSync } from "node:zlib";

const winAnsi = new TextDecoder("windows-1252");

/** Pages in a pdfkit document. */
export const pdfPages = (pdf: Buffer): number => (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;

/** The text drawn on every page, decoded from pdfkit's compressed content streams. */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let out = "";
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const t of content.matchAll(/\[([^\]]*)\] TJ/g)) {
      for (const h of t[1]!.matchAll(/<([0-9a-f]*)>/g)) out += winAnsi.decode(Buffer.from(h[1]!, "hex"));
      out += "\n";
    }
  }
  return out;
}
