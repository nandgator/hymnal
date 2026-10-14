import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { ClearSearch } from "./ClearSearch.tsx";

function Field() {
  const [value, setValue] = createSignal("");
  return (
    <label class="text-field">
      <input
        type="search"
        aria-label="Find"
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
      />
      <ClearSearch visible={value() !== ""} onClear={() => setValue("")} />
    </label>
  );
}

describe("ClearSearch", () => {
  it("is there only while the field has text, and clearing it puts focus back in the field", () => {
    render(() => <Field />);
    const field = screen.getByRole("searchbox", { name: "Find" });
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();

    fireEvent.input(field, { target: { value: "abc" } });
    const button = screen.getByRole("button", { name: "Clear search" });
    button.focus();
    fireEvent.click(button);

    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  it("is a button that is not a submit, and its icon is decoration", () => {
    render(() => <Field />);
    fireEvent.input(screen.getByRole("searchbox"), { target: { value: "x" } });
    const button = screen.getByRole("button", { name: "Clear search" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.querySelector(".icon")).toHaveAttribute("aria-hidden", "true");
  });
});
