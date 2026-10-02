import { XMLParser, XMLValidator } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import { ImportError, linesFromRuns, type SourcePage, type SourceRun } from "../source.ts";
import type { PageRange } from "./pdf.ts";

/** One element of a parsed part: attributes, child elements and its own text. */
interface Xml {
  tag: string;
  attrs: Record<string, string>;
  kids: Xml[];
  text: string;
}

type Files = Record<string, Uint8Array>;

const EMU_PER_PT = 12700;
/** PowerPoint's own defaults, when nothing in the file says otherwise. */
const DEFAULT_SIZE = 18;
const DEFAULT_TOP_INSET = 45720;
const DEFAULT_SIDE_INSET = 91440;
/** A line is this many times its font size tall, unless the paragraph says. */
const LINE_HEIGHT = 1.2;
/** The baseline sits this many times the font size below its line's top. */
const ASCENT = 0.8;
/** What one XML entry may unzip to (SDD-0003 §2); more is refused as a zip bomb, not a deck. */
export const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
/** Placeholders that hold furniture, not lyrics. */
const FURNITURE = new Set(["sldNum", "dt", "ftr"]);

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  // Decoded in one pass over a:t by `decodeEscapes`: a parser that decodes
  // "&amp;" first would then see "&amp;#233;" as a character reference.
  processEntities: false,
});

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Text with XML entities and character references, and Office's `_x000D_` escapes, decoded. */
const decodeEscapes = (text: string) =>
  text
    .replace(/&(?:#(\d+)|#x([0-9A-Fa-f]+)|(amp|lt|gt|quot|apos));/g, (_, dec, hex, name) =>
      name ? NAMED[name] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16)),
    )
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

/** Order-preserving parse output → a small tree that is pleasant to walk. */
function toXml(nodes: unknown[]): Xml[] {
  const out: Xml[] = [];
  for (const node of nodes as Record<string, unknown>[]) {
    for (const key of Object.keys(node)) {
      if (key === ":@") continue;
      if (key === "#text") {
        out.push({ tag: "#text", attrs: {}, kids: [], text: String(node[key]) });
      } else if (!key.startsWith("?")) {
        const attrs = (node[":@"] ?? {}) as Record<string, string>;
        const kids = toXml(node[key] as unknown[]);
        const text = kids
          .filter((k) => k.tag === "#text")
          .map((k) => k.text)
          .join("");
        out.push({
          tag: key.replace(/^[^:]+:/, ""),
          attrs,
          kids: kids.filter((k) => k.tag !== "#text"),
          text,
        });
      }
    }
  }
  return out;
}

/** Layouts and masters are shared by many slides: parsed once per deck. */
const parsed = new WeakMap<Files, Map<string, Xml | undefined>>();

function parseXml(files: Files, path: string): Xml | undefined {
  const cache = parsed.get(files) ?? new Map<string, Xml | undefined>();
  parsed.set(files, cache);
  if (!cache.has(path)) {
    const bytes = files[path];
    let root: Xml | undefined;
    if (bytes) {
      const source = strFromU8(bytes);
      const valid = XMLValidator.validate(source);
      if (valid !== true) {
        throw new ImportError(`The deck's ${path} is not well-formed XML: ${valid.err.msg}.`);
      }
      root = toXml(parser.parse(source) as unknown[])[0];
    }
    cache.set(path, root);
  }
  return cache.get(path);
}

const child = (node: Xml | undefined, tag: string) => node?.kids.find((k) => k.tag === tag);
const children = (node: Xml | undefined, tag: string) =>
  node?.kids.filter((k) => k.tag === tag) ?? [];
/** Follows a path of tags, `a/b/c`. */
const dig = (node: Xml | undefined, path: string) =>
  path.split("/").reduce<Xml | undefined>((n, tag) => child(n, tag), node);
const num = (value: string | undefined) => (value === undefined ? undefined : Number(value));

interface Rel {
  type: string;
  target: string;
}

function resolvePath(dir: string, target: string): string {
  const parts = (target.startsWith("/") ? target.slice(1) : dir + target).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}

/** A part's relationships, targets resolved to paths in the package. */
function relsOf(files: Files, part: string): Map<string, Rel> {
  const slash = part.lastIndexOf("/");
  const dir = part.slice(0, slash + 1);
  const root = parseXml(files, `${dir}_rels/${part.slice(slash + 1)}.rels`);
  const rels = new Map<string, Rel>();
  for (const rel of root?.kids ?? []) {
    const target = rel.attrs.Target ?? "";
    rels.set(rel.attrs.Id ?? "", {
      type: rel.attrs.Type ?? "",
      target: rel.attrs.TargetMode === "External" ? target : resolvePath(dir, target),
    });
  }
  return rels;
}

const relOfType = (rels: Map<string, Rel>, type: string) =>
  [...rels.values()].find((rel) => rel.type.endsWith(`/${type}`))?.target;

/** The prefix a part binds to the relationships namespace; usually, not always, `r`. */
function relsPrefix(root: Xml): string {
  for (const [name, value] of Object.entries(root.attrs)) {
    if (name.startsWith("xmlns:") && /officeDocument.*\/relationships$/.test(value)) {
      return name.slice("xmlns:".length);
    }
  }
  return "r";
}

/** A slide's inheritance: its layout, that layout's master, and the master's theme. */
interface Inherited {
  layout?: Xml;
  master?: Xml;
  presentation: Xml;
  fonts: { major?: string; minor?: string };
}

/** Text properties found at one level of the chain, for one paragraph level. */
interface Props {
  size?: number;
  font?: string;
  marL?: number;
  indent?: number;
  lnSpc?: Xml;
}

const lvlOf = (list: Xml | undefined, lvl: number) => child(list, `lvl${lvl + 1}pPr`);

function propsOf(pPr: Xml | undefined): Props {
  const def = child(pPr, "defRPr");
  const sz = num(def?.attrs.sz);
  return {
    size: sz === undefined ? undefined : sz / 100,
    font: child(def, "latin")?.attrs.typeface,
    marL: num(pPr?.attrs.marL),
    indent: num(pPr?.attrs.indent),
    lnSpc: child(pPr, "lnSpc"),
  };
}

/** The first level of the chain that says something, per property. */
function resolveProps(levels: (Xml | undefined)[]): Props {
  const out: Props = {};
  for (const level of levels) {
    const props = propsOf(level);
    out.size ??= props.size;
    out.font ??= props.font;
    out.marL ??= props.marL;
    out.indent ??= props.indent;
    out.lnSpc ??= props.lnSpc;
  }
  return out;
}

interface Placeholder {
  type: string;
  idx?: string;
}

function placeholderOf(shape: Xml): Placeholder | undefined {
  const ph = dig(shape, "nvSpPr/nvPr/ph");
  return ph && { type: ph.attrs.type ?? "body", idx: ph.attrs.idx };
}

/** Masters know titles, bodies and a few furniture types; the rest are bodies. */
const masterType = (type: string) =>
  type === "ctrTitle" ? "title" : ["subTitle", "obj"].includes(type) ? "body" : type;

function shapesOf(tree: Xml | undefined): Xml[] {
  const out: Xml[] = [];
  const walk = (node: Xml | undefined) => {
    for (const kid of node?.kids ?? []) {
      if (kid.tag === "sp") out.push(kid);
      else if (kid.tag === "grpSp") walk(kid);
    }
  };
  walk(dig(tree, "cSld/spTree"));
  return out;
}

/** By `idx` first, which is exact; only a placeholder without a match falls back to its type. */
function matchPlaceholder(tree: Xml | undefined, ph: Placeholder, byIdx: boolean) {
  const all = shapesOf(tree).filter((s) => placeholderOf(s));
  const exact =
    byIdx && ph.idx !== undefined ? all.find((s) => placeholderOf(s)?.idx === ph.idx) : undefined;
  return exact ?? all.find((s) => masterType(placeholderOf(s)?.type ?? "") === masterType(ph.type));
}

interface Transform {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
}

const ROOT: Transform = { ox: 0, oy: 0, sx: 1, sy: 1 };

/** A frame in EMU. */
interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A shape's frame in EMU, its own or its placeholder's from the layout or master. */
function frameOf(xfrm: Xml | undefined): Frame | undefined {
  const off = child(xfrm, "off");
  const ext = child(xfrm, "ext");
  if (!off || !ext) return undefined;
  return {
    x: Number(off.attrs.x),
    y: Number(off.attrs.y),
    w: Number(ext.attrs.cx),
    h: Number(ext.attrs.cy),
  };
}

function resolveFont(face: string | undefined, fonts: Inherited["fonts"]): string {
  if (face === "+mj-lt") return fonts.major ?? "major";
  if (face === "+mn-lt") return fonts.minor ?? "minor";
  return face ?? fonts.minor ?? "unknown";
}

/** What a text body is laid out in: its box, insets and anchoring, all EMU. */
interface Box {
  frame: Frame;
  left: number;
  right: number;
  top: number;
  bottom: number;
  anchor: string;
  /** `normAutofit`'s font scale, 1 when none. */
  scale: number;
}

interface Line {
  text: string;
  size: number;
  font: string;
  height: number;
  x: number;
}

/**
 * Lays a text body out: lines of runs in a box, the way PowerPoint would
 * stack them, minus wrapping (a paragraph's line is as long as its text).
 */
function bodyRuns(
  body: Xml,
  box: Box,
  styles: (Xml | undefined)[],
  inherited: Inherited,
  t: Transform,
): SourceRun[] {
  const x0 = t.ox + ((box.frame.x + box.left) * t.sx) / EMU_PER_PT;
  const width = (Math.max(0, box.frame.w - box.left - box.right) * t.sx) / EMU_PER_PT;

  const lines: Line[] = [];
  for (const para of children(body, "p")) {
    const pPr = child(para, "pPr");
    const lvl = num(pPr?.attrs.lvl) ?? 0;
    const props = resolveProps([pPr, ...styles.map((s) => lvlOf(s, lvl))]);
    const sizeOf = (rPr: Xml | undefined) =>
      (num(rPr?.attrs.sz) === undefined
        ? (props.size ?? DEFAULT_SIZE)
        : Number(rPr?.attrs.sz) / 100) * box.scale;
    const fontOf = (rPr: Xml | undefined) => {
      const face = resolveFont(child(rPr, "latin")?.attrs.typeface ?? props.font, inherited.fonts);
      // As a PDF names a styled face ("Calibri-BoldItalic"), so profiles read alike.
      const on = (flag: unknown) => flag === "1" || flag === "true";
      const style = (on(rPr?.attrs.b) ? "Bold" : "") + (on(rPr?.attrs.i) ? "Italic" : "");
      return style ? `${face}-${style}` : face;
    };

    // A paragraph's lines: a break starts a new one.
    const pieces: { text: string; size: number; font: string }[][] = [[]];
    for (const el of para.kids) {
      if (el.tag === "br") pieces.push([]);
      else if (el.tag === "r" || el.tag === "fld") {
        const rPr = child(el, "rPr");
        const text = decodeEscapes(child(el, "t")?.text ?? "");
        pieces.at(-1)?.push({ text, size: sizeOf(rPr), font: fontOf(rPr) });
      }
    }

    const indent = (props.marL ?? 0) / EMU_PER_PT;
    for (const [i, runs] of pieces.entries()) {
      const size = runs.length
        ? Math.max(...runs.map((r) => r.size))
        : sizeOf(child(para, "endParaRPr"));
      const pct = child(props.lnSpc, "spcPct");
      const pts = child(props.lnSpc, "spcPts");
      const height = pct
        ? (Number(pct.attrs.val) / 100000) * size * LINE_HEIGHT
        : pts
          ? Number(pts.attrs.val) / 100
          : size * LINE_HEIGHT;
      // One run per line, whitespace-only runs kept: they are the word spaces.
      const first = runs.find((r) => r.text.trim() !== "");
      lines.push({
        text: runs.map((r) => r.text).join(""),
        size: first?.size ?? size,
        font: first?.font ?? runs[0]?.font ?? fontOf(undefined),
        height,
        // Only a paragraph's first line takes the first-line indent.
        x: x0 + indent + (i === 0 ? ((props.indent ?? 0) * t.sx) / EMU_PER_PT : 0),
      });
    }
  }

  // Anchoring puts the block of lines at the box's top, middle or bottom.
  const block = lines.reduce((sum, line) => sum + line.height, 0);
  const room = (box.frame.h - box.top - box.bottom) / EMU_PER_PT;
  const slack =
    box.anchor === "ctr" ? (room * t.sy - block) / 2 : box.anchor === "b" ? room * t.sy - block : 0;
  let top = t.oy + ((box.frame.y + box.top) * t.sy) / EMU_PER_PT + slack;

  const runs: SourceRun[] = [];
  for (const line of lines) {
    if (line.text.trim() !== "") {
      runs.push({
        text: line.text,
        x: line.x,
        y: top + ASCENT * line.size,
        width: Math.max(0, width - (line.x - x0)),
        size: line.size,
        font: line.font,
      });
    }
    top += line.height;
  }
  return runs;
}

/** The first of these attributes found, shape → layout → master. */
function bodyAttr(shapes: (Xml | undefined)[], name: string): string | undefined {
  for (const shape of shapes) {
    const value = dig(shape, `txBody/bodyPr`)?.attrs[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

function shapeRuns(shape: Xml, inherited: Inherited, t: Transform): SourceRun[] {
  const body = child(shape, "txBody");
  if (!body) return [];
  const ph = placeholderOf(shape);
  if (ph && FURNITURE.has(ph.type)) return [];
  const layoutShape = ph && matchPlaceholder(inherited.layout, ph, true);
  const layoutPh = (layoutShape && placeholderOf(layoutShape)) || ph;
  const masterShape = layoutPh && matchPlaceholder(inherited.master, layoutPh, false);

  const frame =
    frameOf(dig(shape, "spPr/xfrm")) ??
    frameOf(dig(layoutShape, "spPr/xfrm")) ??
    frameOf(dig(masterShape, "spPr/xfrm"));
  if (!frame) return [];

  const chain = [shape, layoutShape, masterShape];
  const inset = (name: string, fallback: number) => num(bodyAttr(chain, name)) ?? fallback;
  const autofit = dig(child(shape, "txBody"), "bodyPr/normAutofit");
  const txStyles = child(inherited.master, "txStyles");
  const styleName = !ph
    ? "otherStyle"
    : masterType(ph.type) === "title"
      ? "titleStyle"
      : "bodyStyle";
  const styles = [
    child(body, "lstStyle"),
    child(child(layoutShape, "txBody"), "lstStyle"),
    child(child(masterShape, "txBody"), "lstStyle"),
    child(txStyles, styleName),
    child(inherited.presentation, "defaultTextStyle"),
  ];
  const box: Box = {
    frame,
    left: inset("lIns", DEFAULT_SIDE_INSET),
    right: inset("rIns", DEFAULT_SIDE_INSET),
    top: inset("tIns", DEFAULT_TOP_INSET),
    bottom: inset("bIns", DEFAULT_TOP_INSET),
    anchor: bodyAttr(chain, "anchor") ?? "t",
    scale: (num(autofit?.attrs.fontScale) ?? 100000) / 100000,
  };
  return bodyRuns(body, box, styles, inherited, t);
}

/** A table's cells, in row order, each laid out as a small text box. */
function tableRuns(frame: Xml, inherited: Inherited, t: Transform): SourceRun[] {
  const tbl = dig(frame, "graphic/graphicData/tbl");
  const outer = frameOf(child(frame, "xfrm"));
  if (!tbl || !outer) return [];
  const cols = children(child(tbl, "tblGrid"), "gridCol").map((c) => Number(c.attrs.w));
  const styles = [
    child(child(inherited.master, "txStyles"), "otherStyle"),
    child(inherited.presentation, "defaultTextStyle"),
  ];
  const runs: SourceRun[] = [];
  let y = outer.y;
  for (const row of children(tbl, "tr")) {
    const h = Number(row.attrs.h ?? 0);
    let x = outer.x;
    let col = 0;
    for (const cell of children(row, "tc")) {
      const span = Number(cell.attrs.gridSpan ?? 1);
      const w = cols.slice(col, col + span).reduce((a, b) => a + b, 0);
      const body = child(cell, "txBody");
      const pr = child(cell, "tcPr");
      if (body && cell.attrs.hMerge !== "1" && cell.attrs.vMerge !== "1") {
        const box: Box = {
          frame: { x, y, w, h },
          left: num(pr?.attrs.marL) ?? DEFAULT_SIDE_INSET,
          right: num(pr?.attrs.marR) ?? DEFAULT_SIDE_INSET,
          top: num(pr?.attrs.marT) ?? DEFAULT_TOP_INSET,
          bottom: num(pr?.attrs.marB) ?? DEFAULT_TOP_INSET,
          anchor: pr?.attrs.anchor ?? "t",
          scale: 1,
        };
        runs.push(...bodyRuns(body, box, styles, inherited, t));
      }
      x += w;
      col += span;
    }
    y += h;
  }
  return runs;
}

function groupTransform(group: Xml, t: Transform): Transform {
  const xfrm = dig(group, "grpSpPr/xfrm");
  const off = child(xfrm, "off");
  const ext = child(xfrm, "ext");
  const chOff = child(xfrm, "chOff");
  const chExt = child(xfrm, "chExt");
  if (!(off && ext && chOff && chExt)) return t;
  const rx = Number(chExt.attrs.cx) ? Number(ext.attrs.cx) / Number(chExt.attrs.cx) : 1;
  const ry = Number(chExt.attrs.cy) ? Number(ext.attrs.cy) / Number(chExt.attrs.cy) : 1;
  // A child's EMU c maps to off + (c - chOff) * r in the parent's frame, then through `t`.
  return {
    sx: t.sx * rx,
    sy: t.sy * ry,
    ox: t.ox + (t.sx * (Number(off.attrs.x) - Number(chOff.attrs.x) * rx)) / EMU_PER_PT,
    oy: t.oy + (t.sy * (Number(off.attrs.y) - Number(chOff.attrs.y) * ry)) / EMU_PER_PT,
  };
}

function groupRuns(node: Xml | undefined, inherited: Inherited, t: Transform, runs: SourceRun[]) {
  for (const kid of node?.kids ?? []) {
    if (kid.tag === "sp") runs.push(...shapeRuns(kid, inherited, t));
    else if (kid.tag === "grpSp") groupRuns(kid, inherited, groupTransform(kid, t), runs);
    else if (kid.tag === "graphicFrame") runs.push(...tableRuns(kid, inherited, t));
    else if (kid.tag === "AlternateContent") {
      // What a newer PowerPoint draws, else what an older one falls back to.
      groupRuns(child(kid, "Choice") ?? child(kid, "Fallback"), inherited, t, runs);
    }
  }
}

function themeFonts(files: Files, master: string | undefined): Inherited["fonts"] {
  const path = master && relOfType(relsOf(files, master), "theme");
  const scheme = dig(path ? parseXml(files, path) : undefined, "themeElements/fontScheme");
  return {
    major: dig(scheme, "majorFont/latin")?.attrs.typeface,
    minor: dig(scheme, "minorFont/latin")?.attrs.typeface,
  };
}

function unzip(data: Uint8Array, cap: number): Files {
  let tooBig: string | undefined;
  let files: Files;
  try {
    files = unzipSync(data, {
      filter: (file) => {
        if (file.originalSize > cap) tooBig ??= file.name;
        return !tooBig && /\.(xml|rels)$/.test(file.name);
      },
    });
  } catch {
    throw new ImportError("The file isn't a PowerPoint (.pptx) deck: it isn't a zip archive.");
  }
  if (tooBig) {
    throw new ImportError(
      `The deck's ${tooBig} unzips to over ${Math.round(cap / 1024 / 1024)} MB, which a real deck's XML never does.`,
    );
  }
  return files;
}

/**
 * Reads a PowerPoint deck's text as one page per slide (SDD-0003 §2). A slide
 * has no lines, only shapes, so each text shape's lines get a synthesised y.
 * A hidden slide has no page, and the others keep the numbers they would have.
 */
export function readPptx(
  data: Uint8Array,
  { from = 1, to, maxEntryBytes = MAX_ENTRY_BYTES }: PageRange & { maxEntryBytes?: number } = {},
): SourcePage[] {
  const files = unzip(data, maxEntryBytes);
  const presentation = parseXml(files, "ppt/presentation.xml");
  if (!presentation) {
    throw new ImportError(
      "The file isn't a PowerPoint (.pptx) deck: ppt/presentation.xml is missing.",
    );
  }

  const size = child(presentation, "sldSz");
  const width = Number(size?.attrs.cx ?? 0) / EMU_PER_PT;
  const height = Number(size?.attrs.cy ?? 0) / EMU_PER_PT;

  const rels = relsOf(files, "ppt/presentation.xml");
  const ridAttr = `${relsPrefix(presentation)}:id`;
  const slides = children(child(presentation, "sldIdLst"), "sldId").map((id, i) => {
    const rid = id.attrs[ridAttr] ?? "";
    const target = rels.get(rid)?.target;
    if (!target) {
      throw new ImportError(
        `Slide ${i + 1} of ppt/presentation.xml names relationship "${rid}", which ppt/_rels/presentation.xml.rels doesn't have.`,
      );
    }
    return target;
  });

  const pages: SourcePage[] = [];
  const last = Math.min(to ?? slides.length, slides.length);
  for (let number = Math.max(from, 1); number <= last; number++) {
    const path = slides[number - 1];
    const slide = parseXml(files, path);
    if (!slide) throw new ImportError(`The deck's slide ${number} (${path}) is missing.`);
    if (slide.attrs.show === "0") continue;
    const layoutPath = relOfType(relsOf(files, path), "slideLayout");
    const layout = layoutPath ? parseXml(files, layoutPath) : undefined;
    const masterPath = layoutPath && relOfType(relsOf(files, layoutPath), "slideMaster");
    const master = masterPath ? parseXml(files, masterPath) : undefined;
    const inherited: Inherited = {
      layout,
      master,
      presentation,
      fonts: themeFonts(files, masterPath || undefined),
    };
    const runs: SourceRun[] = [];
    groupRuns(dig(slide, "cSld/spTree"), inherited, ROOT, runs);
    pages.push({ number, width, height, lines: linesFromRuns(runs) });
  }
  return pages;
}
