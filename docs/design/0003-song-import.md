# SDD-0003 — Song import

- **Status:** Accepted; case by case, a profile per book
  ([ADR-0024](../decisions/0024-import-case-by-case.md))
- **Date:** 2026-09-27
- **Decision:** [ADR-0018](../decisions/0018-import-songs-through-a-layout-aware-pipeline.md)

Turns a source document into a draft hymnbook in the content format
([SDD-0002](0002-content-format.md)), plus a report of what the importer was
unsure of. Command line first; the browser later, on the same code.

## 1. Shape

```mermaid
flowchart LR
    File[Source file] --> Reader
    Profile[(Profile)] --> Flow
    Reader -- "pages of lines" --> Flow --> Songs --> Parts --> Draft
    Draft --> Out[(imports/&lt;id&gt;/)]
    Draft --> Report
```

| Stage  | Does                                                                     | Lives in            |
| ------ | ------------------------------------------------------------------------ | ------------------- |
| Reader | One per source format. Bytes → pages of positioned, styled lines         | `src/import/read/`  |
| Flow   | Lines → reading order: page, column, top to bottom; drops page furniture | `src/import/`       |
| Songs  | Starts a song at each title; a song runs on across columns and pages     | `src/import/`       |
| Parts  | Blocks → stanzas and choruses; printer's line wraps joined               | `src/import/`       |
| Draft  | Numbers, titles, sequence, `hymnbook.json`; checked by `validate.ts`     | `src/import/`       |
| CLI    | Arguments, file I/O, writing the draft and report                        | `scripts/import.ts` |

Everything in `src/import/` is pure TypeScript with no Node or DOM import,
like `src/domain/`, so the browser can run it unchanged. Readers may depend
on a library (pdf.js runs in both); only the CLI touches the file system.

## 2. The reader contract

```ts
interface SourceLine {
  text: string;
  /** Left edge and baseline, in points, origin top-left. */
  x: number;
  y: number;
  width: number;
  size: number;
  /** The line's dominant font, e.g. "TimesNewRomanPS-ItalicMT". */
  font: string;
}

interface SourcePage {
  number: number; // 1-based
  width: number;
  height: number;
  lines: SourceLine[]; // top to bottom, then left to right
}
```

**Lines from runs** (`src/import/source.ts`, shared by every reader that
has positions). Content-stream order is not trusted: runs on one baseline
are one line, with a space where the gap is wider than 0.15 em, unless a
column gutter falls between them. No gap width tells a gutter from a word
space: justified lines in _Hymns of Fellowship_ stretch a space to 1.6 em,
and its narrowest gutter is 1.5 em. A gutter is instead found per page as a
vertical band no text crosses, with text beside it on three or more
baselines; one stray run across it (a folio) is tolerated. Its right edge,
where the next column starts, is where a baseline splits. On that book's
98 song pages this merges no line across columns and splits none within
one.

**PDF** (pdf.js, `getTextContent`), passed pdf.js rather than importing it:
Node and Bun want its legacy build, a browser its default one. A PDF whose
permissions forbid copying text is refused, as is a password-protected
one. `font` is the PostScript name with the subset prefix stripped
(`OYCPPR+TimesNewRomanPS-ItalicMT` → `TimesNewRomanPS-ItalicMT`); one font
often appears under several subsets. pdf.js resolves names only after the
page's operator list is loaded.

A document that yields no text (a scan), or text outside the profile's
`script`, is reported and not imported: it needs OCR, a later reader.

## 3. The profile

What differs between books is data, one JSON file per book in
`import-profiles/`, passed on the command line. It holds no lyrics, so it is
committed. Unknown fields fail, as in the format.

A profile is required, written from `bun run import`'s font table. A book
that needs more than a profile can say gets a script of its own beside the
shared stages (ADR-0024); nothing is inferred.

```json
{
  "hymnbook": { "id": "…", "title": "…", "language": "en", "script": "Latn" },
  "pages": { "from": 7, "to": 104 },
  "index": { "pages": { "from": 3, "to": 6 } },
  "furniture": { "pageNumber": true },
  "title": {
    "pattern": "^\\(?(?<number>\\d+)\\)\\s*(?<title>.+)$",
    "font": "TimesNewRomanPS-BoldMT"
  },
  "chorus": { "font": "TimesNewRomanPS-ItalicMT" },
  "labels": { "chorus": "chorus", "bridge": "bridge", "end": "outro" },
  "stanzaGap": 1.3
}
```

The rules the stages apply with it:

- **Columns** are found per page by their gutters (§2); a page with fewer
  than most is split where most are. A line that is only a number is the
  folio, when `furniture.pageNumber` is set.
- **A song** starts at a line matching `title.pattern` in `title.font`, and
  runs on across columns and pages. A heading that wraps, in the same font,
  is joined.
- **Blocks** split where the gap exceeds `stanzaGap` × the book's line
  pitch. At the top of a column the gap can't be seen, so the halves are
  joined when a wrap runs across the break, or when together they are as
  long as the song's other blocks.
- **Labels** in `labels`, however punctuated ("Chorus:", "(chorus)",
  "Chorus…"): heading lines, they give them their kind; alone or closing a
  block, they stand for that part sung again.
- **Kind**, unlabelled: a block wholly in `chorus.font` is a chorus,
  else a stanza. A block printed again word for word is the same part.
- **Wraps** are joined where the next line's first word would not have fitted
  on this one, against the column's widest line. Before a lowercase word
  that is sure; before a capital, only a short remainder after unpunctuated
  text is joined, as a guess.
- **Sequence** is as printed when the page spells it out: a label, or
  choruses printed more than once. Otherwise
  [ADR-0009](../decisions/0009-migrate-the-corpus-by-rule.md)'s rule: the
  chorus, printed once (several blocks in a row count as one), is sung
  first if printed first, and after every stanza.
- **Title**: the index's, where it names the same song as the heading
  (indexes are set in the book's case, headings often in capitals); else
  the heading, its capitalised words recased from the song's own lines.
- Repeat marks ("(2)", "(repeat)") stay in the line as printed.

## 4. The report

Nothing uncertain is decided silently; each is written to `report.md` beside
the draft, by hymn:

- any `validate.ts` violation in the draft
- text before the first title, or a title with nothing under it
- a number missing, duplicated, or out of order
- the index disagreeing with the page: title, page number, or a song not
  found
- a block split by a column break, joined or kept apart, when not certain
- a block in mixed fonts, so neither clearly stanza nor chorus
- a sequence taken from a rule beside a bridge or ending, or choruses that
  differ
- a line wrap joined (both halves quoted; guesses marked)
- a repeat mark kept as printed

### 4.1 The judge: an optional second opinion

Most report items are small typed questions about a little evidence:
"chorus or stanza?", "does this line continue the one above?", "is this
line a title?", "does this column continue the song before it?". Decision
models such as Laya answer exactly that shape: a state plus typed questions
in (`choice`, `score`, `noul` for yes/no), calibrated probabilities out.

The stages ask a `Judge`, and the default judge is the profile's rules.
A model judge is consulted only for questions the rules marked uncertain,
never for every line. Its answer changes the draft only above a threshold,
and every answer is still written to the report with its probability: it
informs the review and never replaces it (arc42 §8.6).

```ts
type Question =
  | { kind: "choice"; ask: string; options: string[] }
  | { kind: "noul"; ask: string };

interface Judge {
  /** One batch per song; answers in question order, with probabilities. */
  decide(
    evidence: object,
    questions: Record<string, Question>,
  ): Promise<Answers>;
}
```

Laya, as surveyed on 2026-09-27:

| Build                         | Size (with 34 MB tokenizer) | Licence    |
| ----------------------------- | --------------------------- | ---------- |
| `laya-multilingual`, official | 644 MB safetensors          | Apache-2.0 |
| Community ONNX, fp16          | 681 MB                      | Apache-2.0 |
| Community ONNX, int8          | 366 MB                      | Apache-2.0 |
| Community ONNX, int4          | 221–240 MB                  | Apache-2.0 |

The multilingual checkpoint (mmBERT-base, 322M) is the first candidate:
faster than the English one and trained across 100+ languages. Runtime is
ONNX Runtime (MIT): `onnxruntime-node` for the CLI, `onnxruntime-web`
(WASM or WebGPU) for the browser. No official small, static or distilled
build exists. The community builds are days old and unvetted, so we
quantise the official weights ourselves, with a script, rather than depend
on one.

**The model is swappable.** Nothing outside the judge names a model:

- **Stages know only `Judge`.** Questions are plain text and options, not
  one model's prompt format.
- **An adapter per model family** turns `evidence` and `questions` into that
  family's input and its output back into `Answers`. Laya is the first; a
  fine-tuned Laya or another local decision model would be another.
- **A manifest names the model**, never the code: adapter, weights path or
  URL, SHA-256, licence, and the languages it was checked on. The CLI takes
  `--judge <manifest.json>`; the browser downloads whatever the manifest
  names. Swapping models is swapping a manifest.
- **One evaluation set judges them all:** questions with known answers,
  drawn from our own fixtures and from reviewed drafts. A model is adopted
  when it beats the rules on it, and the score is recorded in the manifest.

**Not a bottleneck, by construction:**

- The rules run first and the judge sees only their uncertain cases,
  batched per song. At the published CPU figure (about 140 ms for three
  questions), a book with 1,000 open questions takes about a minute.
- The model is never a dependency of the build or the app. In the CLI it
  is a flag (`--judge <manifest>`) and an optional dependency. In the browser it
  is an opt-in download cached on the device, never precached with the
  app.
- Without it, the import works the same and the report just holds more
  open questions.

**Local, and never generative.** A judge runs on the machine doing the
import and only picks among typed options; it never writes or rewrites a
lyric. No hosted service and no LLM (Claude included) is part of the
pipeline: lyrics must not leave the device (ADR-0018). Jev, the hosted
original, is excluded for that reason. Claude may help build the pipeline,
tune a local model such as Laya, and review results during development;
its output is never an import stage. A distant-future exception would need
its own ADR.

`OPEN:` whether the judge beats the rules on real books. The rules come
first (§3); the model is added only if the report from a real book shows
questions the rules cannot answer.

## 5. Output

`bun run import <file> [--pages 5-12]` prints each line with its position,
size and font, then every font with a sample: what a profile is written
from. With a profile,
`bun run import <file> --profile <profile.json> [--out <dir>]` writes
`imports/<id>/`: `hymnbook.json`, the `NNNN.json` files and `report.md`,
replacing a previous draft's files there.
`imports/` is gitignored. A reviewed draft is moved into `content/` by hand,
and only once its rights allow (arc42 R2). In practice that means
public-domain books shipped as samples
([ADR-0020](../decisions/0020-present-songs-do-not-publish-them.md)).

The app (#28) never runs the import; it loads a format 1 file, a reviewed
draft, into the device's own store (ADR-0024),
which assigns its key, records source and song hashes, and handles a file
or book it already holds
([ADR-0021](../decisions/0021-identify-books-by-the-store-that-holds-them.md)).

## 6. Testing

Fixtures are PDFs generated by the test itself, never a real book's lyrics.
Stages below the reader are tested on `SourcePage` values directly.

## 7. The first book

_Hymns of Fellowship_ (Bethesda Assembly, Thane): English, 104 pages,
InDesign, two columns, text extractable. It is the target of #27 and would
be the app's second hymnbook. No Malayalam PDF is available, so Malayalam
import is untested.

First draft (2026-09-27), in 4 s: 275 songs, numbered 1–275 without a gap,
each in the index on its page; 178 with a chorus, 26 with a bridge; valid
content. 1,017 notes, 786 of them wraps: its columns are 157 pt wide. Two
PDFs of it exist; their drafts are identical, and the reports differ in one
line, the older index listing #165 on the wrong page.

`OPEN:` Malayalam PDFs with legacy fonts; OCR; the other readers.
