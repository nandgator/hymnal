# 0011 — Defer multi-device sync and projector output

- **Status:** Deferred
- **Date:** 2026-09-20

## Context and Problem Statement

Two capabilities were considered for Phase 1 and then pulled out: congregation
devices following an operator live, and driving a projector as a second display
distinct from the phone view.

Both are plausible. Both are large. Network conditions vary by venue — some
have usable wifi, some have none, some have unreliable internet — so a
broadcast transport cannot assume any one of them.

## Decision Outcome

Chosen: **defer both. Phase 1 is single-device.**

Supporting live sync across varying venue conditions means a local transport
(BLE, Wi-Fi Direct, or mDNS discovery) _and_ a relay for venues without a usable
LAN, _and_ the degradation paths between them — plus sessions, pairing, presence
and reconnection. For a solo maintainer that is comparable in size to the rest
of Phase 1 combined, and none of it delivers value until the core presentation
works.

Projector output faces a similar gap: a responsive web frontend has no direct
route to a second physical display without either a wrapper or a second device.
It is entangled with [ADR-0006](0006-defer-the-native-wrapper-decision.md) and
cannot be settled before it.

There is also a real possibility that sync is unnecessary. If audio follow works
([ADR-0010](0010-model-liveness-as-pluggable-follow-sources.md)), each device
can follow the room independently — no session, no pairing, no server, no
operator, and audio never leaves the device. Building a transport first would
risk building infrastructure that a later capability makes redundant.

### Revisit when

- Phase 1 is in real use and following proves genuinely needed.
- Audio follow is evaluated, and shown to be insufficient on its own.
- The wrapper decision resolves, making external display output reachable.

### Consequences

Good:

- Phase 1 stays achievable for one person.
- No transport, session, presence or reconnection code — the largest source of
  avoided complexity in the project.
- Avoids building infrastructure that audio follow may render unnecessary.

Bad:

- Multi-device following was an early goal and is now absent. If it proves
  essential, it is a significant later addition.
- No projector output means the large-display case rests on responsive layout
  and whatever the venue can already connect.

Neutral:

- Responsive layout (R8) still covers phone through large display, so the
  _rendering_ side of projector support exists. What is deferred is only the
  mechanism for reaching a second physical screen.
- The address space from
  [ADR-0010](0010-model-liveness-as-pluggable-follow-sources.md) is what a sync
  protocol would carry, so it is being validated in the meantime.
