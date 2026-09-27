// @vitest-environment node
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { readPdf } from "./pdf.ts";

/**
 * A generated two-column songbook page, never a real book's lyrics
 * (SDD-0003 §6). Drawn deliberately out of reading order: the right column
 * first, and a stanza's second half before its first. Page 2 has no text,
 * as a scan would not.
 */
async function songbook(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const roman = await doc.embedFont(StandardFonts.TimesRoman);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const page = doc.addPage([400, 600]);
  // pdf-lib's origin is bottom-left; the reader's is top-left.
  const draw = (text: string, x: number, top: number, font = roman) =>
    page.drawText(text, { x, y: 600 - top, size: 10, font });

  for (let i = 0; i < 4; i++) draw(`Right column line ${i + 1}`, 210, 100 + i * 15);
  draw("(1) A TEST SONG", 30, 70, bold);
  draw("a second", 83, 100);
  draw("This is", 30, 100);
  draw("Sung in italic", 30, 115, italic);
  draw("And one more line", 30, 130);
  draw("Last line here", 30, 145);
  doc.addPage([400, 600]);
  return doc.save();
}

let data: Uint8Array;
beforeAll(async () => {
  data = await songbook();
});

describe("readPdf", () => {
  it("reads lines with their position, size and font", async () => {
    const [page] = await readPdf(data.slice(), pdfjs, { to: 1 });
    expect(page).toMatchObject({ number: 1, width: 400, height: 600 });
    expect(page.lines[0]).toMatchObject({
      text: "(1) A TEST SONG",
      x: 30,
      y: 70,
      size: 10,
      font: "Times-Bold",
    });
    expect(page.lines.find((line) => line.text === "Sung in italic")?.font).toBe("Times-Italic");
  });

  it("puts lines in position order, one per column on each baseline", async () => {
    const [page] = await readPdf(data.slice(), pdfjs, { to: 1 });
    expect(page.lines.map((line) => line.text)).toEqual([
      "(1) A TEST SONG",
      "This is a second",
      "Right column line 1",
      "Sung in italic",
      "Right column line 2",
      "And one more line",
      "Right column line 3",
      "Last line here",
      "Right column line 4",
    ]);
  });

  it("reads only the pages asked for, and a page with no text as no lines", async () => {
    const pages = await readPdf(data.slice(), pdfjs, { from: 2 });
    expect(pages).toEqual([{ number: 2, width: 400, height: 600, lines: [] }]);
  });
});
