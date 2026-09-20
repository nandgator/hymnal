# 0004 — Build the client as a responsive web application

- **Status:** Accepted
- **Date:** 2026-09-20

## Context and Problem Statement

The target is a cross-platform application with mobile responsiveness, reaching
Android, iOS and the web, with live audio sync as a future possibility. Built
and maintained by one person.

Flutter was evaluated first and rejected. The objections were specific and, in
combination, structural: Dart as a single-vendor language with little use
outside Flutter; Google's wavering commitment after the 2023–24 team layoffs;
non-native rendering, since Flutter paints every pixel itself rather than using
platform widgets; and the weight of the SDK and toolchain.

Go and Ruby were then raised. Neither survives examination. Ruby has no
credible cross-platform mobile UI story — RubyMotion is effectively dead and
the desktop toolkits are hobby-grade — and it would only make sense as a
server, which this design does not have. Go's `gomobile` has stagnated for
years; Wails is desktop-only with no mobile support; and Fyne and Gio both
paint their own pixels, reproducing the exact objection raised against Flutter
with a fraction of the ecosystem.

## Considered Options

- **Flutter**
- **Go (Fyne / Gio / Wails) or Ruby**
- **React Native + Expo**
- **A web frontend**, optionally wrapped later for app stores

## Decision Outcome

Chosen: **a responsive web frontend.**

The observation that settles it: **Tauri, Capacitor and a plain PWA all run a
web frontend.** They differ only in what wraps it. So this is two decisions,
not one, and they differ sharply in reversibility — the frontend is
irreversible and everything is built on it, while the wrapper is late-binding
and swappable.

Phase 1 is scoped to single-device use, local persistence, no sync and no
audio. It requires **no native capability whatsoever**. Committing to a wrapper
now would buy nothing and forfeit flexibility, so that decision is deferred:
[ADR-0006](0006-defer-the-native-wrapper-decision.md).

A web frontend also answers the objections that ruled out Flutter. Rendering is
standards-based rather than a custom engine; the platform is vendor-neutral and
cannot be discontinued; TypeScript is not single-vendor; and the toolchain is
light.

### Consequences

Good:

- Web is a first-class target immediately, not an afterthought.
- All wrapper options stay open; the frontend is unchanged under any of them.
- No native build infrastructure needed for Phase 1 — no Mac, no developer
  account, no store review.
- Standards-based text rendering, which matters for Malayalam shaping.

Bad:

- Subject to browser policy, notably storage eviction — see
  [ADR-0008](0008-sqlite-as-the-on-device-content-store.md).
- No app store presence until a wrapper is chosen.
- Phase 2 on-device speech recognition is harder in a browser than natively.
  This is the real cost of the decision, and it is accepted because Phase 2 is
  explicitly a future possibility rather than a committed requirement.

Neutral:

- "Responsive" covers phone through large display, which subsumes the projector
  layout requirement without separate work.
