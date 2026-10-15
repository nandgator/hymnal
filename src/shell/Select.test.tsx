import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./Select.tsx";

const OPTIONS = [
  { value: "a", label: "Assorted Hymns" },
  { value: "b", label: "Camp Songs" },
  { value: "new", label: "New book…" },
];

function setup(initial = "a") {
  const onChange = vi.fn();
  const outside = vi.fn();
  function Harness() {
    const [value, setValue] = createSignal(initial);
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the sheet's Escape
      <div onKeyDown={(e) => e.key === "Escape" && outside()}>
        <label for="pick">Add to</label>
        <Select
          id="pick"
          label="Add to"
          options={OPTIONS}
          value={value()}
          onChange={(v) => {
            onChange(v);
            setValue(v);
          }}
        />
      </div>
    );
  }
  render(() => <Harness />);
  return { onChange, outside, field: screen.getByRole("combobox", { name: "Add to" }) };
}

describe("Select", () => {
  it("shows the chosen option on the field, closed", () => {
    const { field } = setup("b");
    expect(field).toHaveTextContent("Camp Songs");
    expect(field).toHaveAttribute("data-value", "b");
    expect(field).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens on a click and closes on a second click", () => {
    const { field } = setup();
    fireEvent.click(field);
    expect(field).toHaveAttribute("aria-expanded", "true");
    expect(field).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Assorted Hymns",
      "Camp Songs",
      "New book…",
    ]);
    fireEvent.click(field);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field).toHaveAttribute("aria-expanded", "false");
  });

  it("marks the current row, and the active one is where the list opens", () => {
    const { field } = setup("b");
    fireEvent.click(field);
    const rows = screen.getAllByRole("option");
    expect(rows.map((r) => r.hasAttribute("data-current"))).toEqual([false, true, false]);
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(field).toHaveAttribute("aria-activedescendant", rows[1]?.id);
  });

  it("picks a row on a click, calls onChange and closes", () => {
    const { field, onChange } = setup();
    fireEvent.click(field);
    fireEvent.click(screen.getByRole("option", { name: "Camp Songs" }));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field).toHaveTextContent("Camp Songs");
    expect(field).toHaveFocus();
  });

  it("opens with Enter, Space or the down arrow", () => {
    for (const key of ["Enter", " ", "ArrowDown"]) {
      const { field } = setup();
      fireEvent.keyDown(field, { key });
      expect(field).toHaveAttribute("aria-expanded", "true");
      fireEvent.keyDown(field, { key: "Escape" });
      document.body.replaceChildren();
    }
  });

  it("moves with the arrows and picks with Enter", () => {
    const { field, onChange } = setup();
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "New book…" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.keyDown(field, { key: "ArrowUp" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes the list on Escape and keeps the Escape from the sheet", () => {
    const { field, outside } = setup();
    fireEvent.click(field);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(outside).not.toHaveBeenCalled();
    // Closed, Escape is the sheet's.
    fireEvent.keyDown(field, { key: "Escape" });
    expect(outside).toHaveBeenCalledTimes(1);
  });

  it("closes when focus leaves", () => {
    const { field } = setup();
    fireEvent.click(field);
    fireEvent.blur(field);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

describe("Select with many options", () => {
  const MANY = Array.from({ length: 8 }, (_, i) => ({
    value: `v${i}`,
    label: `Book ${i} ${i % 2 ? "Odd" : "Even"}`,
  }));
  const open = (options = MANY) => {
    const onChange = vi.fn();
    render(() => (
      <>
        <label for="many">Add to</label>
        <Select id="many" label="Add to" options={options} value="v0" onChange={onChange} />
      </>
    ));
    fireEvent.click(screen.getByRole("combobox", { name: "Add to" }));
    return { onChange };
  };

  it("has a filter field above the rows only past six options", () => {
    open(MANY.slice(0, 6));
    expect(screen.queryByRole("combobox", { name: "Filter Add to" })).not.toBeInTheDocument();
    document.body.replaceChildren();
    open();
    expect(screen.getByRole("combobox", { name: "Filter Add to" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(8);
  });

  it("filters by every word typed, and Enter picks the first match", () => {
    const { onChange } = open();
    const filter = screen.getByRole("combobox", { name: "Filter Add to" });
    fireEvent.input(filter, { target: { value: "odd 5" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Book 5 Odd"]);
    fireEvent.keyDown(filter, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("v5");
  });

  it("marks the chosen option with a check", () => {
    open();
    const rows = screen.getAllByRole("option");
    expect(rows[0]?.querySelector(".pick-row-check")).not.toBeNull();
    expect(rows[1]?.querySelector(".pick-row-check")).toBeNull();
  });
});
