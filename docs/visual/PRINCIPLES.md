# What makes a design great — working notes

The rules DESIGN.md's specifics answer to. When a screen feels cheap, it has
usually broken one of these, not lacked a feature. Sources at the end.

## Good design

1. **Hierarchy decides everything.** Each screen has one primary action, a few
   secondary ones, and the rest tertiary. The primary gets the one filled
   button; nothing else competes with it (Material 3: "one screen, one primary
   button").
2. **Emphasise by de-emphasising.** When something won't stand out, quiet what
   competes with it (weight and colour before size) rather than making it louder
   (Refactoring UI).
3. **Constrained scales.** Spacing, type, radii, elevation and heights come from
   short fixed scales. A value off the scale reads as a mistake even when no one
   can say why.
4. **One shape, one icon set, one control height per role.** Rounded or
   squircle, never both; one icon family; a group of related buttons shares one
   size and one style.
5. **The interface is a fixed size; content scales** (ADR-0017).
6. **States are uniform.** Disabled is the same treatment on every control
   (Material and Apple: the whole control at about 38%), not a grey slab here
   and faded text there. Selected is a fill, not a fill plus a tick that shifts
   the label.
7. **Elevation means something.** Resting surfaces are flat and tonal; only what
   floats above the page (menus, the command menu, a snackbar) casts a shadow,
   from a two- or three-step scale. If everything floats, nothing does.
8. **Labels earn their place.** Text that restates what the control already
   shows ("Jump to any part" above a keypad) is noise.

## Great design

1. **Emphasis follows the task over time.** Before a service the job is to
   present; during it, to move on. The loudest control is the one the moment
   needs, and a one-off action becomes a status once done.
2. **Motion explains change.** Expanding, collapsing, closing, splitting and
   opening the command menu animate from where they start to where they end,
   quickly (200–300ms, emphasised easing), and never for decoration.
   Reduced-motion users get the end state.
3. **Rhythm.** Gaps between areas, above them and below them are the same
   number. Edges line up across areas.
4. **Words match the user's world.** "Song" where a worship leader would say
   song; no internal terms on screen. One case rule, applied everywhere: Title
   Case for what's pressed, sentence case for what's read (DESIGN.md § Words).
5. **Push a little further.** A design that works is where refinement starts:
   ask "would someone just know to press this?" and keep going (Martin Keary, on
   MuseScore 4 and Audacity 4). Keep what users already know (their shortcuts,
   their layout) while changing everything else.

## Sources

- Material 3, [buttons](https://m3.material.io/components/buttons/guidelines),
  [states](https://m3.material.io/foundations/interaction/states/applying-states),
  [type scale](https://m3.material.io/styles/typography/type-scale-tokens)
- Apple,
  [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- Refactoring UI (Wathan and Schoger),
  [summary](https://www.sglavoie.com/posts/2023/09/09/book-summary-refactoring-ui/)
- Martin Keary,
  [NAMM 2025 interview](https://www.scoringnotes.com/news/namm-2025-musing-on-software-and-design-with-martin-keary/);
  [Audacity 4](https://www.mu.se/posts/audacity-version-4)
- VS Code modern UI,
  [issue #334285](https://github.com/microsoft/vscode/issues/334285)
