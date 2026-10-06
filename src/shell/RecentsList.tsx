import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import {
  groupByRecency,
  RECENCY_GROUP_TITLES,
  RECENCY_GROUPS,
  whenLabel,
} from "../domain/recency.ts";
import type { HymnbookId, HymnNumber } from "../domain/types.ts";
import { type ContentStore, getContentStore } from "../persistence/content-store.ts";
import {
  userState as defaultUserState,
  type RecentEntry,
  type UserState,
} from "../persistence/user-state.ts";
import { titleCase } from "./case.ts";
import { EMPHASIZED_BEZIER, GLIDE_MS, planCrossings } from "./glide-crossings.ts";
import { glideList } from "./glideList.ts";

export interface RecentsListProps {
  hymnbookId: HymnbookId;
  /** The hymn up now, if any, marked; its change also refreshes the list,
   * since opening a hymn records it as recent (SDD-0001 §14). */
  current?: HymnNumber;
  /** Defaults to {@link getContentStore}; overridable for tests. */
  store?: ContentStore;
  /** Defaults to the {@link defaultUserState} singleton; overridable for tests. */
  userState?: UserState;
  onSelect: (number: HymnNumber) => void;
  /** Changes when the stored recents were written from outside (a restore): the list is read again. */
  refresh?: number;
  /** Say nothing when there are none, instead of "No recent songs yet": the
   * Finder shows the book's songs in that place. */
  quietWhenEmpty?: boolean;
  /** Told how many recents there are, once read, and again when it changes. */
  onCount?: (count: number) => void;
}

/** How often the words ("Just now") and the groups (midnight) are
 * rechecked while the list is open. */
const REFRESH_MS = 30_000;

type RecentRow = RecentEntry & { title: string };

const EMPHASIZED = `cubic-bezier(${EMPHASIZED_BEZIER.join(", ")})`;
/** A heading whose group has emptied fades out quicker than rows travel. */
const GHOST_FADE_MS = 150;

/** The last list read, per user state and book, shown at once on the next
 * mount and replaced by the read every mount makes, so it's never older
 * than one screen. Memory only: the user's own song numbers and titles,
 * already on this device. */
const lastReads = new WeakMap<UserState, Map<HymnbookId, RecentRow[]>>();

/** Recents (SDD-0001 §16.4): this book's recent hymns, newest first, as
 * number, title and when. One list wherever recents show — the Operator's
 * tab, the Finder, the song picker — so they never drift apart. */
export function RecentsList(props: RecentsListProps) {
  const store = () => props.store ?? getContentStore();
  const state = () => props.userState ?? defaultUserState;
  const lastRead = () => {
    const byBook = lastReads.get(state()) ?? new Map<HymnbookId, RecentRow[]>();
    lastReads.set(state(), byBook);
    return byBook;
  };
  // Entries and titles read together, so each row arrives whole. The list
  // mounts only once its screen has loaded, so a fresh read would always
  // land a frame after the rest: the last list read shows at once, and the
  // read that follows refreshes it.
  const [recents, setRecents] = createSignal<RecentRow[] | undefined>(
    lastRead().get(props.hymnbookId),
  );
  // Now, for the words and the groups: it moves on, so a row that was "Just
  // now" ages, and at midnight Today becomes Yesterday, with the list open.
  const [now, setNow] = createSignal(Date.now());
  const refresh = setInterval(() => setNow(Date.now()), REFRESH_MS);
  onCleanup(() => clearInterval(refresh));
  const groups = createMemo(() => groupByRecency(recents() ?? [], now()));
  // A song chosen moves to the top: every row, and each group heading, glides
  // from where it was to where it lands (FLIP), a new one fades in, and a
  // heading whose group emptied fades out where it stood (DESIGN.md § Motion).
  // A row that passes over another is raised above it, and the one it
  // passes is out of sight while it does (planCrossings). A glide cut short
  // by another starts that one from where the rows settle. Reduced motion
  // lands at once.
  let list: HTMLDivElement | undefined;
  const glide = (apply: () => void) => {
    const keyed = () => [...(list?.querySelectorAll<HTMLElement>("[data-glide]") ?? [])];
    for (const el of keyed()) {
      for (const animation of el.getAnimations?.() ?? []) animation.cancel();
    }
    const before = new Map(
      keyed().map((el) => [el.dataset.glide, { el, rect: el.getBoundingClientRect() }]),
    );
    apply();
    if (before.size === 0 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timing = { duration: GLIDE_MS, easing: EMPHASIZED };
    const moves = keyed().map((el) => {
      const was = before.get(el.dataset.glide);
      const now = el.getBoundingClientRect();
      return { el, was, dy: was ? was.rect.top - now.top : 0, top: now.top, height: now.height };
    });
    const plans = planCrossings(
      moves.map(({ el, was, dy, top, height }) => ({
        key: el.dataset.glide ?? "",
        top,
        height,
        dy,
        fresh: !was,
      })),
    );
    for (const { el, dy } of moves) {
      const plan = plans.get(el.dataset.glide ?? "");
      if (dy) {
        // Raised only while it travels (a row's own stacking, `position:
        // relative`, is what lets it sit above the rows after it).
        const lift = plan?.lift ? { zIndex: 1 } : {};
        el.animate?.(
          [
            { transform: `translateY(${dy}px)`, ...lift },
            { transform: "none", ...lift },
          ],
          timing,
        );
      }
      // Its own clock, linear: the offsets are in time, so a fade lasts as
      // long early in the glide as late, whatever the easing is doing.
      if (plan?.fade) el.animate?.(plan.fade, { duration: GLIDE_MS, easing: "linear" });
    }
    // A heading whose group emptied is gone from the page: a copy stays at
    // its old place and fades.
    const box = list?.getBoundingClientRect();
    for (const [key, { el, rect }] of before) {
      if (!key?.startsWith("group-") || el.isConnected || !list || !box) continue;
      const ghost = el.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("id");
      ghost.removeAttribute("data-glide");
      ghost.setAttribute("aria-hidden", "true");
      ghost.style.cssText = `position:absolute;left:${rect.left - box.left}px;width:${rect.width}px;top:${rect.top - box.top}px;pointer-events:none`;
      list.append(ghost);
      const fade = ghost.animate?.([{ opacity: 1 }, { opacity: 0 }], {
        duration: GHOST_FADE_MS,
        easing: EMPHASIZED,
        // Held at the end until removed, so it can't flash back.
        fill: "forwards",
      });
      if (fade) fade.onfinish = () => ghost.remove();
      else ghost.remove();
    }
  };

  // Reads can overlap when songs change quickly; only the latest lands.
  let latest = 0;
  createEffect(
    on(
      () => ({ id: props.hymnbookId, current: props.current, refresh: props.refresh }),
      async ({ id }) => {
        const read = ++latest;
        const [entries, titles] = await Promise.all([state().getRecents(), store().listHymns(id)]);
        const rows = entries
          .filter((entry) => entry.hymnbookId === id)
          .map((entry) => ({
            ...entry,
            title: titles.find((hymn) => hymn.number === entry.hymnNumber)?.title ?? "",
          }));
        lastRead().set(id, rows);
        if (read === latest) glide(() => setRecents(rows));
      },
    ),
  );

  createEffect(() => {
    const rows = recents();
    if (rows) props.onCount?.(rows.length);
  });

  return (
    <Show
      when={recents()?.length}
      fallback={
        // Only once loaded: while loading, "No recent songs yet" would be
        // untrue for a moment.
        <Show when={recents() && !props.quietWhenEmpty}>
          <p class="body-large on-surface-variant recents-empty">No recent songs yet.</p>
        </Show>
      }
    >
      <div
        class="recents"
        ref={(el) => {
          list = el;
          // Hover is the app's one highlight, gliding between the rows. The
          // song that's up wears the tonal fill on its row, not a pill: the
          // rows themselves glide when a song is chosen.
          onCleanup(glideList(el, { rows: ".recents-row" }).stop);
        }}
      >
        {/* The groups are fixed, and each row is the same object across reads
            and refreshes, so a row that changes group moves rather than
            being rebuilt. */}
        <For each={RECENCY_GROUPS}>
          {(group) => (
            <Show when={groups()[group].length}>
              <div class="recents-group">
                <h3 class="recents-heading" data-glide={`group-${group}`}>
                  {RECENCY_GROUP_TITLES[group]}
                </h3>
                <ul class="list">
                  <For each={groups()[group]}>
                    {(entry) => (
                      <li data-glide={`hymn-${entry.hymnNumber}`}>
                        <button
                          type="button"
                          class="list-row recents-row"
                          aria-current={entry.hymnNumber === props.current ? "true" : undefined}
                          onClick={() => props.onSelect(entry.hymnNumber)}
                        >
                          <span class="recents-number">#{entry.hymnNumber}</span>
                          <span class="recents-title">{titleCase(entry.title)}</span>
                          <span class="recents-when">{whenLabel(entry.viewedAt, now())}</span>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>
          )}
        </For>
      </div>
    </Show>
  );
}
