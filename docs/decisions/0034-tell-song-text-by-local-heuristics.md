# 0034 — Tell song text by local heuristics, a model only if measured short

- **Status:** Accepted
- **Date:** 2026-10-14
- **Decided:** by the maintainer, Board #73

## Context and Problem Statement

From Text takes whatever is pasted, and a received book carries whatever its
maker put in it. A person can paste Python, a maths formula, a table or an email
as a song, and it is added as one. Nothing is run (the text is only shown,
ADR-0030), so the harm is clutter in the person's own book, not a security risk.

The question is how the app tells that text is not a song, and whether hand
rules are enough or an NLP model is worth its cost.

Two problems hide in one. **Code, maths and data** are easy: symbol density, the
share of letters, keywords and line shape separate them from lyrics almost
perfectly. **Prose** (a sermon, a Bible passage, an email) is hard: a psalm or a
free-verse hymn reads like prose, so the line is fuzzy for a person too, and no
method is flawless on it.

## Decision Drivers

- The cost of an error is small: the result is a note, never a block, so a
  missed flag is visible clutter and a false flag costs a glance.
- The app is an offline PWA, used on phones; download, memory and first-run time
  count.
- English and Malayalam alike; the check must not depend on the script.
- The note says why ("lines full of `{ } ;`"), so the reason must be knowable.
- The same text gives the same answer on every device and browser.
- No LLM in the import pipeline; lyrics stay on the device.
- Training on lyrics whose rights are unknown could carry fragments of them in a
  model's weights.

## Considered Options

|                                 | Hand rules                                         | Small trained classifier                                                 | Neural model in the browser                         | Chrome's built-in AI (Gemini Nano) |
| ------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------- | ---------------------------------- |
| How                             | Letter share, symbol density, keywords, line shape | Character n-gram scoring trained offline; the app ships only the weights | A small multilingual model run with transformers.js | Ask the browser's own model        |
| Download                        | about 3 KB                                         | about 50–300 KB                                                          | about 1–2 MB of runtime plus a 25–120 MB model      | about 2 GB, Chrome only            |
| Speed on a phone                | under 1 ms                                         | a few ms                                                                 | seconds on first run, plus memory                   | slow, often unavailable            |
| Code and maths                  | excellent                                          | excellent                                                                | good                                                | good                               |
| Prose against lyrics            | weak to fair                                       | fair to good                                                             | fair                                                | fair                               |
| Malayalam                       | yes, script-agnostic                               | yes, if trained on Malayalam hymns                                       | small models are weak at it                         | unreliable                         |
| Says why                        | yes                                                | partly                                                                   | no                                                  | no                                 |
| Offline, same answer everywhere | yes                                                | yes                                                                      | after a large cache                                 | no                                 |
| Fits the rules                  | yes                                                | yes                                                                      | yes, but heavy offline                              | no: an LLM in the import path      |

Existing libraries were surveyed (2026-10-14). None tells lyrics from non-song
text. The nearest name the programming language of a snippet: flourite and
lang-detector (regex scoring, "Unknown" for plain text), detect-code-language,
and shamanld (a trained model, 78% accurate). None covers maths, prose, URLs or
tables, or Malayalam. One may serve as a signal, not as the check.

## Decision Outcome

Chosen: **hand rules first; a small trained classifier only if they measure
short on prose.** The neural model and Gemini Nano are ruled out.

1. **A labelled test set first**, whatever the method: real hymns in English and
   Malayalam (odd punctuation, short refrains, psalm-like free verse), and code,
   maths, CSV, URLs, chat logs and prose. It is the evidence for this decision
   and the regression test after it. **Coverage is by how text is written, not
   by language count**: of the world's ~7,170 languages about half have no
   settled writing, and many share a script with a larger neighbour. The set
   holds the top ~40 languages by total speakers
   ([Wikipedia's list](https://en.wikipedia.org/wiki/List_of_languages_by_total_number_of_speakers)),
   at least one song in every script in daily use, and every writing trait (no
   spaces, right-to-left, combining marks, joiners, no case), Malayalam and the
   app's languages always. Its text is public domain or openly licensed only
   (public-domain hymns, Psalms from open Bibles, the UDHR as prose), each
   source and licence recorded beside it; copyrighted lyrics are never scraped.
2. **Hand rules** are built and measured on it. They are enough when they flag
   **no** real hymn in the set and catch at least **95%** of the non-songs.
3. **Only if prose slips past**, a character n-gram classifier is added as a
   second signal, a few hundred KB at most, trained on this machine on text
   whose rights are cleared (the public-domain sample; a Malayalam corpus once
   its rights are settled), never on a draft whose rights are unknown.
4. **A note, never a block.** A song that fails shows a note on review (the
   parser's `TextNote`), with the reason; adding still works.
5. **Where it runs:** From Text and received books, on review.
6. **Any script, by Unicode category, never by `a–z` or the space.** A letter is
   a letter (`\p{L}`) or a combining mark (`\p{M}`): Malayalam's vowel signs are
   marks, and counting letters alone would flag every Malayalam hymn. Lengths
   are counted in characters as seen (`Intl.Segmenter` graphemes), and words,
   where a rule needs them, by `Intl.Segmenter` too: Chinese, Japanese, Thai,
   Lao, Khmer and Burmese write no spaces. The zero-width joiners (ZWJ, ZWNJ)
   belong to Indic words as much as to emoji, and are never a sign of either.
   Code and maths signals (`{ } ; =`, `def`, `\frac`) are ASCII in any language.
7. **Emoji are decoration, counted as seen.** An emoji is one grapheme however
   many code points make it (skin tones, variation selectors, ZWJ sequences),
   found by the Unicode emoji property. A few in a song (🙏 ✝️ 🎶 at a line's
   end) pass, as do musical and religious symbols (♪ ♫ ✝). A song whose lines
   are mostly emoji gets a note ("Lines are mostly emoji, not words").

### Consequences

- Good: a few KB, instant, offline and the same on every device; the note can
  say why; English and Malayalam are treated alike.
- Good: the test set decides by numbers, not taste, and guards the check after.
- Bad: prose may still pass as a song if the rules fall short and the classifier
  does too; the note is advice, and the person is the judge.
- Bad: the rules' thresholds are tuned by hand and need the test set kept up as
  new false alarms are reported.
- Revisit if a small model arrives that is strong on Malayalam, explainable and
  a few MB at most, and the measured prose miss rate still matters.

## Measured (2026-10-14, Board #73)

The set is in `src/import/songcheck/fixtures/` (112 songs in 60 languages and 27
scripts, 190 non-songs; the gaps are in `gaps.json`) and the hand rules are
`src/import/songcheck.ts`. On it they flag **0 of 112** songs and catch **189 of
190** non-songs (99.5%): code 25/25, maths 10/10, data 14/14, links 10/10, chat
10/10, email 8/8, emoji 5/5, prose 107/108. So §3's classifier is not built. The
set is small, and prose is the soft spot: a Psalm set out one verse to a line
looks like a paragraph, so the paragraph rules look at the shape (one long line,
every paragraph a line of its own, lines cut at a margin) and not at sentences.
Lines cut at a margin are not flagged when most continuation lines begin with a
capital in a cased script: that is verse set one line to a line with the end
punctuation left out, and prose continues its sentences in lower case (four such
hymns were added after twenty of 2,326 songs in three real books were flagged
for it). A real song they flag, or a non-song they miss, is a new case for the
set.
