import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SurveyVersionsResponse, SurveyVersionView } from "@myself-dashboard/core";

const H = (n: number) => `sha256:${String(n).repeat(64)}`;
const version = (v: string, hash: string, more: Partial<SurveyVersionView> = {}): SurveyVersionView => ({
  surveyId: "ybm_nd2026_standard", version: v, releaseKey: `ybm_nd2026_standard_r${v.replaceAll(".", "_")}`, hash, engineVersion: "0.3.0", source: "studio", inStudio: true, registered: true,
  authors: [], publishedBy: null, publishedAt: "2026-09-04T09:00:00.000Z", basedOn: null, restoredFrom: null, releaseNote: null, changes: [], requiredBump: null, chosenBump: null, myStory: null, live: false, livePeriods: [],
  sittings: 0, complete: 0, partial: 0, firstSitting: null, lastSitting: null, problem: null, ...more,
});
const history: SurveyVersionsResponse = {
  studioSetUp: true,
  live: [{ surveyId: "ybm_nd2026_standard", title: "Your Brain Matters", version: "9.0.0", hash: H(2), releaseKey: "ybm_nd2026_standard_r9_0_0", generation: 4, since: "2026-09-23T09:00:00.000Z" }],
  versions: [
    version("10.0.0", H(3), { restoredFrom: "8.0.0", chosenBump: "major", basedOn: "9.0.0", releaseNote: "<img src=x onerror=alert(1)> MyStory at the end", myStory: { protocol: "np.phone_wellbeing", protocolVersion: "0.1.1" }, changes: ["MyStory added (np.phone_wellbeing@0.1.1)"], problem: "Not read: it has changed since it was published." }),
    version("9.0.0", H(2), { live: true, publishedBy: "a@brainpop.example", authors: ["a@brainpop.example"], sittings: 3, complete: 2, partial: 1, firstSitting: "2026-09-07T09:00:00.000Z", lastSitting: "2026-09-28T09:00:00.000Z", livePeriods: [{ from: "2026-09-23T09:00:00.000Z", to: null, how: "made_live_again", by: "b@brainpop.example", reason: "Back to the shorter survey" }] }),
    version("7.3.0", H(1), { source: "repository", inStudio: false, surveyId: null }),
  ],
  unknownSittings: 2,
  computedAt: "2026-10-01T00:00:00.000Z",
};

const calls = vi.hoisted(() => ({ manifest: vi.fn(), provenance: vi.fn(), saved: vi.fn() }));
vi.mock("../../lib/api", () => ({
  api: {
    listSurveyVersions: () => Promise.resolve(history),
    getSurveyManifest: (d: unknown) => (calls.manifest(d), Promise.resolve({ manifestJson: "{}" })),
    exportSurveyProvenance: () => (calls.provenance(), Promise.resolve({ csv: "survey,version\r\n", json: "{}" })),
  },
  explain: (e: unknown) => ({ code: "unknown", message: String(e) }),
}));
vi.mock("../../lib/figureFiles", () => ({ saveBlob: (_b: Blob, name: string) => calls.saved(name) }));

const { default: Versions } = await import("./Versions");

afterEach(cleanup);

describe("the Survey versions page", () => {
  it("says versions are edited and published in Studio, and links there safely in a new tab", async () => {
    render(<Versions />);
    const link = await screen.findByRole("link", { name: /Edit in Studio/ });
    expect(link).toHaveAttribute("href", "https://faisalmushtaq.github.io/MySelf/researcher/#/surveys");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/This page is a read-only record/)).toBeInTheDocument();
    // Nothing on the page changes a version.
    for (const name of [/publish/i, /make live/i, /roll ?back/i, /draft/i, /restore/i]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("shows the live version and each version's provenance, sittings and live periods", async () => {
    render(<Versions />);
    expect(await screen.findByText(/live since/)).toHaveTextContent("v9.0.0, live since 23 Sept 2026");
    expect(screen.getByText(/2 sittings were recorded under a version/)).toBeInTheDocument();
    expect(screen.getByText("np.phone_wellbeing")).toHaveAttribute("title", "np.phone_wellbeing@0.1.1");
    expect(screen.getByText("version 0.1.1")).toBeInTheDocument();
    expect(screen.getByText("by a@brainpop.example")).toBeInTheDocument();
    expect(screen.getByText("Written by a@brainpop.example")).toBeInTheDocument();
    expect(screen.getByText("2 complete · 1 partial", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/made live again by b@brainpop.example: Back to the shorter survey/)).toBeInTheDocument();
    expect(screen.getByText("not in Studio")).toBeInTheDocument();
    expect(screen.getByText("MAJOR on v9.0.0")).toBeInTheDocument();
    expect(screen.getByText("restored from v8.0.0")).toBeInTheDocument();
    expect(screen.getByText(/it has changed since it was published/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1 change" }));
    expect(screen.getByText("MyStory added (np.phone_wellbeing@0.1.1)")).toBeInTheDocument();
  });

  it("shows what a researcher wrote as text, never as markup", async () => {
    const { container } = render(<Versions />);
    expect(await screen.findByText("<img src=x onerror=alert(1)> MyStory at the end")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("downloads a manifest and the provenance", async () => {
    render(<Versions />);
    fireEvent.click((await screen.findAllByRole("button", { name: /Manifest/ }))[1]!);
    await waitFor(() => expect(calls.saved).toHaveBeenCalledWith("ybm_nd2026_standard_r9_0_0.manifest.json"));
    expect(calls.manifest).toHaveBeenCalledWith({ hash: H(2) });
    fireEvent.click(screen.getByRole("button", { name: /Version history \(CSV\)/ }));
    await waitFor(() => expect(calls.saved).toHaveBeenCalledWith("survey_versions.csv"));
    fireEvent.click(screen.getByRole("button", { name: "JSON" }));
    await waitFor(() => expect(calls.saved).toHaveBeenCalledWith("survey_versions.json"));
  });
});
