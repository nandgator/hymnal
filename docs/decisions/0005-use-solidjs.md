# 0005 — Use SolidJS as the frontend framework

- **Status:** Accepted
- **Date:** 2026-09-20

## Context and Problem Statement

Following [ADR-0004](0004-build-a-responsive-web-application.md), the frontend
framework is the irreversible decision — everything is built on it, and it is
the same code under any wrapper chosen later.

What this application actually does is narrow: render a lot of text, move a
focus highlight through it smoothly at part and line granularity, and stay
responsive on a mid-range Android phone several years old. It is not
form-heavy, not data-entry-heavy, and has no server rendering requirement.

## Considered Options

- **SolidJS**
- **Svelte 5**
- **React + Vite**
- **Vue + Vite**

## Decision Outcome

Chosen: **SolidJS.**

Fine-grained reactivity suits the central UI problem directly. Moving focus
from one line to the next should update two nodes, not reconcile a tree — and
the highlighting in Phase 2 would drive that at word granularity, potentially
many times per second. Solid updates the DOM without a virtual DOM diff, and
its runtime is small, which matters against the device floor.

It uses JSX without a compiler-dependent component format, so the templating is
ordinary JavaScript expressions.

### Consequences

Good:

- Fine-grained updates align with focus-driven rendering, the app's core
  interaction.
- Small runtime and strong performance on low-end devices.
- Explicit reactivity — no compiler magic determining what updates.
- Scales to word-level highlighting later without a rendering rework.

Bad:

- **Smallest ecosystem and community of the four.** Fewer libraries, fewer
  answers, fewer examples. This is the real cost, and it is accepted.
- Least transferable of the four as a skill.
- Reactivity rules are subtle in a way that catches newcomers — destructuring
  props breaks reactivity, and that mistake is easy to make and quiet to debug.

Neutral:

- Mitigated by keeping the domain layer framework-free. The Sequence Engine,
  the occurrence model and persistence must not import Solid. If the framework
  ever has to change, the parts that matter are portable.
