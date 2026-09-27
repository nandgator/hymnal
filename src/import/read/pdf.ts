import type * as PdfJsModule from "pdfjs-dist";
import type { PDFPageProxy } from "pdfjs-dist";
import { fontKey, ImportError, linesFromRuns, type SourcePage } from "../source.ts";

/**
 * The parts of pdf.js the reader uses. Passed in rather than imported: Node
 * and Bun want pdf.js's legacy build, a browser its default one.
 */
export type PdfJs = Pick<typeof PdfJsModule, "getDocument" | "PermissionFlag" | "Util">;

/** A run of text, as opposed to the marked-content items beside it. */
type TextItem = Extract<
  Awaited<ReturnType<PDFPageProxy["getTextContent"]>>["items"][number],
  { str: string }
>;

export interface PageRange {
  /** 1-based, inclusive. Default: the first page. */
  from?: number;
  /** 1-based, inclusive. Default: the last page. */
  to?: number;
}

/** Reads a PDF's text as pages of positioned, styled lines (SDD-0003 §2). */
export async function readPdf(
  data: Uint8Array,
  pdfjs: PdfJs,
  { from = 1, to }: PageRange = {},
): Promise<SourcePage[]> {
  const task = pdfjs.getDocument({ data, verbosity: 0 });
  const doc = await task.promise.catch((error: unknown) => {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new ImportError("The PDF is password-protected, so it can't be imported.");
    }
    throw error;
  });

  try {
    // Protection is honoured, never worked around (ADR-0018).
    const permissions = await doc.getPermissions();
    if (permissions && !permissions.has(pdfjs.PermissionFlag.COPY)) {
      throw new ImportError("The PDF's permissions forbid copying its text.");
    }

    const pages: SourcePage[] = [];
    const last = Math.min(to ?? doc.numPages, doc.numPages);
    for (let number = Math.max(from, 1); number <= last; number++) {
      pages.push(await readPage(await doc.getPage(number), pdfjs));
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

async function readPage(page: PDFPageProxy, pdfjs: PdfJs): Promise<SourcePage> {
  // Top-left origin, crop box and page rotation applied.
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  // Loading the operator list loads the fonts, which is what gives them names.
  await page.getOperatorList();

  const runs = content.items
    .filter((item): item is TextItem => "str" in item && item.str.trim() !== "")
    .map((item) => {
      const [, , c, d, x, y] = pdfjs.Util.transform(viewport.transform, item.transform);
      return {
        text: item.str,
        x,
        y,
        width: item.width,
        size: Math.hypot(c, d),
        font: fontName(page, item.fontName),
      };
    });

  page.cleanup();
  return {
    number: page.pageNumber,
    width: viewport.width,
    height: viewport.height,
    lines: linesFromRuns(runs),
  };
}

/**
 * The font's PostScript name, without its subset tag. Failing that, pdf.js's
 * own id, which still tells fonts apart; its `fontFamily` ("serif") would not.
 */
function fontName(page: PDFPageProxy, id: string): string {
  const font = page.commonObjs.has(id) ? page.commonObjs.get(id) : undefined;
  return fontKey(typeof font?.name === "string" ? font.name : id);
}
