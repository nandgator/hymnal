import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import App from "./App.tsx";

describe("App", () => {
  it("renders", () => {
    render(() => <App />);
    expect(screen.getByText("Hymnal")).toBeInTheDocument();
  });
});
