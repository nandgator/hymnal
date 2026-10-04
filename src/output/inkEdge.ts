/** Optical alignment of a part's marker with its lyric lines (SDD-0005 § 1).
 *
 * A glyph does not start at its box's edge: its left side bearing is a
 * fraction of the type's size, different for every glyph and every size. The
 * marker is smaller than the lines, so aligning boxes leaves it a hair off.
 * This measures where each first glyph's ink begins and returns the shift
 * that puts the marker's ink on the leftmost line's. */

const PROBE = 200; // px: the probe's type size, so an em reads to 0.005
const ORIGIN = 120; // px: where the probe draws its glyph from, room to the left

const bearings = new Map<string, number>();
let canvas: HTMLCanvasElement | null | undefined;

const context = () => {
  if (canvas === undefined) {
    try {
      canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 420;
    } catch {
      canvas = null;
    }
  }
  try {
    return canvas?.getContext("2d", { willReadFrequently: true }) ?? null;
  } catch {
    return null;
  }
};

/** How far the first inked column of `glyph` sits right of its origin, in em.
 * 0 when it cannot be told (no canvas, nothing inked). */
export const inkBearing = (glyph: string, style: CSSStyleDeclaration): number => {
  const font = `${style.fontStyle} ${style.fontWeight} ${PROBE}px ${style.fontFamily}`;
  const key = `${font}|${glyph}`;
  const known = bearings.get(key);
  if (known !== undefined) return known;
  const ctx = context();
  if (!ctx) return 0;
  ctx.clearRect(0, 0, 640, 420);
  ctx.font = font;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#000";
  ctx.fillText(glyph, ORIGIN, 280);
  const { data } = ctx.getImageData(0, 0, 640, 420);
  let min = Number.POSITIVE_INFINITY;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== undefined && data[i] > 127) {
      const x = (i >> 2) % 640;
      if (x < min) min = x;
    }
  }
  const em = Number.isFinite(min) ? (min - ORIGIN) / PROBE : 0;
  // A font still loading would have drawn its fallback: do not remember that.
  if (document.fonts?.check(font, glyph) !== false) bearings.set(key, em);
  return em;
};

const firstGlyph = (text: string): string => {
  const head = text.trimStart();
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const first = new Intl.Segmenter(undefined, { granularity: "grapheme" })
      .segment(head)
      [Symbol.iterator]()
      .next();
    if (!first.done) return first.value.segment;
  }
  return [...head][0] ?? "";
};

/** The x of the ink where each of an element's own text's lines starts (one,
 * unless it wraps), or null. */
const inkLefts = (el: Element): number[] | null => {
  const text = [...el.childNodes].find(
    (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
  );
  if (!text?.textContent || typeof document.createRange !== "function") return null;
  const range = document.createRange();
  range.selectNodeContents(text);
  if (typeof range.getClientRects !== "function") return null;
  const rects = [...range.getClientRects()];
  const [first] = rects;
  if (!first) return null;
  const style = getComputedStyle(el);
  const px = Number.parseFloat(style.fontSize);
  const glyph = firstGlyph(text.textContent);
  if (!glyph) return null;
  const lefts = [first.left + inkBearing(glyph, style) * px];
  if (rects.length > 1 && typeof Intl !== "undefined" && "Segmenter" in Intl) {
    // A wrapped line starts again at a glyph of its own: find where.
    let top = first.top;
    const probe = document.createRange();
    for (const { index, segment } of new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(text.textContent)) {
      if (!segment.trim()) continue;
      probe.setStart(text, index);
      probe.setEnd(text, index + segment.length);
      const at = probe.getClientRects()[0];
      if (!at || at.top <= top + px * 0.5) continue;
      top = at.top;
      lefts.push(at.left + inkBearing(segment, style) * px);
    }
  }
  return lefts;
};

/** Shifts `marker` (the text span of a part's marker) so its first glyph's ink
 * is on the leftmost ink of `lines`: sets `--ink-nudge`, a px length the CSS
 * puts on the marker's inline start. Measured, not assumed, so it holds for
 * any glyph, script and size. Call once laid out and fonts are in. */
export const nudgeMarker = (marker: HTMLElement, lines: Element[]): void => {
  marker.style.removeProperty("--ink-nudge");
  const mine = inkLefts(marker)?.[0];
  const theirs = lines.flatMap((line) => inkLefts(line) ?? []);
  if (mine === undefined || theirs.length === 0) return;
  const nudge = Math.min(...theirs) - mine;
  // Bearings differ by a few percent of an em: a whole marker em is a mismeasure.
  if (Math.abs(nudge) > Number.parseFloat(getComputedStyle(marker).fontSize)) return;
  marker.style.setProperty("--ink-nudge", `${Math.round(nudge * 100) / 100}px`);
};
