import { render } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import { describe, expect, it } from "vitest";
import { Segmented } from "./Segmented.tsx";

const OPTIONS = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
];

const names = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLInputElement>("input[type=radio]")].map((input) => input.name);

describe("Segmented", () => {
  it("names its radios the same on every mount of a use-site", () => {
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const view = render(() => (
        <Segmented legend="Theme" options={OPTIONS} value="a" onChange={() => {}} />
      ));
      seen.push(names(view.container)[0] ?? "");
      view.unmount();
    }
    expect(seen[0]).toBeTruthy();
    expect(new Set(seen).size).toBe(1);
  });

  it("keeps two controls mounted together in separate groups", () => {
    const view = render(() => (
      <>
        <Segmented legend="Theme" options={OPTIONS} value="a" onChange={() => {}} />
        <Segmented legend="Text size" options={OPTIONS} value="b" onChange={() => {}} />
        <Segmented legend="Theme" options={OPTIONS} value="b" onChange={() => {}} />
      </>
    ));
    const [theme, size, again] = [...view.container.querySelectorAll("fieldset")].map((f) =>
      names(f),
    );
    expect(new Set(theme).size).toBe(1);
    expect(new Set([theme?.[0], size?.[0], again?.[0]]).size).toBe(3);
    // Each group still has exactly its own checked radio.
    expect(view.container.querySelectorAll("input:checked")).toHaveLength(3);
  });

  it("frees a name when its control goes, so a later one reuses it", () => {
    const [shown, setShown] = createSignal(true);
    const view = render(() => (
      <>
        <Segmented legend="Theme" options={OPTIONS} value="a" onChange={() => {}} />
        <Show when={shown()}>
          <Segmented legend="Theme" options={OPTIONS} value="a" onChange={() => {}} />
        </Show>
      </>
    ));
    const second = () => names(view.container.querySelectorAll("fieldset")[1] as HTMLElement)[0];
    const first = second();
    setShown(false);
    setShown(true);
    expect(second()).toBe(first);
  });
});
