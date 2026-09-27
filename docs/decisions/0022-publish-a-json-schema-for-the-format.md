# 0022 — Publish a JSON Schema for the content format

- **Status:** Accepted
- **Date:** 2026-09-27

## Context and Problem Statement

The content format ([SDD-0002](../design/0002-content-format.md)) is written
by a standalone tool and read by others
([ADR-0018](0018-import-songs-through-a-layout-aware-pipeline.md)). A prose
spec is enough for people. Tools and editors need a contract they can
check against.

JSON Schema describes shape: types, required fields, and no other fields.
It can't express the rules that span a document: every sequence entry names
a real part (I2), every part is sung (I5), a file is named for its number,
the book's count is right. `validate.ts` enforces all of those, in the
browser too, collecting every violation in one pass.

Validating by schema at runtime would add a schema engine to the app (ajv,
about 100 KB). ajv also compiles schemas with `new Function`, which a strict
Content-Security-Policy forbids. And `validate.ts` would still be needed for
the rules above.

## Considered Options

- **The schema defines the fields; `validate.ts` enforces**
- **Two copies of the field lists, a test to keep them equal**
- **Generate types and schema from one TypeBox definition**

## Decision Outcome

Chosen: **the schema is the single definition of which fields exist, and
`validate.ts` enforces everything.**

- Hand-written JSON Schema (2020-12), one set per format version, committed
  under `public/schema/<format>/` and served with the site at
  `<site>/schema/1/`: the book, a hymn, and the single-file container.
- **No host is written into them.** The domain may change, so the schemas
  carry no absolute `$id` and refer to each other by relative path. They
  work wherever they are served, or straight from a checkout.
- `validate.ts` reads its allowed-field lists from the schema, so the two
  can't disagree on which fields exist. Types, required fields and every
  cross-document rule stay in code.
- A test runs both over the same good and bad files with ajv (MIT, a
  development dependency only) and checks they agree. Nothing is added at
  runtime.
- **Files may name their schema** with an optional `$schema` field, so
  editors validate and complete as you type. This amends format 1, which no
  one outside this repository reads yet. The committed corpus needn't add it.

Two copies with a test catch drift after the fact; reading the fields from
the schema prevents it. TypeBox would add a runtime dependency and replace
`validate.ts`'s rule ids and messages with the library's.

### Consequences

Good:

- Outside tools and editors get a checkable contract, at a stable path.
- No runtime cost, and no code generation in the browser.

Bad:

- Two artefacts describe the format. The test is what keeps them honest
  about types and required fields.
