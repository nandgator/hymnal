# Product

<!-- impeccable:product-schema 1 -->

Product truth for design work. The visual system is
[docs/visual/DESIGN.md](docs/visual/DESIGN.md); the live state is
[docs/PLAN.md](docs/PLAN.md). Where this file and an ADR disagree, the ADR wins
and this file is wrong.

## Platform

web

A PWA: it runs in the browser and installs as an app, phone to desktop. A native
wrapper is deferred (ADR-0006).

## Users

**Primary: the Presenter.** A church volunteer at a laptop during a service,
often not technical, working under mild time pressure: a hymn is announced with
no warning and the room waits. They find it by number or by a line they
remember, put it on the projector screen and follow the singing, overriding the
expected order without hesitation. Design decisions serve this person first.

**Second: the Congregant.** Follows along on their own phone; wants the right
hymn, readable, without fiddling.

**Third: the book builder.** Someone who turns their church's songs into a book
(From Text in the app, or the CLI and authoring kit).

## Product Purpose

Present hymn lyrics in the order they are actually **sung**, not the order they
are printed, on the projector screen or the device in hand. Success: the right
words on the screen within three seconds of the announcement, no network, no
wrong word, readable from the back of the room.

## Positioning

A hymn owns its parts and, separately, a sequence of references to them, so a
chorus printed once is sung after every stanza and the presenter knows which
showing of it is up (ADR-0003). Repeat and Undo follow what the congregation
actually does, live. Any language and script, Malayalam and English first.
Local-first: no account, no server, no tracking; books stay on the device.

## Operating Context

- Any church, any language: the aim is worldwide; Malayalam and English are the
  first two, and the format takes any script.
- Small venues: one laptop, a projector or TV, often no internet, one volunteer.
- Two screens: the Operator (the volunteer's) and the Output (the audience's, in
  a window on the projector, or Present Here full screen on one device).
- Keyboard and clicker first: every action has a key; a presentation clicker's
  Page Up and Page Down work everywhere.
- Hymns are announced by number from printed hymnbooks.

## Capabilities and Constraints

- Quality goals, in order, the higher winning (arc42 §1.2): lyrical correctness,
  legibility in the room, offline reliability, retrieval speed, extensibility
  across books and languages. Visual novelty and feature breadth are
  deliberately absent from that list.
- Hymnal presents songs and never publishes them (ADR-0020); it ships no book
  but a public-domain sample (ADR-0026).
- Content is validated when loaded and never repaired at runtime.
- While live, nothing the Operator does elsewhere changes the Output unasked.
- Nothing leaves the device unless the user sends it (ADR-0030). No LLM in the
  import pipeline.
- Phase 1 scope: single device; sync, audio and a native wrapper deferred.

## Brand Commitments

- Name: Hymnal. Epigraph: _O sing unto the Lord a new song..._
- Voice: plain words a volunteer understands, Title Case actions, no jargon, the
  copy rules in DESIGN.md § Words.
- Material Design 3 is the incumbent system (DESIGN.md).

## Evidence on Hand

- The public-domain sample: 28 hymns from _The Otterbein Hymnal_ (1890) and two
  Malayalam songs, each with its rights record (`docs/sample/RIGHTS.md`).
- The beta at hymnal.sagaveracity.com.
- No testimonials, user counts or partner churches exist; do not invent them.

## Product Principles

1. The room waits on the Presenter: every step from announcement to screen is
   counted.
2. A wrong word in front of the congregation is the one unrecoverable failure.
3. The audience's screen stays calm: nothing appears on it unasked.
4. Every language is first-class; no script is an afterthought.
5. The person's books and songs are theirs and stay on their device.

## Accessibility & Inclusion

WCAG 2.2 AA for the Operator and the reading view. The projected Output is held
to legibility in the room (arc42 goal 2) beyond AA: contrast and text size are
the user's to set, and Malayalam is shaped correctly at every size.
