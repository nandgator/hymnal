# Plan

Live control document. **Read first, update last.** Everything else in `docs/`
is reference; this is state. If the two disagree, this file is wrong — fix it.

## Workflow

The loop, for anything bigger than a typo: an idea from either side → reasoned
through relentlessly, together, until we share understanding — not until either
side settles for less — → the relevant ADR/SDD/PLAN updated first → built in
parts, user reviewing each → next Board item, repeat until the hymnal is built.

## Session protocol

1. Read this file.
2. Read only the ADR/SDD sections named by the task you pick up. Do not
   re-derive settled decisions.
3. Do the work. Run `bun run check`.
4. Update **Now**, **Board** and **Log** before finishing.

### Rules for editing this file

- One line per entry. Needs a paragraph? It belongs in an ADR or SDD, not here.
- Never restate a decision. Link it.
- Delete finished Board items — the Log is the history.
- Log: newest first, one line each, trim below 12 entries.
- Target length: 120 lines. Over that, something is in the wrong place.

## Now

**Beta track** (Board #43–52): all done but #50, which waits on a real device;
the beta may go before it, iOS marked untested. The sample (#43) is released as
`sample-1` and offered once the deploy runs from a push. The origin is live
(hymnal.sagaveracity.com, ADR-0030).

**Phase 1's app is done**: #20, the keymap, was its last item (SDD-0001 §16.5).
**Board #28 is done**: ADR-0026/0027, SDD-0004, all six parts. The songs have
left the repository; every book, the Malayalam one included, is loaded as a
container through the Library. Rewriting history to drop the songs from old
commits is the maintainer's own later step (ADR-0026). #27 part 6, the Laya
judge, runs last, on another machine or a Codespace (this one is short of
memory).

**Board #27 (song import, CLI)**: it touches no UI. Target: _Hymns of
Fellowship_ (`Song Book Final.pdf`; `Songs.pdf` differs only in its index), the
second hymnbook; its draft stays in `imports/` until its rights are known. Spec:
ADR-0018, ADR-0019, SDD-0002 (format v1), SDD-0003 (import). Parts:

1. ~~Format v1: `format: 1`, unknown fields rejected, other formats refused~~ —
   done
2. ~~PDF reader (pdf.js) → `SourcePage`, gutters found per page;
   `bun run import` prints lines and fonts~~ — done
3. ~~JSON Schema for format 1 (ADR-0022): `validate.ts` reads its fields from
   it; ajv test keeps them agreed~~ — done
4. ~~Flow, songs, parts, draft, report against a profile (SDD-0003 §3)~~ — done;
   275 songs, 1,017 notes (1,030 now)
5. ~~Review the Fellowship report by section~~ — done: titles, fonts, sequences,
   index, breaks; applied rules sampled clean; wraps by sample (an "I"/"&" line
   joins only at 4 words or fewer; sure joins counted, guesses listed). Hand
   fixes (#44, #81, #85, #197), applied once after the last re-import, are
   listed in the draft's `HAND-FIXES.md`, which a re-import leaves alone
6. **Last of all**, on another machine or a Codespace. Judge, swappable by
   manifest; Laya first (SDD-0003 §4.1). Found so far: the kind of a short
   unlabelled block (bridge, tag, a split stanza; 20 in Fellowship). Triage and
   inference were dropped: case by case (ADR-0024)

## State

| Area    | Status                                                                   |
| ------- | ------------------------------------------------------------------------ |
| Docs    | arc42 + 30 ADRs + SDD-0001–0006; design principles noted                 |
| Tooling | bun, biome, prettier, markdownlint — `bun run check` green               |
| App     | Vite + SolidJS + TS scaffolded; vitest chosen as test runner             |
| Domain  | Types, Sequence Engine, validation (`src/domain/`) — pure, tested        |
| Corpus  | 1,631 hymns migrated; kept on the maintainer's machine, not in git       |
| Content | Books load as containers through the Library; nothing ships (ADR-0026)   |
| Persist | Content store (SQLite/OPFS, worker) + user state (idb) — SDD-0001 §10-11 |
| UI      | Library → Finder → Operator + Output window, MD3 — SDD-0001 §12-16       |
| Deploy  | GitHub Actions → GitHub Pages, PWA shell, offline — SDD-0001 §15         |

## Board

Ordered. Top unblocked item is next.

| #   | Task                                                                                                                                                                                                      | Blocked by          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 55  | Presenter motion: the tonal card glides on a wrap (last part to first and back); no jerk when the lyrics scroll one way and the card moves the other                                                      | —                   |
| 58  | Assorted Hymns: a book the person owns for single songs; favourites and queues are lists of songs, not books (with #22). Shape when it starts                                                             | —                   |
| 27  | Song import, CLI: PDF first (ADR-0018, SDD-0003)                                                                                                                                                          | —                   |
| 50  | Real-device pass: iOS Safari, Android Chrome, installed and tab, offline, eviction; the #31 and #41 hardware checks                                                                                       | maintainer: devices |
| 14  | CMS for managing hymnal content (add/edit hymns, hymnbooks)                                                                                                                                               | —                   |
| 15  | Transliteration: search and display across scripts (ADR-0014)                                                                                                                                             | —                   |
| 16  | Feedback and corrections from users — where collected: TBD                                                                                                                                                | —                   |
| 17  | About: acknowledgements, copyright, credits                                                                                                                                                               | —                   |
| 18  | Over-the-air update notices (as Supabase announces changes)                                                                                                                                               | —                   |
| 19  | Picker hymnbook scope: swap book + hymn in one step (SDD §16.4)                                                                                                                                           | —                   |
| 22  | Service queue: line up hymns for a service (a supporting pane)                                                                                                                                            | —                   |
| 23  | Arrangements: reorder parts, repeat a part, a line or a run of lines; saved per song (SDD-0001 §8 note)                                                                                                   | —                   |
| 24  | Lyrics interchange (OpenLyrics, LRC); timing per recording                                                                                                                                                | Phase 2             |
| 25  | Stage outputs for musicians: lyrics + chords, score, notation                                                                                                                                             | content             |
| 37  | Interface languages and right-to-left: UI strings translated, mirrored layout                                                                                                                             | —                   |
| 38  | Search across books: one query over every loaded book (SDD-0001 §16)                                                                                                                                      | —                   |
| 40  | Typo-tolerant search: near matches ranked after exact ones (FTS5 is prefix-only today)                                                                                                                    | —                   |
| 41  | One-screen presenting: built (SDD-0001 §16.7); waits for the maintainer's check on GNOME Wayland and the keys' feel                                                                                       | —                   |
| 42  | Test suite speed (note): split App.test.tsx by area and use fake timers for its real waits; then isolate:false only for the DOM-free files, never globally (module-level state in channel.ts and friends) | —                   |

Phase 1's app is done (#20 the last); 27 is a build-time tool beside it. The
songs have left the repo (#28 done): nothing is bundled, and every book comes in
through the Library (ADR-0026). 14–15 sit past the scope guard below. 16–25 are
notes, not scheduled: the shell reserves room for them (DESIGN.md § Structure).
37–42 were added from the maintainer's feedback and are not yet scheduled. 43–51
come before the beta, in order; 47–49 may run beside 44–46.

## Invariants

Breaking these breaks the design. Check before deviating.

- Domain layer imports no UI framework —
  [ADR-0005](decisions/0005-use-solidjs.md)
- Content validated at build time, never repaired at runtime —
  [arc42 §8.6](architecture/arc42.md)
- A reviewed book's source is corrected in place, never regenerated wholesale —
  [ADR-0026](decisions/0026-songs-leave-the-repository.md)
- Stored sequence never mutated; a jump moves, only a repeat inserts —
  [SDD-0001 §5.1](design/0001-domain-model.md)
- A new hymnbook is data, not code — [arc42 §2.3](architecture/arc42.md)
- Nothing leaves the device unless the user sends it —
  [ADR-0030](decisions/0030-security-a-local-first-threat-model.md)
- Audio, sync, projector, native wrapper deferred — ADR-0006, 0010, 0011

## Scope guard

Phase 1 is: hymnbook selector, dynamic presentable hymnal, reworked persistence.
Single-device. Nothing else.

If a task seems to need sync, audio, a projector or a native wrapper — it
doesn't. Re-read the deferral ADR before acting.

## Open questions

Full list in [`docs/decisions/README.md`](decisions/README.md). Blocking ones
only, here:

| Question                          | Blocks                                |
| --------------------------------- | ------------------------------------- |
| Lyrics copyright / redistribution | The shipped sample (#43), not the app |

## Log

- 2026-10-07 — #56 done: expanding or collapsing a group glides its width
  (`areaGlide.ts`) instead of a View Transition, whose two snapshots doubled the
  text and could draw a garbage frame mid-resize; Recents rows a filled riser
  passes stay in view (a regression from 29f538e)
- 2026-10-07 — #54 done: About is the last section of Settings (the command
  "About" opens it there); Keyboard Shortcuts from the search is a page of the
  Search sheet; a closed sheet forgets its page; Copy Diagnostics answers in a
  snackbar
- 2026-10-07 — #53 and #57 done: review and Restore sheets hug their content
  once read; no notice when a review is cancelled; the source check is withdrawn
  (ADR-0029); keymap entries carry a scope, the Output forwards only
  presentation keys, and Present Here swallows the Operator's own (N moved the
  workspace over the audience's view); Hold says to Go Live first
- 2026-10-07 — Decided by the maintainer: About is the last section of Settings;
  the sample button stays Try the Sample; Blank arms before live, Hold waits for
  it; the source check (ADR-0029 point 4) is withdrawn from the app and the CLI:
  it reassures falsely for text pasted twice, and cries wolf for several songs
  or a repeated chorus; whoever used an AI reads the result against the
  original. Sample titles: "The Otterbein Hymnal — A Sample", സാമ്പിൾ ഗാനങ്ങൾ;
  released as sample-2
- 2026-10-07 — #43 done: two sample books (28 Otterbein hymns, 2 Malayalam
  songs) written by `scripts/sample-sources.ts`, packed, and published as the
  `sample-1` release; the deploy fetches them by `sample/SHA256SUMS`, and the
  empty Library offers Try the Sample (SDD-0004 §16). Rights:
  `docs/sample/RIGHTS.md`. A server's Content-Encoding on the `.gz` is undone in
  the app
- 2026-10-07 — Fixed, found by WebKit's first local e2e run (podman, the
  Playwright image): a Safari private window answers `getDirectory()` with
  `UnknownError` and showed the error screen; it is now a refusal and books are
  held in memory (SDD-0004 §15). All 30 e2e pass on the three engines
- 2026-10-07 — Decided by the maintainer: the sample is the 28 English hymns and
  only the 2 Malayalam songs with a full rights record (the other 18 wait on a
  first-publication date). Built locally, uploaded as a GitHub Release asset,
  fetched by the deploy and checked against a SHA-256 in the repo; offered in
  the Library and loaded like any file (ADR-0026). Rights live on a page beside
  the books, so format 1 stands. The beta's origin is hymnal.sagaveracity.com on
  GitHub Pages (ADR-0030). #50 waits for devices. The fork is detached
- 2026-10-07 — #51 done: App's placement-grace tests hold the grace timer and
  fence on the App having handled the report; the recents check and the Hold
  replay wait for the outcome, not 50 ms. channel.test was already fenced
  (d6453b8); Presenter's "repeats in place" only exceeds its timeout under
  extreme load (about 400 ms of 5 s), with no race, so it is left as is
- 2026-10-06 — Fixed, found by #52: a first load or restore no longer waits on
  `persist()`, which Firefox answers with a prompt; the ask runs alongside and
  the keep-the-file note comes when it is refused (SDD-0004 §9)
- 2026-10-06 — #52 done: Playwright against the built app, Chromium, Firefox and
  WebKit at 390x844 and 1280x800 (first load with no CSP violation, load and
  search, Output, a private window, a backup round trip); CI's deploy needs it.
  Chromium and Firefox pass here; WebKit lacks system libraries on this machine
  and runs first in CI. Found: Firefox's `persist()` prompt stalls the first
  load until it is answered
- 2026-10-06 — #48 and #49 done: About, after Library, with the build, the
  privacy statement, Your books, Copy Diagnostics (counts only, no titles or
  lyrics) and Report a Problem (`REPORT_URL`: the repo's issues, the
  maintainer's choice; Issues must be on before the beta), and credits
- 2026-10-06 — #47 done: a CSP in the built page with no inline script or style
  (four static styles moved to CSS); every SQLite connection defensive, schema
  untrusted; `bun audit` in CI, ignoring only seroval (Solid's server
  serializer, not shipped, tested) and braces (lint tooling)
- 2026-10-06 — #46 done: Back Up and Restore… in Settings; Load Books knows a
  backup by its content and refuses one picked with books or for Load Again; the
  restore sheet gives each book its verdict, Keep this device's by default in a
  conflict; settings and recents apply live, the position at the next start
- 2026-10-06 — #46 part A, the backup engine: one `.hymnal` zip written and read
  in the worker; each book's schema matched exactly against the app's own and
  rebuilt by `packageRows`; sizes capped per entry and in all; recents merged.
  Part B is the Settings section and the restore sheet
- 2026-10-06 — #45 done: where OPFS is refused, books are held in memory for the
  window, and the Library says so; a pool held by another tab stays an error.
  Decided by the recommendation, for the maintainer to review: a tab whose books
  are in memory warns on the gate that Use Here loses them, rather than refusing
  to let go (SDD-0004 §15)
- 2026-10-06 — #44 done: user state checked field by field and kept in memory
  when refused; a root error screen (Reload, Copy error details with no lyrics,
  Reset); a failed Output goes blank and the Operator offers Reopen. #52 added:
  plain Playwright on three engines, not an LLM-driven runner (lyrics stay on
  the device; the flows are few and specified)
- 2026-10-06 — #43 sample, decided by the maintainer: about 25 well-known
  English hymns from the Otterbein Hymnal (1890, Project Gutenberg #16455), and
  Malayalam songs from the corpus whose writers died before 1956, each with a
  rights record; free in India, the EU and the US
- 2026-10-06 — Decided by the maintainer: the app does not police what users
  load (a tool; ADR-0020); copyright gates only the public-domain sample the app
  ships (#43). #46 backup: every loaded book plus user state in one `.hymnal`
  file (a zip); Restore merges through the duplicate review (SDD-0004 §8); Back
  Up and Restore in Settings, and Load Books recognises a backup
- 2026-10-05 — Loading a large book: the write is about three times faster
  (prepared statements, a song at a time), and the review sheet and the Library
  row show a determinate bar with the phase and count after 300 ms; a save has
  no Cancel and the sheet may be closed meanwhile (SDD-0004 §14)
- 2026-10-04 — Board #21 Hold: the Output frozen on what it shows while the
  Operator browses; Release sends the current; Shift+H, a button beside Blank, a
  command (SDD-0001 §16.6)
- 2026-10-04 — #41 built: Present here (a button, Shift+P, the command) shows
  the Output's view fullscreen in the app tab; a quick switcher on Ctrl+K; F or
  Esc leaves; no notices meanwhile; not offered while an Output window is open
  (SDD-0001 §16.7)
- 2026-10-04 — Settings: Presentation's layout is a choice (Part by part | Whole
  song) with only the chosen layout's settings under it; nesting at most one
  level, nothing depends on an off (SDD-0001 §16.1)
- 2026-10-04 — Presentation: Full Song never draws a pinned chorus over its
  columns; dependent settings nested (Pin the chorus, Fade); Part labels and the
  part cue merged into Show parts; plain-language copy for every setting
- 2026-10-04 — Feedback: the Finder's first songs follow the scope; From Text
  suggests a language from the script; Go Live waits for a book; "Bring a
  songbook"
- 2026-10-04 — Feedback: Full Song prints the chorus on every page that sings it
  (SDD-0005 § 3); End Live closes the Output window (the "ended" state is gone;
  Blank keeps the window), SDD-0001 §16.4
- 2026-10-03 — Library feedback: a chosen book aims the Finder (the crumb keeps
  the song's book); Load Books queue with Back/Next; the Finder lists a book's
  first songs; plainer empty state and source field; Manage Books gone
- 2026-10-03 — Feedback: Full Song's page turn a dissolve and its tint follows
  the page; part labels; a zoom between layouts; End Live (Shift+E); Back to
  Current offered from the start and glides
- 2026-10-03 — #28 done: part 6 landed after the maintainer loaded the Malayalam
  container on the same origin and the shipped copy was adopted as loaded, same
  key, Recents kept
- 2026-10-02 — #28 part 6 prepared, waits for the maintainer's load: `content/`
  removed from the tree and ignored, `build:content` out of the deploy (the
  script stays, taking a directory), `migrate-legacy` and the corpus test gone,
  `SHIPPED_BOOK_IDS` empty, `ensureInstalled` fetches nothing. Branch
  `board-songsleave`, not landed
- 2026-10-02 — #36 done: a second tab shows "Hymnal is open in another tab" with
  Use Here; the store is owned through a Web Lock (`src/shell/tabLock.ts`,
  `TabGate`), released on request unless an Output is live; SDD-0001 §10.4
- 2026-10-02 — #34 done: the Library's From Text (a sheet with the book's
  fields, song text and optional source text; parse errors with line numbers;
  the same review and buttons through an in-memory container; the source check
  in the review); the container writer moved to `src/import/container.ts`
- 2026-10-02 — #28 part 5: the Library (list, choose, load with the review,
  remove, Load Again aimed at a book, the keep-your-file note), `openBook`,
  error colours; `hymnalDev` keeps only its OPFS inspector; SDD-0004 §9
- 2026-10-02 — #35 done: `bun run text` (parser `src/import/songtext.ts`, source
  check `src/import/sourcecheck.ts`, both pure) writes a format 1 directory for
  `pack`; #34's app part waits for the Library
- 2026-10-02 — #33 done: the authoring kit in `docs/authoring/` (text format 1,
  a prompt template, three public-domain samples); every part sung (I5), `#`
  comments, greedy Sequence parsing, decided by the recommendation
- 2026-10-02 — Board #31 built: Output on the chosen screen in Chrome and Edge
  (pure `chooseScreen`, `openOutputWindow`, Settings > Output screen with Detect
  screens, `placed` Output fullscreen on first click or F, screenschange
  notices, plain popup with a drag hint elsewhere); needs a two-screen check;
  SDD-0001 §16.1
- 2026-10-02 — #28 part 4: the verdict (§8), review, commit, cancel, Replace
  (the row's swap is the commit; reconcile finishes a crashed one), remove with
  its recents, persistent storage at the first load, no network
- 2026-10-02 — Board #32 built: `registerType` prompt, Update ready snackbar
  (never while live, hourly check; strip from 840px), Safari Home Screen note;
  SDD-0001 §15
- 2026-10-02 — AI seams: the app's actions written as tool definitions (name,
  schema, handler), so WebMCP (`document.modelContext`, Chrome origin trial
  149–156) can register them when on by default, and an MCP server with Tauri.
  No vector store: the user's agent judges meaning over the app's search; local
  semantic search only by a later ADR, Malayalam tested first
- 2026-10-02 — AI in the app, decided: no provider code or keys in the app; its
  actions and queries kept as one clean API now, and with Tauri an ADR for an
  MCP interface so the user's own agent drives it (ADR-0029: AI is the user's
  tool)
- 2026-10-02 — ADR-0029 accepted: others build their books, format 1 the
  contract; the profile pipeline for bulk and whole books, a plain song text
  format with a parser and a source check for everyone; AI the user's own tool.
  Board #33–35
- 2026-10-02 — Board #32, decided: an app update waits for a restart the
  operator chooses, never while the Output is live (today it takes over at once
  and deletes the old version's files); books and settings are untouched by
  updates, as before
- 2026-10-02 — #28 part 3: package schema 3 (origin, sources, part position),
  one `packageRows` builder, the registry in OPFS and its reconcile, `hymnalDev`
- 2026-10-02 — ADR-0028 accepted: the Output on the projector screen, in Chrome
  and Edge (Window Management API); elsewhere the window as today. Board #31.
  #30 decided: the tint in Full Song only, an overlapped fade between columns,
  pages below a 0.30 fit, a Presentation setting; and lighting the whole song
  instead, with a shortcut
- 2026-10-02 — #29 done: _Songs of Zion_'s deck matches its PDF on all 422
  slides (6,438 lines one PDF line, 23 two). #28 parts 1–2 checked by hand:
  Malayalam packs to 1,631 songs, 512.6 KB; _Hymns of Fellowship_ 275, 63.1 KB;
  _Songs of Zion_ 420, 139.3 KB; each reads back clean, its source hash the
  printed sha256
- 2026-10-02 — The parts pad's pill blurs a little mid-glide, crisp on landing
- 2026-10-02 — #28 part 2: a container read and checked on the device; song and
  source hashes; uuidv7 keys
- 2026-10-02 — #28 part 1: `bun run pack` writes a book's container, the same
  bytes on any machine (fflate, a pinned hash)
- 2026-10-02 — Recents: rows a glide crosses fade, so no glyph is cut mid-glide
- 2026-10-02 — #29 part 3: _Songs of Zion_ read from its deck (420 songs);
  publisher GLS, id `eng-gls-songs-of-zion`; a number repeated on the next slide
  continues its song; long deck lines kept as written
- 2026-10-02 — The parts pad's selected key is one pill that glides from key to
  key
- 2026-10-02 — #28 designed: ADR-0026/0027 accepted, SDD-0004. Chosen: songs
  leave the repo; no sample until one exists; Malayalam adopted in place, source
  kept ignored, history rewritten later; empty first run; remove drops recents;
  persist asked at first load
- 2026-10-02 — Laya (#27 part 6) moved last; hand fixes kept in the draft's
  `HAND-FIXES.md`; Recents' glide 300ms, as PRINCIPLES says
- 2026-10-01 — This Song's tint glides from part to part, with the scroll
- 2026-10-01 — #27 part 5 done. Decided while the user was away, by the
  recommendation: the 4-word limit, the wraps section summarised
- 2026-10-01 — #20 done: R, U; key hints from one table; band size a setting
- 2026-10-01 — #27 part 5: breaks done; #152's chorus joins; long stanzas noted
  for the judge
- 2026-10-01 — #27 part 5: a stanza's stub at a column's foot joins its rest (4
  songs)
- 2026-10-01 — Recents: a clear gap between a title and its time
- 2026-10-01 — #33 done: Recents grouped Today, Yesterday, Before; relative
  times
- 2026-10-01 — #27 part 5: titles match the index across O/Oh, &/and, a
  subtitle, a cut-short title
- 2026-09-29 — #27 part 5: by rule the chorus follows a bridge; lone chorus cues
- 2026-09-29 — #27 part 5: kind by first font; directions out; "…Cho…", cues
  read
