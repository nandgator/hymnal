# 0028 — Put the Output on the projector screen

- **Status:** Accepted
- **Date:** 2026-10-02

## Context and Problem Statement

[ADR-0011](0011-defer-multi-device-sync-and-projector-output.md) deferred
projector output because "a responsive web frontend has no direct route to a
second physical display without either a wrapper or a second device". Since then
the Output window has shipped (Board #11, SDD-0001 §16): Go live runs
`window.open(OUTPUT_URL, "hymnal-output", "popup")` in `src/App.tsx`, and the
operator drags the popup to the projector and makes it fullscreen by hand. That
works, but the first thing a PowerPoint user expects is that the slides appear
on the projector without being dragged there.

The first half of ADR-0011's reasoning no longer holds in Chromium. This record
revisits only that: **how the Output reaches a second physical screen.** Sync
stays deferred, and nothing here touches the wrapper decision
([ADR-0006](0006-defer-the-native-wrapper-decision.md)). The scope guard in
`docs/PLAN.md` says to re-read the deferral ADR before touching a projector;
this is that re-read, and it amends the guard's reach for Output placement only.

### What the web offers (checked 2026-10-02)

**Window Management API.** `window.getScreenDetails()` resolves to a
`ScreenDetails` with `screens` (an array of `ScreenDetailed`), a live
`currentScreen`, and the events `screenschange` and `currentscreenchange`. Each
`ScreenDetailed` adds `isPrimary`, `isInternal`, `label`, `devicePixelRatio` and
the placement fields `left`, `top`, `availLeft`, `availTop` to the usual
`width`/`height`. `screen.isExtended` is a cheap synchronous check for "more
than one screen" that needs no permission. The `window-management` permission
(the old `window-placement` name is gone) is asked on the first call to
`getScreenDetails()`, is remembered per origin, can be revoked in browser
settings, and needs a secure context. Placement is then
`window.open(url, name, "left=…,top=…,width=…,height=…")` or `moveTo`, and
`element.requestFullscreen({ screen })` fullscreens on a chosen screen
([Chrome docs](https://developer.chrome.com/docs/capabilities/web-apis/window-management),
[web.dev guide](https://web.dev/articles/web-apps/multiple-screens),
[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window_Management_API)).

**Support.** Chrome and Edge from 100, desktop. MDN labels the API experimental
and limited-availability. Firefox and Safari do not implement it, and I found no
sign that either will; treat that as the standing position, not a gap about to
close. A phone or tablet has no second screen to place on in any case.

**User activation.** The permission prompt itself does not need a gesture, but
opening a popup does (the popup blocker), and so does `requestFullscreen`. A
fullscreen request is also made by a document on its own element, so a popup
that has just opened cannot be made fullscreen from the opener's click. This is
the one part I could not settle from documentation and the first thing the
implementation must prove on a real two-screen machine (open point 2).

**Presentation API.** `PresentationRequest(url).start()` asks the browser to
show a URL on a "presentation display", and the page keeps a connection for
messages. Chrome has had it since 66
([Chrome blog](https://developer.chrome.com/blog/present-web-pages-to-secondary-attached-displays)).
The browser, not the page, owns the screen picker, and the displays offered are
Cast receivers and, on Android, wired or wireless secondary displays. On desktop
Chrome an attached projector is not offered as a plain display, so it is the
wrong tool for HDMI. Firefox and Safari do not support it. Remote Playback is
about sending a media element to a device and is not relevant.

### What "most suitable" can mean

The API reports geometry and three flags, and nothing else. It cannot say that a
screen is a projector: a 4K television, a monitor and a projector all look
alike, and the label ("EPSON PJ", "DELL U2720Q") is a hint at best. What can be
used:

- **External**: `isInternal` is false. The laptop panel is internal.
- **Not primary**: the operator's own desktop is nearly always primary.
- **Not the screen the operator window is on** (`currentScreen`).
- **Largest**, then **landscape**, to break a tie. Projectors are usually 1080p
  or lower, so size picks a TV over a projector as often as not: it is a
  tiebreaker only, never a rule.

Mirrored displays appear as one screen, so there is nothing to place and the
fallback is already right.

## Considered Options

- **Window Management where it exists, today's popup everywhere else**
- **The Presentation API**
- **Wait for Tauri** and place windows natively
- **Do nothing**: the operator drags the window, as now

## Decision Outcome

Chosen (proposed): **use the Window Management API in Chromium, and keep today's
behaviour everywhere else.** The Output works identically on both paths, only
its opening differs, and the channel (`src/output/channel.ts`) is untouched.

**Chromium path** (`'getScreenDetails' in window && screen.isExtended`):

1. **Ask once, on the gesture that already exists.** Go live (or Open Output)
   calls `getScreenDetails()`, which raises the browser's own permission prompt
   the first time. Nothing is asked at start-up, and nothing is asked on a
   single-screen machine.
2. **Choose by default**: the external, non-primary screen that is not the
   operator's `currentScreen`; if several, the largest, then the landscape one.
   If none qualifies, fall back below.
3. **Remember the choice** in user state as the screen's `label` plus its
   `width`×`height`, not its position, which changes when the operator
   rearranges displays. At the next Go live the stored screen is used if still
   present; otherwise step 2 runs again.
4. **Let the operator pick.** Settings > Presentation gets an **Output screen**
   row: Automatic (the default) or a list of the connected screens by label and
   size. Choosing one stores it and, if the Output is open, moves it. Labels are
   shown as the browser gives them, with "Built-in" for `isInternal`.
5. **Open it there, fullscreen**: `window.open` with that screen's `left`,
   `top`, `width` and `height`, then fullscreen on that screen as far as
   activation allows (open point 2).
6. **Follow the hardware.** On `screenschange`, a chosen screen that has gone
   leaves the Output where it is and shows a hint; a chosen screen that comes
   back is offered, not jumped to, because moving a live window mid-hymn is
   worse than leaving it.

**Everywhere else** (Firefox, Safari, a single screen, permission denied, any
error): today's popup. The Go live control gains a one-line hint the first time
the Output opens: drag it to the projector and press F11 (or the browser's
fullscreen). A denied permission is remembered, so the prompt does not return
and the hint is shown instead of an error.

Nothing about the **operator's** window changes, and the Output never uses the
Presentation API. Choosing the screen is a convenience: it fails soft to what
works today, so no step may block Go live.

### Consequences

Good:

- A Chromium laptop with a projector attached opens the Output on it without a
  drag, like PowerPoint, and remembers it for next week.
- No new dependency, no wrapper, no server. Permission is the browser's own and
  is asked once, at a moment the operator caused.
- The fallback is the shipped behaviour, so Firefox and Safari lose nothing.

Bad:

- Two paths to keep working and test, and the Chromium path can only be verified
  on a real two-screen machine (Playwright can fake `getScreenDetails`, not the
  hardware).
- "Most suitable" is a guess. A venue with a TV beside the projector, or the
  projector set as primary, picks wrong, and the answer is the manual pick.
- Safari, Firefox and all phones stay manual. That is most of the world's
  browsers, and the doc must say so plainly rather than imply parity.
- A stored label can match two identical monitors; the size does not separate
  them. Accepted: both are plausible, and the list is one tap.

Neutral:

- [ADR-0011](0011-defer-multi-device-sync-and-projector-output.md) is partly
  superseded: projector output through the web is no longer deferred. Sync is
  still deferred, and its "Revisit when" list is unchanged except for the
  wrapper line, which now matters only for browsers without the API.
- If the wrapper decision lands on Tauri, native monitor enumeration
  (`available_monitors()` in the window API) replaces step 1 and step 5 with no
  permission prompt and no activation limit, inside the wrapper only; the
  setting and the remembered choice carry over, and the web path stays for
  browsers.

## Alternatives

**The Presentation API.** Rejected. It hands screen choice to the browser's
picker, so "pick the best screen for me" cannot be done and the operator picks
every time. It offers Cast and Android displays, not an attached HDMI projector
on desktop Chrome, which is the common venue. It needs a receiver page with a
second messaging protocol beside the BroadcastChannel one. And it has no Firefox
or Safari support to offset the cost.

**Wait for Tauri.** Not rejected, only not required: Tauri would do this best,
with no prompt and no fullscreen limit, but the wrapper is deliberately deferred
([ADR-0006](0006-defer-the-native-wrapper-decision.md)) and the web path is
small. The design above is built so that native monitors slot in underneath.

**Do nothing.** The cost is one drag and one key press per service. That is real
but small, which is why the fallback keeps it as the floor and why the remaining
parts of this record are optional if open point 1 is answered no.

## Open points, answered

The user answered on 2026-10-02, each as recommended:

1. **Chromium-only now**: yes, a small Board item (#31) after #30.
2. **Fullscreen**: try fullscreen on the chosen screen; where the browser
   refuses without a gesture in the Output window, open it sized to the screen
   and let its first click or F key go fullscreen, with the hint. Prototyped on
   real two-screen hardware before the design is final.
3. **Permission**: asked on Go live, the first time, only when a second screen
   is attached (`screen.isExtended`); a "Detect screens" button in the Output
   screen setting as well.

## Implementation notes

### Wayland: a client cannot place its own window (2026-10-04)

Found on GNOME, Wayland, Chromium, two screens: Go Live opened the Output as an
ordinary window on the main screen, and the app still said it was on the
projector. A Wayland compositor decides where windows go: it ignores the
`left`/`top` in `window.open` and `moveTo`, and `screenX`/`screenY` read 0 or
mean nothing. Step 5 above ("open it there") therefore cannot be relied on, and
two things the first build assumed were wrong:

- the notice was raised from the Operator's own intent (the screen it asked for)
  and a grace timer, not from anything the window had done;
- `requestFullscreen()` with no `screen` goes fullscreen on whatever screen the
  window is on, and `moveOutputTo` and the position poll compared `screenX` with
  the screen's `left`, which a compositor can fool.

The fix does not depend on window position:

1. The Operator opens the Output at `?output=1&placed=1&screen=<json>`, where
   the JSON is the chosen screen's label, size and position (the key the app
   already remembers, plus the position to tell two identical monitors apart).
2. The Output calls `getScreenDetails()` itself (the permission is per origin),
   picks the matching screen, and on the first user activation (a click or F; it
   also tries once on load) calls `requestFullscreen({ screen })`. That places
   the window on the chosen screen on Wayland, X11, Windows and macOS. If the
   API or permission is missing, or the screen is gone, it falls back to a bare
   `requestFullscreen()`.
3. The Output reports over the channel whether it is _verifiably_ there:
   fullscreen on the screen it asked for, or a `currentScreen` that is the
   target. The Operator says "The Output is on the projector screen" only on
   that report. After the grace period without it, the notice says what to do:
   "Click the Output window (or press F there) to put it on <screen>." The
   Output shows a small prompt of its own, naming the screen, while the browser
   has refused fullscreen and until it is fullscreen. The position poll stands
   down once an Output reports for itself.

Not changed: the update gate, and End Live closing the window. Moving an open
Output from Settings still uses `moveTo`, which a Wayland compositor ignores; it
then says "could not move", which is true. Verifying on the real Wayland machine
is open point 2's remaining half.
