/**
 * Choosing the screen the Output opens on (ADR-0028, SDD-0001 §16.1): pure,
 * screens in and a choice out, so every fallback is testable without a second
 * monitor. The Window Management API itself is in `shell/outputScreens.ts`.
 */

/** What the choice needs of a `ScreenDetailed`, copied so it can be stored and compared. */
export interface ScreenInfo {
  label: string;
  width: number;
  height: number;
  left: number;
  top: number;
  isPrimary: boolean;
  isInternal: boolean;
}

/** How a chosen screen is remembered: not its position, which changes when
 * the operator rearranges displays (ADR-0028 step 3). */
export interface ScreenKey {
  label: string;
  width: number;
  height: number;
}

export const keyOf = (screen: ScreenKey): ScreenKey => ({
  label: screen.label,
  width: screen.width,
  height: screen.height,
});

export const sameKey = (a: ScreenKey, b: ScreenKey) =>
  a.label === b.label && a.width === b.width && a.height === b.height;

/** The same physical screen: the key and the place. */
const sameScreen = (a: ScreenInfo, b: ScreenInfo) =>
  sameKey(a, b) && a.left === b.left && a.top === b.top;

/** Only a well-formed stored value counts; anything else is Automatic. */
export function rememberedScreenOf(value: unknown): ScreenKey | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { label, width, height } = value as Record<string, unknown>;
  if (typeof label !== "string" || typeof width !== "number" || typeof height !== "number")
    return undefined;
  return { label, width, height };
}

export type ScreenChoice =
  | { screen: ScreenInfo; why: "remembered" | "automatic" }
  | { screen: undefined; why: "none" };

export interface ChooseInput {
  screens: readonly ScreenInfo[];
  /** The screen the operator's window is on. */
  current?: ScreenInfo;
  /** The operator's pick; absent is Automatic. */
  remembered?: ScreenKey;
}

/**
 * The screen to open on. The operator's own pick wins if it is still
 * attached (of two identical monitors, the one the operator is not on).
 * Otherwise Automatic: an external screen that is not primary and not the
 * operator's, the largest, then the landscape one. The API cannot say which is
 * a projector, so size is a tiebreaker only. No qualifying screen is `none`,
 * and the caller opens the window as it always has.
 */
export function chooseScreen({ screens, current, remembered }: ChooseInput): ScreenChoice {
  if (screens.length < 2 && !remembered) return { screen: undefined, why: "none" };
  if (remembered) {
    const matches = screens.filter((screen) => sameKey(screen, remembered));
    const match = matches.find((screen) => !current || !sameScreen(screen, current)) ?? matches[0];
    if (match) return { screen: match, why: "remembered" };
  }
  if (screens.length < 2) return { screen: undefined, why: "none" };
  const candidates = screens
    .filter(
      (screen) =>
        !screen.isInternal && !screen.isPrimary && !(current && sameScreen(screen, current)),
    )
    .map((screen, index) => ({ screen, index }))
    .sort(
      (a, b) =>
        b.screen.width * b.screen.height - a.screen.width * a.screen.height ||
        Number(b.screen.width >= b.screen.height) - Number(a.screen.width >= a.screen.height) ||
        a.index - b.index,
    );
  const best = candidates[0]?.screen;
  return best ? { screen: best, why: "automatic" } : { screen: undefined, why: "none" };
}

/** The label as the browser gives it, "Built-in" for the laptop's own panel, with its size. */
export function describeScreen(screen: ScreenKey & { isInternal?: boolean }, index = 0): string {
  const name = screen.isInternal ? "Built-in" : screen.label || `Screen ${index + 1}`;
  return `${name}, ${screen.width}×${screen.height}`;
}

/** `window.open` features that put a popup on the screen, covering it. */
export const featuresFor = (screen: ScreenInfo) =>
  `popup,left=${screen.left},top=${screen.top},width=${screen.width},height=${screen.height}`;

/** The screen holding a point (a window's centre): where the Output really is. */
export const screenAt = (screens: readonly ScreenInfo[], x: number, y: number) =>
  screens.find(
    (screen) =>
      x >= screen.left &&
      x < screen.left + screen.width &&
      y >= screen.top &&
      y < screen.top + screen.height,
  );
