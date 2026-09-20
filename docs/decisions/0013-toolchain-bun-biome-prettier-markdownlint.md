# 0013 — Toolchain: bun, biome, and prettier with markdownlint

- **Status:** Accepted
- **Date:** 2026-09-20

## Context and Problem Statement

The project needs package management, plus linting and formatting for two
distinct kinds of file: TypeScript source, and a documentation set that is
itself a deliverable ([`docs/`](../README.md)).

Markdown and TypeScript have genuinely different needs. Markdown formatting is
about tables, wrapping and list style; markdown _linting_ is about structural
rules that formatters do not check — heading hierarchy, duplicate headings,
missing code-fence languages. TypeScript needs both, fast, over a growing
codebase.

## Decision Outcome

Chosen:

| Concern            | Tool                  | Scope           |
| ------------------ | --------------------- | --------------- |
| Package management | **bun**               | Whole project   |
| Markdown format    | **prettier**          | `**/*.md` only  |
| Markdown lint      | **markdownlint-cli2** | `**/*.md` only  |
| TypeScript lint    | **biome**             | TypeScript only |
| TypeScript format  | **biome**             | TypeScript only |

The split is strict and deliberate. **Prettier never touches TypeScript, and
biome never touches markdown.** Both tools are capable of more than their
assigned scope, and letting the scopes overlap produces fights where two
formatters disagree about the same file — a well-known failure mode that costs
more time than either tool saves.

Biome replaces the ESLint plus Prettier pair for TypeScript with one Rust
binary, removing the plugin-compatibility layer that pairing them normally
requires. Prettier is retained for markdown specifically, because biome's
markdown support is not equivalent and prose formatting is where prettier is
strongest.

bun provides package management and script running in one fast tool, with no
separate lockfile-and-runner split.

### Configuration notes

- `.prettierignore` excludes everything but markdown in practice, and scripts
  target `**/*.md` explicitly — scope is enforced in two places, not one.
- `MD013` (line length) enforces 80 columns on prose, with `tables: false`.
  Tables are exempt because prettier pads them to align, making their width the
  formatter's decision rather than the author's. Long lines containing no spaces
  — bare URLs — are already exempt by default, as `strict` is off. Disabling the
  rule wholesale would have been the easy move and would have cost real prose
  discipline for one narrow conflict.
- `MD024` is `siblings_only`: ADRs legitimately repeat headings like
  "Consequences" across files and within nested option sections.
- `MD033` (inline HTML) is disabled for Mermaid blocks.
- `archive/` is excluded from every tool — see
  [ADR-0002](0002-rebuild-from-a-clean-slate.md).

One interaction is worth knowing before it wastes an afternoon. Prettier will
refuse to wrap a line where the break would leave a number followed by a period
at the start of the next line, because CommonMark reads that as an ordered list
marker. Under `proseWrap: preserve` this looks like prettier arbitrarily joining
a line and fighting MD013. It is not — it is preventing a real parsing bug.
Reword so the number does not land at a line start.

### Consequences

Good:

- No overlapping scopes, so no formatter conflicts.
- Markdown is linted structurally, not just formatted — the documentation is a
  deliverable and is checked like one.
- Fast: biome and bun are both substantially quicker than what they replace.
- Few dependencies — three dev dependencies cover all of it.

Bad:

- Two formatters in one project, which needs explaining. This ADR is that
  explanation.
- Biome's ecosystem is younger than ESLint's, and some specialised rules have
  no equivalent.

Neutral:

- `bun run check` runs everything; `bun run format` fixes what is fixable.
- No framework-specific linting yet. SolidJS rules
  ([ADR-0005](0005-use-solidjs.md)) are added when there is TypeScript to lint.
