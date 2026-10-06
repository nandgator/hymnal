# 0030 — Security: a local-first threat model

- **Status:** Accepted
- **Date:** 2026-10-06
- **Decided:** by the recommendation, under the maintainer's ask for "high
  security" before the beta (Board #47, #48)

## Context and Problem Statement

"High security" needs a bar, or every hardening is as good as any other. The
hymnal has no server, no accounts and no network of its own: a static site and a
service worker, with every book and every setting on the device
([ADR-0020](0020-present-songs-do-not-publish-them.md),
[ADR-0026](0026-songs-leave-the-repository.md)). What can go wrong is narrow,
and this record names it, so the work is the work that matters.

## What is protected

- **The user's books.** Their lyrics may be under copyright and are the user's
  to hold, not ours to see.
- **The user state.** Recents and the last position say which hymns someone
  sang, which can reveal their faith: a special category of data under GDPR
  Art. 9.
- **The device and the projector.** A file should not be able to run code,
  exhaust memory, damage what is stored, or put anything on the Output.

## Threats, and what answers each

1. **A hostile file.** A book container, a backup (SDD-0006) or pasted text is
   untrusted, whoever made it. Containers already are: a size ceiling on
   inflating, one JSON document, the whole schema, rejected whole (SDD-0004 §3).
   A backup's packages are never copied in: each is opened in a scratch database
   with `trusted_schema` off and SQLite's defensive flag on, refused if it holds
   a trigger or a view, and rebuilt by the one package builder (SDD-0006 §3).
   Every connection the worker opens sets the same two flags.
2. **Script injection.** Lyrics and titles are text, never markup: Solid escapes
   them, and no code sets `innerHTML` or evaluates strings. A Content Security
   Policy in a `<meta>` tag makes that a rule the browser keeps: scripts,
   workers and wasm from the site only (`'wasm-unsafe-eval'` for SQLite), no
   plugins, no remote connections, no form posts, no other base. GitHub Pages
   cannot send headers, so `frame-ancestors` cannot be set: framing the app is a
   low risk, since it holds no credentials and takes no payment.
3. **Data leaving the device.** Nothing is sent anywhere. The CSP's
   `connect-src 'self'` makes it so for every path, not only the load path
   SDD-0004 §11 tests. A feature that would send anything (feedback,
   announcements, Board #16, #18) is asked for by the user each time, and comes
   with a privacy statement updated first.
4. **Another site on the same origin.** Browser storage is per origin. On
   `<user>.github.io`, every project page of that account shares one origin and
   could read the books. **The app is deployed at an origin of its own**: a
   custom domain or a subdomain, never a project path on a shared host. The
   build's base path defaults to the domain root for this reason.
5. **The supply chain.** Dependencies are few and pinned by `bun.lock`; installs
   are `--frozen-lockfile`. CI runs `bun audit` and fails on a high or critical
   advisory. The fonts and wasm are self-hosted; nothing loads from a CDN.
6. **A stale or hostile update.** The service worker serves only the site's own
   precache, and a new version waits for a restart, never while live (SDD-0001
   §15). A deploy comes only from `main` through GitHub Actions.

## Out of scope

A compromised device or browser, a malicious browser extension, and someone with
the unlocked device in hand: the app keeps no secret from its own user and
encrypts nothing at rest. Copyright in what a user loads is theirs (PLAN Log,
2026-10-06).

## Consequences

- A PLAN Invariant: **nothing leaves the device unless the user sends it.**
- The CSP is tested: the built `index.html` carries it, and the app runs under
  it in the browser, Output and worker included.
- A second origin (a custom domain) is needed before the beta: it is
  `hymnal.sagaveracity.com`, on GitHub Pages (2026-10-07).
- An advisory is ignored in CI only for a package that is not in the built app,
  with the reason beside it; a test fails if that package ever reaches `dist/`.
