# 0018 — Import songs through a layout-aware pipeline, command line first

- **Status:** Accepted
- **Date:** 2026-09-27

## Context and Problem Statement

Songs reach us in many formats: PDF, EPUB, MOBI, AZW, FB2, RTF, HTML, TXT,
scans (PNG, JPEG, CBZ, CBR, DjVu), and music formats that carry lyrics
(MusicXML, ABC, MIDI, LRC). We want to import them, one song or a whole
hymnbook, in two ways:

1. **A command-line tool** that anyone can run to produce a hymnbook in our
   format ([SDD-0002](../design/0002-content-format.md)).
2. **In the browser**, on the user's own device, into a local library the
   Operator can present from.

Two findings from a spike on a real two-column songbook PDF (InDesign, 104
pages) shaped the decision:

- **Converting the format is the easy part.** The hard part is structure:
  where a song starts, its number and title, which block is a refrain, and
  which line breaks are only the printer's wraps. In that book the refrain
  is marked by nothing but its font, stanzas by a wider vertical gap, and
  songs run on across columns and pages.
- **Plain text loses exactly those clues.** `pdftotext` and a
  convert-to-text step (Calibre, Pandoc) keep the words and drop the fonts
  and positions. pdf.js keeps them: every run of text comes with its
  position, size and font.

Most formats on the list collapse into three sources: **text with layout**
(PDF, EPUB, HTML, FB2, RTF, TXT), **pixels** (scans, which need OCR) and
**structured song formats** (MusicXML, ABC, LRC, and worship software
exports).

Licences of the candidate libraries (checked on npm, 2026-09-27):

| Library                             | Licence         | Use                                       |
| ----------------------------------- | --------------- | ----------------------------------------- |
| pdf.js (`pdfjs-dist`)               | Apache-2.0      | PDF text with positions and fonts         |
| PDFium wasm                         | MIT             | Alternative PDF engine                    |
| tesseract.js                        | Apache-2.0      | OCR, Malayalam included                   |
| foliate-js                          | MIT             | EPUB, MOBI, FB2, CBZ                      |
| fflate                              | MIT             | Zip, for EPUB and CBZ                     |
| mammoth                             | BSD-2           | DOCX                                      |
| Laya (weights), ONNX Runtime        | Apache-2.0, MIT | Optional, swappable judge — SDD-0003 §4.1 |
| MuPDF (`mupdf`)                     | AGPL-3.0        | **Excluded**, incompatible with ADR-0016  |
| Calibre, Poppler, Pandoc, DjVuLibre | GPL             | External programs only; never bundled     |

## Considered Options

- **A converter in front:** turn every format into plain text with an
  existing tool, then split the text into songs.
- **A layout-aware pipeline:** each format's reader produces positioned,
  styled lines; one shared stage splits those into songs, guided by a
  per-book profile.
- **No importer:** type songs in by hand.

## Decision Outcome

Chosen: **a layout-aware pipeline, built on the command line first.**

- **Readers** are thin, one per source format, and produce the same thing:
  pages of lines with position, size and font. PDF comes first, via
  pdf.js.
- **The shared stage** turns lines into draft hymns. It is pure TypeScript
  with no Node or DOM dependency, so the browser can run it unchanged.
- **A profile per book** describes its layout: the title pattern, which
  font marks a refrain, the column count. It is data, not code, as a new
  hymnbook is ([arc42 §2.3](../architecture/arc42.md)).
- **Output is a draft** in our format plus a report of everything the
  importer was unsure of. A human reviews it, and `validate.ts` checks it,
  as [ADR-0009](0009-migrate-the-corpus-by-rule.md) already does for the
  migration. The importer infers structure; it never claims the draft is
  right.
- **Dependencies must be permissive** (Apache-2.0, MIT, BSD, ISC) to be
  bundled. GPL tools may be called as separate programs by the command
  line tool, never bundled and never in the browser. AGPL is excluded.
- **DRM is not removed.** A protected file is rejected with a message.

**The browser path is the goal; the command line comes first.** Most books
worth importing are under copyright, and the project has no right to
redistribute them (arc42 R2). A song or book imported in the user's own
browser stays there: it is never uploaded, never committed, never deployed.
That is what makes importing copyrighted books possible at all. The command
line tool is for development and for books whose rights allow publishing;
the shared stage it runs is the same code the browser will run.

The browser path waits on two things the app lacks: a review screen, which
is the in-app editing arc42 §3.3 still defers and will need its own ADR,
and more than one book on a device, including loose songs that belong to
no book.

**No hosted or generative model is part of an import**, Claude included.
Only local decision models that pick among typed options may help
(SDD-0003 §4.1); lyrics never leave the device.

A converter in front was rejected because it discards the only clues the
structure is recoverable from. Typing by hand stays the fallback for a
single song.

### Consequences

Good:

- Each new format is one small reader; the difficult logic is written once.
- The same code runs in Bun now and in the browser later.
- Profiles make a new book's layout a data change.

Bad:

- Every book needs a profile, and a review pass. There is no fully
  automatic import.
- **Malayalam PDFs are the unproven case.** Many use legacy non-Unicode
  fonts or broken character maps, which extract as garbage. Those need OCR
  or a font map. No Malayalam PDF is available; the first book imported is
  English (SDD-0003 §7).
- Imported lyrics carry their source's copyright. A book produced for
  distribution needs the rights record of
  [SDD-0001 §8](../design/0001-domain-model.md#8-open-questions) (arc42
  R2). An import kept on the user's own device is their own copy.

Neutral:

- OpenLyrics was considered as an exchange format and not adopted: it is
  little used outside OpenLP. Ideas may be borrowed from it.
