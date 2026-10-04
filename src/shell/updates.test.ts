import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppUpdates,
  createPresence,
  homeScreenHint,
  pickNotice,
  restartIfAllowed,
  shouldReloadOnTakeover,
  UPDATE_CHECK_MS,
  updateGate,
} from "./updates.ts";

const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const CHROME_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";

describe("updateGate", () => {
  it("prompts and applies once an update waits and the Output is not live", () => {
    expect(updateGate({ ready: true, live: false })).toEqual({ prompt: true, apply: true });
  });

  it("neither prompts nor applies while the Output is live", () => {
    expect(updateGate({ ready: true, live: true })).toEqual({ prompt: false, apply: false });
  });

  it("does nothing with no update waiting", () => {
    expect(updateGate({ ready: false, live: false })).toEqual({ prompt: false, apply: false });
  });
});

describe("updateGate, prompt and apply", () => {
  it("always agree: what may be announced may be applied, and no more", () => {
    for (const ready of [true, false])
      for (const live of [true, false]) {
        const gate = updateGate({ ready, live });
        expect(gate.prompt).toBe(gate.apply);
      }
  });
});

describe("restartIfAllowed", () => {
  it("restarts when an update waits and the Output is not live", () => {
    const restart = vi.fn();
    expect(restartIfAllowed({ ready: true, live: false }, restart)).toBe(true);
    expect(restart).toHaveBeenCalledOnce();
  });

  it("refuses while live, and with nothing waiting", () => {
    const restart = vi.fn();
    expect(restartIfAllowed({ ready: true, live: true }, restart)).toBe(false);
    expect(restartIfAllowed({ ready: false, live: false }, restart)).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  });
});

describe("createPresence", () => {
  afterEach(() => vi.useRealTimers());

  it("counts as live until the Output has had time to answer", () => {
    vi.useFakeTimers();
    createRoot((dispose) => {
      const presence = createPresence(() => () => {}, 1000);
      expect(presence.known()).toBe(false);
      expect(presence.live()).toBe(true);
      // Restart is refused in that window.
      const restart = vi.fn();
      expect(restartIfAllowed({ ready: true, live: presence.live() }, restart)).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(presence.known()).toBe(true);
      expect(presence.live()).toBe(false);
      dispose();
    });
  });

  it("is known at once when an Output answers, and live while it is open", () => {
    createRoot((dispose) => {
      let report: (open: boolean) => void = () => {};
      const presence = createPresence((handler) => {
        report = handler;
        return () => {};
      });
      report(true);
      expect(presence.known()).toBe(true);
      expect(presence.live()).toBe(true);
      report(false);
      expect(presence.live()).toBe(false);
      dispose();
    });
  });

  it("unsubscribes when its owner goes", () => {
    const unsubscribe = vi.fn();
    createRoot((dispose) => {
      createPresence(() => unsubscribe);
      dispose();
    });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("shouldReloadOnTakeover", () => {
  it("reloads an idle tab that had a worker", () => {
    expect(shouldReloadOnTakeover({ hadController: true, live: false, restarting: false })).toBe(
      true,
    );
  });

  it("never reloads a live tab, a first install, or the tab that is restarting", () => {
    expect(shouldReloadOnTakeover({ hadController: true, live: true, restarting: false })).toBe(
      false,
    );
    expect(shouldReloadOnTakeover({ hadController: false, live: false, restarting: false })).toBe(
      false,
    );
    expect(shouldReloadOnTakeover({ hadController: true, live: false, restarting: true })).toBe(
      false,
    );
  });
});

describe("createAppUpdates", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("checks for a new version hourly and on becoming visible, until disposed", async () => {
    vi.stubEnv("PROD", true);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const update = vi.fn(async () => {});
    let onNeedRefresh: () => void = () => {};
    const apply = vi.fn(async () => {});
    let dispose = () => {};
    let updates!: ReturnType<typeof createAppUpdates>;
    createRoot((d) => {
      dispose = d;
      updates = createAppUpdates(
        () => false,
        async () =>
          ({
            registerSW: (options?: {
              onNeedRefresh?: () => void;
              onRegisteredSW?: (url: string, registration?: unknown) => void;
            }) => {
              onNeedRefresh = options?.onNeedRefresh ?? (() => {});
              options?.onRegisteredSW?.("/sw.js", { update });
              return apply;
            },
          }) as never,
      );
    });
    await vi.dynamicImportSettled();
    await Promise.resolve();
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(update).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(update).toHaveBeenCalledTimes(2);

    expect(updates.ready()).toBe(false);
    onNeedRefresh();
    expect(updates.ready()).toBe(true);
    updates.restart();
    expect(apply).toHaveBeenCalledWith(true);

    dispose();
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(update).toHaveBeenCalledTimes(2);
  });
});

describe("pickNotice", () => {
  const idle = { update: { ready: false, live: false }, safariHint: false, updateDismissed: false };

  it("shows nothing by default", () => {
    expect(pickNotice(idle)).toBeUndefined();
  });

  it("puts the update before the Safari hint", () => {
    expect(pickNotice({ ...idle, update: { ready: true, live: false }, safariHint: true })).toBe(
      "update",
    );
  });

  it("falls back to the hint once the update is put off", () => {
    expect(
      pickNotice({
        update: { ready: true, live: false },
        safariHint: true,
        updateDismissed: true,
      }),
    ).toBe("safari-hint");
  });

  it("puts the keep-your-file note after the update and before the Safari hint", () => {
    const keep = { ...idle, keepFile: true, safariHint: true };
    expect(pickNotice(keep)).toBe("keep-file");
    expect(pickNotice({ ...keep, update: { ready: true, live: false } })).toBe("update");
    expect(
      pickNotice({ ...keep, update: { ready: true, live: false }, updateDismissed: true }),
    ).toBe("keep-file");
  });

  it("shows nothing at all while live, the keep-your-file note included", () => {
    expect(pickNotice({ ...idle, keepFile: true, update: { ready: false, live: true } })).toBe(
      undefined,
    );
  });

  it("shows nothing at all while live, hint included", () => {
    expect(
      pickNotice({ update: { ready: true, live: true }, safariHint: true, updateDismissed: false }),
    ).toBeUndefined();
  });

  it("shows a screen notice first, and even while live", () => {
    const live = { ...idle, update: { ready: true, live: true }, safariHint: true };
    expect(pickNotice({ ...live, screen: "disconnected" })).toBe("disconnected");
    expect(pickNotice({ ...idle, update: { ready: true, live: false }, screen: "drag" })).toBe(
      "drag",
    );
  });

  it("holds the update back only while a screen notice is up", () => {
    const live = { ...idle, update: { ready: true, live: true } };
    expect(pickNotice({ ...live, screen: "drag" })).toBe("drag");
    expect(pickNotice({ ...live, screen: undefined })).toBeUndefined();
    const closed = { ...live, update: { ready: true, live: false } };
    expect(pickNotice({ ...closed, screen: undefined })).toBe("update");
  });

  it("brings the update back when the Output closes", () => {
    const waiting = { ...idle, update: { ready: true, live: true } };
    expect(pickNotice(waiting)).toBeUndefined();
    expect(pickNotice({ ...waiting, update: { ready: true, live: false } })).toBe("update");
  });
});

describe("homeScreenHint", () => {
  it("suggests the Dock on Safari for Mac", () => {
    expect(homeScreenHint({ userAgent: SAFARI_MAC, maxTouchPoints: 0 })).toBe("dock");
  });

  it("suggests the Home Screen on iPhone and on iPadOS posing as a Mac", () => {
    expect(homeScreenHint({ userAgent: SAFARI_IPHONE, maxTouchPoints: 5 })).toBe("home-screen");
    expect(homeScreenHint({ userAgent: SAFARI_MAC, maxTouchPoints: 5 })).toBe("home-screen");
  });

  it("treats iPadOS's desktop-class user agent, with touch, as the Home Screen", () => {
    expect(homeScreenHint({ userAgent: SAFARI_MAC, maxTouchPoints: 5, standalone: false })).toBe(
      "home-screen",
    );
  });

  it("leaves Safari on the Mac alone once added to the Dock", () => {
    expect(
      homeScreenHint({ userAgent: SAFARI_MAC, maxTouchPoints: 0, standalone: true }),
    ).toBeUndefined();
  });

  it("leaves an installed Safari app alone", () => {
    expect(homeScreenHint({ userAgent: SAFARI_IPHONE, standalone: true })).toBeUndefined();
  });

  it("leaves other browsers alone, Chrome on iOS included", () => {
    expect(homeScreenHint({ userAgent: CHROME })).toBeUndefined();
    expect(homeScreenHint({ userAgent: CHROME_IOS })).toBeUndefined();
  });
});
