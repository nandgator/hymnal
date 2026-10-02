import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { Snackbar } from "./Snackbar.tsx";

describe("Snackbar", () => {
  it("shows its message and runs its action", () => {
    const onAction = vi.fn();
    render(() => <Snackbar message="Update ready" action="Restart" onAction={onAction} />);
    expect(screen.getByText("Update ready")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
  });

  it("closes without acting when given a dismiss", () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(() => (
      <Snackbar
        message="Update ready"
        action="Restart"
        onAction={onAction}
        dismissLabel="Later"
        onDismiss={onDismiss}
      />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onAction).not.toHaveBeenCalled();
  });
});
