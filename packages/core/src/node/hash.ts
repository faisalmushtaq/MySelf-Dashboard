import { createHash } from "node:crypto";
import { canonicalJson } from "../manifest.js";

/** `sha256:<hex>` of the canonical form, exactly as the survey's release builder computes it. */
export function contentHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

/**
 * Whether a manifest's stated hash matches its content. The registry refuses a
 * manifest that fails this: a sitting is identified with its version BY this
 * hash, so a manifest whose content does not produce it is not that version.
 */
export function verifyManifestHash(manifest: Record<string, unknown>): { ok: boolean; stated: string | null; computed: string } {
  const { hash, ...body } = manifest;
  const computed = contentHash(body);
  return { ok: typeof hash === "string" && hash === computed, stated: typeof hash === "string" ? hash : null, computed };
}
