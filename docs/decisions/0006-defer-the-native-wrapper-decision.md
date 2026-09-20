# 0006 — Defer the native wrapper decision

- **Status:** Deferred
- **Date:** 2026-09-20

## Context and Problem Statement

Reaching Android and iOS app stores requires wrapping the web frontend from
[ADR-0004](0004-build-a-responsive-web-application.md). The candidates — Tauri
v2, Capacitor, or no wrapper at all — run the same frontend and differ only in
the shell around it.

The question is not only _which_, but _when_.

## Decision Outcome

Chosen: **defer, and ship Phase 1 as an installable PWA.**

Phase 1 is single-device, locally persisted, with no sync and no audio. It
contains **no native capability requirement at all**. A wrapper chosen now
would be chosen on speculation about Phase 2, and would have to be lived with
regardless of whether that speculation held.

Deferring also buys real information. Tauri's mobile support, the current
front-runner, is considerably less battle-tested than its desktop support,
especially on iOS. Another year of maturity is strictly better than betting
today, and costs nothing because nothing depends on the answer yet.

### Revisit when any of these occurs

- Phase 2 audio work begins and needs sustained microphone access, background
  execution, or on-device speech recognition.
- App store distribution becomes a requirement.
- Browser storage eviction proves unmanageable in practice
  ([ADR-0008](0008-sqlite-as-the-on-device-content-store.md)).

### Candidates at time of writing

| Option        | For                                                                            | Against                                                 |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **Tauri v2**  | Rust backend, tiny binaries, vendor-neutral, desktop and mobile from one shell | Mobile less proven than desktop, iOS least of all       |
| **Capacitor** | Mature mobile wrapper, large plugin ecosystem, straightforward store path      | Heavier runtime; Node/npm-centric tooling               |
| **None**      | Zero additional surface; PWA install is enough                                 | No store presence; iOS PWA limits bite hard for Phase 2 |

### Consequences

Good:

- No speculative commitment; no wrapper-shaped constraints on Phase 1.
- The decision is made later with real requirements instead of guesses.
- Zero cost, since nothing in Phase 1 depends on it.

Bad:

- No app store presence until resolved.
- A late choice may demand rework if a wrapper turns out to constrain the
  frontend in ways not anticipated. Judged low risk — all candidates run
  standard web content.

Neutral:

- **A licence conflict must be resolved alongside this decision, not after.**
  The project is AGPL-3.0-only, which conflicts with Apple's App Store terms.
  This may rule out the iOS target entirely regardless of wrapper. Tracked as
  risk R3 in [arc42 §11](../architecture/arc42.md#11-risks-and-technical-debt).
