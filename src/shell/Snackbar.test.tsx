import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet.tsx";
import { Snackbar, SnackbarHost, type SnackbarProps } from "./Snackbar.tsx";

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

  it("the host keeps a notice on screen while it leaves, then removes it", async () => {
    const [notice, setNotice] = createSignal<SnackbarProps | undefined>({
      message: "Update ready",
      action: "Restart",
      onAction: () => {},
    });
    render(() => <SnackbarHost notice={notice()} />);
    expect(screen.getByText("Update ready")).toBeInTheDocument();
    setNotice(undefined);
    await Promise.resolve();
    expect(document.querySelector(".snackbar-region")).toHaveClass("snackbar-leaving");
    await vi.waitFor(() => expect(screen.queryByText("Update ready")).toBeNull(), {
      timeout: 1000,
    });
  });
});

describe("a notice over a modal sheet", () => {
  // A modal dialog makes everything outside it inert, and the browser then
  // hit-tests a tap on a notice drawn over it straight through to the sheet:
  // every notice (they all go through the host) must live inside the open sheet.
  const notice = (message: string): SnackbarProps => ({
    message,
    action: "Got It",
    onAction: () => {},
  });

  it("sits inside the open sheet, so the sheet's modality does not make it inert, and returns when the sheet closes", async () => {
    const [open, setOpen] = createSignal(false);
    const [shown, setShown] = createSignal<SnackbarProps | undefined>(notice("Storage"));
    render(() => (
      <>
        <SnackbarHost notice={shown()} />
        <Sheet open={open()} onClose={() => setOpen(false)} title="Settings">
          <button type="button">Load Books</button>
        </Sheet>
      </>
    ));
    const region = () => document.querySelector(".snackbar-region") as HTMLElement;
    expect(region().closest("dialog")).toBeNull();

    setOpen(true);
    await vi.waitFor(() => expect(region().closest("dialog")).not.toBeNull());
    expect(region().closest("dialog")).toHaveAttribute("open");

    // A notice that arrives while the sheet is open is placed inside it too.
    setShown(undefined);
    await vi.waitFor(() => expect(document.querySelector(".snackbar-region")).toBeNull());
    setShown(notice("Another"));
    await vi.waitFor(() => expect(region().closest("dialog")).not.toBeNull());

    setOpen(false);
    await vi.waitFor(() => expect(region().closest("dialog")).toBeNull(), { timeout: 2000 });
    expect(screen.getByRole("button", { name: "Got It" })).toBeInTheDocument();
  });
});
