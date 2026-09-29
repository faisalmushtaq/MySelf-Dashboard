import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { StatusBadge } from "./components/Status";
import { EmptyState, ErrorState } from "./components/States";
import { BarList } from "./charts/BarList";
import { LineChart } from "./charts/LineChart";
import { InfoTip } from "./components/InfoTip";

describe("status badges", () => {
  it("carry words and an icon, never colour alone", () => {
    const { container } = render(<StatusBadge status="complete" />);
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("name the lifecycle beside a marker", () => {
    render(<StatusBadge status={{ display: "needs_review", lifecycle: "incomplete", markers: ["needs_review"], signals: [], openFlags: 1 }} />);
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByText("· Incomplete")).toBeInTheDocument();
  });
});

describe("empty and error states", () => {
  it("explain what happened and offer a next step", () => {
    const retry = vi.fn();
    render(<ErrorState title="Could not load" message="The server did not answer." onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The server did not answer.");
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(retry).toHaveBeenCalled();
  });

  it("render an empty state with its action", () => {
    render(<EmptyState title="No sessions yet" action={<button type="button">Reset</button>}>Nothing has arrived.</EmptyState>);
    expect(screen.getByRole("heading", { name: "No sessions yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });
});

describe("charts", () => {
  it("bar rows that lead somewhere are links with a spoken value", () => {
    render(
      <MemoryRouter>
        <BarList ariaLabel="Outcomes" items={[{ key: "a", text: "Skipped", label: "Skipped", value: 3, display: "3", href: "/sessions?q=x" }, { key: "b", text: "Answered", label: "Answered", value: 7, display: "7" }]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Skipped: 3. Open these sessions" })).toHaveAttribute("href", "/sessions?q=x");
    expect(screen.getByRole("list", { name: "Outcomes" }).children).toHaveLength(2);
  });

  it("an empty bar list says so", () => {
    render(<BarList ariaLabel="x" items={[]} empty="Nothing here." />);
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
  });

  it("line charts are named images a keyboard can explore", () => {
    render(<LineChart ariaLabel="Sessions per day" series={[{ key: "s", label: "Started", color: "#000" }]} points={[{ x: "2026-09-01", label: "1 Sep", values: { s: 2 } }, { x: "2026-09-02", label: "2 Sep", values: { s: 5 } }]} />);
    const chart = screen.getByRole("img", { name: "Sessions per day" });
    expect(chart).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(chart, { key: "End" });
    expect(screen.getByRole("status")).toHaveTextContent("2 Sep");
    expect(screen.getByRole("status")).toHaveTextContent("5");
  });
});

it("definitions open from the keyboard", () => {
  render(<InfoTip label="Completion rate">Complete ÷ finished.</InfoTip>);
  const btn = screen.getByRole("button", { name: "Definition: Completion rate" });
  fireEvent.focus(btn);
  expect(screen.getByRole("tooltip")).toHaveClass("open");
});
