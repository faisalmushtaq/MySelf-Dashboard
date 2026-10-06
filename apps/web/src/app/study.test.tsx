import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Several studies in the web app (docs/12 §12.7): every call names the study on
 * screen, and the survey filter appears only where there is a choice.
 */

const sent = vi.hoisted(() => ({ calls: [] as { name: string; data: unknown }[] }));
vi.mock("../lib/firebase", () => ({ firebase: () => ({ fns: {} }) }));
vi.mock("firebase/functions", () => ({
  httpsCallable: (_fns: unknown, name: string) => async (data: unknown) => {
    sent.calls.push({ name, data });
    return { data: {} };
  },
}));
const study = vi.hoisted(() => ({ surveys: [] as { surveyId: string; title: string; live: null; releases: string[] }[] }));
vi.mock("./data", () => ({ useStudyData: () => ({ surveys: study.surveys, surveyTitle: (id: string) => id }) }));

const { api } = await import("../lib/api");
const { setCurrentStudy } = await import("../lib/study");
const { SurveyControl } = await import("./FilterControls");

afterEach(() => {
  cleanup();
  sent.calls.length = 0;
});

describe("every call names the study on screen", () => {
  it("adds the current study, unless the call names one itself", async () => {
    await api.whoAmI({ signIn: true });
    expect(sent.calls.at(-1)).toEqual({ name: "whoAmI", data: { signIn: true } });
    setCurrentStudy("future");
    await api.querySessions({ filters: {} as never, sort: {} as never, search: "", page: 1, pageSize: 50 });
    expect(sent.calls.at(-1)!.data).toMatchObject({ study: "future", page: 1 });
    await api.whoAmI({ study: "ybm" });
    expect(sent.calls.at(-1)!.data).toEqual({ study: "ybm" });
    await api.updateStudyAccess({ study: "stage", emails: [], domains: [] });
    expect(sent.calls.at(-1)!.data).toMatchObject({ study: "stage" });
  });
});

function Where() {
  return <span data-testid="where">{useLocation().search}</span>;
}

const renderControl = (search = "") =>
  render(
    <MemoryRouter initialEntries={[`/overview${search}`]}>
      <Routes>
        <Route
          path="/overview"
          element={
            <>
              <SurveyControl />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

describe("the survey filter", () => {
  it("is not shown for a study with one survey", () => {
    study.surveys = [{ surveyId: "ybm_nd2026_standard", title: "Your Brain Matters", live: null, releases: [] }];
    renderControl();
    expect(screen.queryByRole("combobox", { name: "Survey" })).toBeNull();
  });

  it("offers all surveys or one, and choosing one starts its versions afresh", () => {
    study.surveys = [
      { surveyId: "ybm_followup", title: "Follow-up", live: null, releases: [] },
      { surveyId: "ybm_nd2026_standard", title: "Your Brain Matters", live: null, releases: [] },
    ];
    renderControl(`?v=sha256:${"1".repeat(64)}`);
    const select = screen.getByRole("combobox", { name: "Survey" });
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["All surveys", "Follow-up", "Your Brain Matters"]);
    fireEvent.change(select, { target: { value: "ybm_followup" } });
    expect(screen.getByTestId("where").textContent).toBe("?sv=ybm_followup");
  });
});
