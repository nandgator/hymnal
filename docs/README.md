# Documentation

Three kinds of document live here, at three different altitudes. Keeping them
distinct is the whole point — when they blur, the architecture document becomes
a changelog and the decision records become documentation.

| Artifact  | Answers                              | Changes when               | Lives in                                         |
| --------- | ------------------------------------ | -------------------------- | ------------------------------------------------ |
| **arc42** | _How is the system shaped, and why?_ | The shape changes          | [`architecture/arc42.md`](architecture/arc42.md) |
| **ADR**   | _Why did we choose this over that?_  | Never — superseded instead | [`decisions/`](decisions/)                       |
| **SDD**   | _How does this part actually work?_  | The part is redesigned     | [`design/`](design/)                             |

## The rule

**arc42 describes the present.** It is rewritten in place. It never explains a
choice in depth — it states the choice and links the ADR.

**An ADR captures a moment.** It records what was true when the decision was
made: the forces, the options considered, and what was given up. ADRs are
immutable. A decision that stops being right is not edited — a new ADR is
written with `Supersedes: NNNN`, and the old one is marked `Superseded by NNNN`.
This matters more than it sounds: the value of an ADR is that it preserves
reasoning you will otherwise reconstruct incorrectly in a year.

**An SDD sits below arc42.** Detailed design for one subsystem — data
structures, interfaces, algorithms, invariants. Written when a part is complex
enough that "read the code" is a bad answer. The domain model has one because
everything else depends on it.

## Workflow

1. A question with more than one defensible answer appears.
2. Write the ADR **before** implementing. If you can't articulate the rejected
   options, the decision isn't understood yet.
3. If the decision changes the system's shape, update arc42 to match and link
   the ADR from §9.
4. If the decision needs detailed design to be buildable, write or update an SDD.
5. Implement.

Deferring is a decision. Record it with status `Deferred` and note what event
forces the choice — see [ADR-0006](decisions/0006-defer-the-native-wrapper-decision.md)
for the pattern.

## Conventions

- ADRs follow [MADR](https://adr.github.io/madr/), numbered sequentially, named
  `NNNN-lowercase-with-hyphens.md`.
- Status is one of `Proposed`, `Accepted`, `Deferred`, `Superseded`, `Rejected`.
- Diagrams are source-controlled text (Mermaid) so they diff, never binary exports.
- `OPEN:` marks a known, deliberate gap. Grep for it to find undecided territory.
