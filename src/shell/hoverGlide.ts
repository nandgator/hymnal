import {
  type Box,
  boxOf,
  frame,
  glideTiming,
  paint,
  prefersReducedMotion,
  shownBox,
} from "../presenter/glideGeometry.ts";

// jsdom has no Web Animations: there the layer jumps, as with reduced motion.
const instant = () => prefersReducedMotion() || typeof Element.prototype.animate !== "function";

type Side = "top" | "bottom" | "left" | "right";

const FADE_MS = 150;

/**
 * One highlight layer for a list of rows (DESIGN.md § Interaction states):
 * it glides, by translate and height, to the row under the pointer or the
 * keyboard's focus. It enters from the side the pointer came in by, and
 * fades out when the pointer leaves. Reduced motion: it jumps, no glide.
 * `list` must be positioned (the layer is placed by layout offsets); give
 * rows no hover fill of their own. Returns its cleanup.
 */
export function hoverGlide(list: HTMLElement, rows = "button:enabled, a[href]"): () => void {
  const layer = document.createElement("div");
  layer.className = "hover-glide";
  layer.setAttribute("aria-hidden", "true");
  list.prepend(layer);

  let at: Box | null = null;
  let anim: Animation | null = null;
  let visible = false;
  let entry: Side | null = null;

  const rowOf = (target: EventTarget | null) => {
    const row = (target as Element | null)?.closest?.(rows) as HTMLElement | null | undefined;
    return row && list.contains(row) ? row : null;
  };

  const place = (row: HTMLElement) => {
    const box = boxOf(row, list);
    const from = shownBox(layer, anim, at);
    anim?.cancel();
    anim = null;
    if (instant()) {
      paint(layer, box);
      layer.style.opacity = "1";
    } else if (!visible || !from) {
      const start: Box = { ...box };
      if (entry === "top") start.y -= box.h;
      else if (entry === "bottom") start.y += box.h;
      else if (entry === "left") start.x -= box.w / 2;
      else if (entry === "right") start.x += box.w / 2;
      paint(layer, box);
      layer.style.opacity = "1";
      anim = layer.animate(
        [
          { ...frame(start), opacity: 0 },
          { ...frame(box), opacity: 1 },
        ],
        glideTiming(layer),
      );
    } else if (from.x !== box.x || from.y !== box.y || from.w !== box.w || from.h !== box.h) {
      paint(layer, box);
      anim = layer.animate([frame(from), frame(box)], glideTiming(layer));
    }
    at = box;
    visible = true;
    entry = null;
  };

  const hide = () => {
    if (!visible) return;
    visible = false;
    anim?.cancel();
    anim = null;
    if (instant()) {
      layer.style.opacity = "0";
      return;
    }
    const fade = layer.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: FADE_MS,
      easing: glideTiming(layer).easing,
    });
    anim = fade;
    layer.style.opacity = "0";
  };

  const sideOf = (event: PointerEvent): Side => {
    const r = list.getBoundingClientRect();
    const d: [Side, number][] = [
      ["top", event.clientY - r.top],
      ["bottom", r.bottom - event.clientY],
      ["left", event.clientX - r.left],
      ["right", r.right - event.clientX],
    ];
    return d.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
  };

  const onOver = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const row = rowOf(event.target);
    // pointerover comes before pointerenter, so the side is read here: the
    // first row over, with no layer yet, is the pointer's entry.
    if (row && !visible) entry = sideOf(event);
    if (row) place(row);
  };
  const onLeave = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    entry = null;
    const focused = list.querySelector<HTMLElement>(":focus-visible");
    if (focused && rowOf(focused)) place(focused);
    else hide();
  };
  const onFocusIn = (event: FocusEvent) => {
    const row = rowOf(event.target);
    if (row?.matches(":focus-visible")) place(row);
  };
  const onFocusOut = (event: FocusEvent) => {
    if (!list.contains(event.relatedTarget as Node | null)) hide();
  };

  list.addEventListener("pointerover", onOver);
  list.addEventListener("pointerleave", onLeave);
  list.addEventListener("focusin", onFocusIn);
  list.addEventListener("focusout", onFocusOut);
  return () => {
    list.removeEventListener("pointerover", onOver);
    list.removeEventListener("pointerleave", onLeave);
    list.removeEventListener("focusin", onFocusIn);
    list.removeEventListener("focusout", onFocusOut);
    anim?.cancel();
    layer.remove();
  };
}
