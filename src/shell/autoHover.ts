import { hoverButton } from "./hoverGlide.ts";

/** The standalone buttons that wear the hover layer without being wired one by
 * one: the app's button styles, the icon buttons, and the few that look like
 * them. */
export const AUTO_BUTTONS = [
  ".btn-filled",
  ".btn-tonal",
  ".btn-outlined",
  ".btn-text",
  ".icon-button",
  ".script-change",
  ".live-strip-toggle",
].join(", ");

/**
 * A lone button's hover layer for every button in the app, without a `ref` on
 * each (DESIGN.md § Interaction states): the first time the pointer is over
 * one, it takes the layer (`hoverButton`) and is told again, so the layer
 * enters from the side the pointer came by as it does for a wired one. A
 * button that a list or a group already lights (inside `[data-hover-glide]`),
 * that wears the layer already, or that is disabled, is left alone. Touch has
 * no hover. Returns its cleanup (the layers go with their buttons).
 */
export function autoHover(root: Document | HTMLElement = document): () => void {
  const onOver = (event: Event) => {
    const over = event as PointerEvent;
    if (over.pointerType === "touch") return;
    const button = (over.target as Element | null)?.closest?.<HTMLButtonElement>(AUTO_BUTTONS);
    if (
      button?.tagName !== "BUTTON" ||
      button.disabled ||
      button.classList.contains("glide-self") ||
      button.closest("[data-hover-glide]")
    )
      return;
    hoverButton(button);
    // This pointerover came before its listener: say it again, with the move.
    button.dispatchEvent(
      new PointerEvent("pointerover", {
        bubbles: true,
        pointerType: over.pointerType,
        clientX: over.clientX,
        clientY: over.clientY,
        movementX: over.movementX,
        movementY: over.movementY,
        relatedTarget: over.relatedTarget,
      }),
    );
  };
  root.addEventListener("pointerover", onOver, true);
  return () => root.removeEventListener("pointerover", onOver, true);
}
