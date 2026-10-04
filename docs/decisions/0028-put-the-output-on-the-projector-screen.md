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
   is attached (`screen.isExtended`); a "Detect Screens" button in the Output
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

### Wayland: fullscreen cannot cross outputs either (2026-10-04)

Found on real hardware: GNOME on Wayland, Chromium, a built-in 1920×1080 display
and "HXA 32″" (1280×720) as the target. `requestFullscreen({ screen })` named
the HXA, and Chromium drew its "To exit full screen, press Esc" bubble there,
yet the window went fullscreen on the built-in display. On GNOME Wayland
Chromium cannot move a window to another output when it goes fullscreen, and a
web page cannot fix that. What it can do is notice, and make the honest path
smooth:

1. After a fullscreen request with a target screen, the Output compares
   `getScreenDetails().currentScreen` with the target (on the request's result,
   on `fullscreenchange` and on `currentscreenchange`). Fullscreen on any other
   screen means placement failed: the Output calls `document.exitFullscreen()`
   at once, so the main screen is not taken over, and remembers it for the
   session (`placementRefused` in `sessionStorage`; the Operator stores it too,
   so the next Output window inherits it).
2. It then says "Move this window to <screen>, then press F." and, on Linux only
   (`navigator.userAgentData?.platform` or `navigator.platform`),
   "Super+Shift+Arrow moves a window to the next screen." The Operator's notice
   says the same. F and clicks do nothing useful until the window is on the
   target.
3. When `currentscreenchange` shows the window on the target, the Output says
   "Press F or click to fill this screen". F or a click calls a bare
   `requestFullscreen()`, which is right because it is the same output. The
   Operator's "The Output is on the projector screen" still comes only from the
   Output's verified report; the report carries `refused` so the Operator
   chooses the move notice over the click notice.
4. Once refused in a session, the next Go Live skips the cross-screen attempt
   and goes straight to the guidance.

A readable `currentScreen` now decides "on the target"; "fullscreen on the
screen it asked for" counts only where `currentScreen` is unavailable.

For automatic placement, run Chromium under XWayland, where window positioning
works: start it with `--ozone-platform=x11`, or set chrome://flags "Preferred
Ozone platform" to X11 and relaunch. The full answer is the native wrapper
(Tauri, later), which can place a window on an output itself.

### Wayland: F is never gated, and the report can be "unconfirmed" (2026-10-04)

Found on the same hardware: after Super+Shift+Arrow moved the Output to the
projector, F did nothing. The previous note gated F and click on `currentScreen`
being the target, but on GNOME Wayland Chromium does not update `currentScreen`
(or fire `currentscreenchange`) when the compositor moves the window, so the
gate never opened. A person's explicit F is never gated now:

- once placement has been refused, F and a click always call a bare
  `requestFullscreen()`, which fills the screen the window is on;
- the Output then re-reads the screens with a fresh `getScreenDetails()` (the
  cached object may be stale) after the request, on `fullscreenchange`, on
  `resize` and on `visibilitychange`, which a Wayland move does fire;
- it reports `onTarget` only if that fresh `currentScreen` is the target.
  Otherwise the report is fullscreen with `unconfirmed: true`, and the Operator
  says what is true: "The Output is fullscreen. If it isn't on <screen>, press
  Esc there, move it, and press F again." The move guidance stays until then.

**F toggles (2026-10-04).** In the Output, F on a fullscreen window leaves
fullscreen, as Esc does, and is not forwarded to the Operator; F again goes back
in. So the message can say "press F again" whichever state it is in.

### The placement hints leave the projector's text (2026-10-04)

The Output is what the audience sees, so it carries no instructions as text. The
Operator's notice says them in full ("Move this window to <screen>, then press
F." and, on Linux, the Super+Shift+Arrow line). The Output shows a small info
icon in a corner while it is not fullscreen and a placement hint applies (the
move guidance, "Press F or click to fill this screen", or the click prompt after
a refused fullscreen request). Its short instruction is a tooltip that shows on
hover or focus; the icon itself is shown only while the cursor is awake (the
same idle timer that hides the cursor), or while hovered or focused. It is gone
while fullscreen, and the Linux shortcut is not on the Output at all. F and a
click behave as before. The notes above that say the Output "says" these lines
mean this tooltip.

### Displays plugged in or out while the app is open (2026-10-04)

`screenschange` on the `ScreenDetails`, and `screen.onchange` with `isExtended`
where the details are not granted, keep Settings' screen list and notes live.
While live, a projector that appears while the Output is on the main screen is
_offered_ ("A projector is connected: <name>", "Move the Output There"), never
moved to: where placement was refused this session the action gives the move
guidance instead. The Output's screen disappearing says where the Output is now
and offers Blank, since the audience screen is gone and the Output may be on the
operator's own. Bursts of events are debounced (300 ms). Not live, nothing is
said, and Go Live picks the new screen as Automatic does. This replaces step 6's
"gone" hint.

### Mirrored displays are an OS setting (2026-10-04)

A projector connected as a mirror (duplicate) is one screen to the browser, and
a web page cannot switch the OS from mirror to extend: that is OS-only. The app
says so where it matters (Settings after Detect Screens with one screen, and Go
Live with one screen) and gives the step per OS: Windows Win+P → Extend; macOS
System Settings → Displays, set as Extended display (not Mirror); GNOME Settings
→ Displays → Join Displays (Super+P cycles modes on many setups). A native
wrapper could call the OS display APIs later.
