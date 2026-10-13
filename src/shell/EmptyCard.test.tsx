import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyCard, type EmptyKind } from "./EmptyCard.tsx";

afterEach(cleanup);

describe("EmptyCard", () => {
  it("is a heading and a line, with the picture hidden from a reader", () => {
    const { container } = render(() => (
      <EmptyCard kind="song" title="No song selected">
        Pick one below.
      </EmptyCard>
    ));
    expect(screen.getByRole("heading", { name: "No song selected" })).toBeInTheDocument();
    expect(screen.getByText("Pick one below.")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("has a button only when there is an action, and it runs it", () => {
    const run = vi.fn();
    render(() => (
      <EmptyCard kind="live" title="Nothing live" action={{ label: "End Live", onClick: run }} />
    ));
    fireEvent.click(screen.getByRole("button", { name: "End Live" }));
    expect(run).toHaveBeenCalledOnce();
  });

  it.each<EmptyKind>(["song", "books", "recents", "results", "live"])(
    "draws %s in the text's colour with one accent, at one stroke weight",
    (kind) => {
      const { container } = render(() => <EmptyCard kind={kind} title="x" />);
      const svg = container.querySelector("svg");
      expect(svg).toHaveAttribute("stroke", "currentColor");
      expect(svg?.querySelectorAll(".empty-accent").length).toBeGreaterThan(0);
      expect(svg?.querySelectorAll("[stroke-width]")).toHaveLength(0);
    },
  );
});
