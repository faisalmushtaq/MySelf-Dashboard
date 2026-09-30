import { buildRelease, PublishGateError, type PublishMeta } from "../vendor/myself/release/builder.js";
import { registriesOf, type Workspace } from "../editor/workspace.js";

/**
 * Rebuild a working copy into a release manifest with the survey's own
 * builder, so the editor can never publish anything the survey's publish gate
 * would refuse (docs/11). Server-only: the builder hashes with node:crypto.
 */
export function rebuild(ws: Workspace, meta: PublishMeta): { manifest: Record<string, unknown> } | { problems: string[] } {
  try {
    const manifest = buildRelease(ws.draft as never, registriesOf(ws) as never, meta);
    return { manifest: manifest as unknown as Record<string, unknown> };
  } catch (error) {
    if (error instanceof PublishGateError) return { problems: error.failures };
    return { problems: [(error as Error).message] };
  }
}

export { PublishGateError, type PublishMeta };
