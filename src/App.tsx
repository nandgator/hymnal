import { createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { BUNDLED_HYMNBOOK_ID } from "./config.ts";
import type { Hymn, Hymnbook, HymnbookId, HymnNumber } from "./domain/types.ts";
import { Finder } from "./finder/Finder.tsx";
import { Library } from "./library/Library.tsx";
import { Output } from "./output/Output.tsx";
import { Presenter } from "./presenter/Presenter.tsx";
import { createMediaQuery, EXPANDED_QUERY } from "./shell/media.ts";
import { createPreferences, Settings } from "./shell/Settings.tsx";
import { Sheet } from "./shell/Sheet.tsx";
import { installScrollReveal } from "./shell/scrollReveal.ts";

/** The app's top-level sections (DESIGN.md § Structure, layer 1). Feedback,
 * About and Updates are reserved here, not built (PLAN Board #16–18). */
type Section = "present" | "library";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "present", label: "Present", icon: "icon-queue-music" },
  { id: "library", label: "Library", icon: "icon-library" },
];

/** The same page, loaded in a second window, is the Output — SDD-0001 §16.1. */
const OUTPUT_URL = `${import.meta.env.BASE_URL}?output=1`;
// A named target: clicking again focuses the already-open Output window
// instead of stacking a second one the operator would have to reposition.
const OUTPUT_WINDOW_NAME = "hymnal-output";

function isOutputWindow(): boolean {
  return new URLSearchParams(window.location.search).has("output");
}

/** Signal-based view state, not a router — SDD-0001 §12. */
function App() {
  return isOutputWindow() ? <Output /> : <Operator />;
}

/**
 * The layered shell, after Supabase Studio (DESIGN.md § Structure): sections
 * (a rail when wide, a menu on a phone), the switcher row — hymnbook ▾ /
 * hymn ▾, each a picker that hot-swaps in place — then the workspace, whose
 * width follows its content, and the dock/FAB.
 */
function Operator() {
  const expanded = createMediaQuery(EXPANDED_QUERY);
  // Applied at startup, whether or not a Settings sheet is open.
  const preferences = createPreferences();
  // Scrollbars fade in while a pane scrolls (DESIGN.md § Register).
  installScrollReveal();
  const [section, setSection] = createSignal<Section>("library");
  const [hymnbook, setHymnbook] = createSignal<Hymnbook>();
  const [hymnbookId, setHymnbookId] = createSignal<HymnbookId>(BUNDLED_HYMNBOOK_ID);
  const [hymnNumber, setHymnNumber] = createSignal<HymnNumber>();
  const [hymn, setHymn] = createSignal<Hymn>();

  const [menuOpen, setMenuOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [bookPickerOpen, setBookPickerOpen] = createSignal(false);
  const [hymnPickerOpen, setHymnPickerOpen] = createSignal(false);

  const go = (next: Section) => {
    setSection(next);
    setMenuOpen(false);
  };

  // Hot-swap (SDD-0001 §16.4): choosing a hymn from anywhere loads it in the
  // Presenter already on screen. Nothing is reopened or repositioned.
  const chooseHymn = (number: HymnNumber) => {
    setHymnNumber(number);
    setHymnPickerOpen(false);
    setSection("present");
  };

  // "Find a hymn", from anywhere: Present, plus the picker over the current
  // hymn if one is up. With none, Present already is the Finder, and a
  // picker on top would only duplicate it.
  const findHymn = () => {
    setSection("present");
    setMenuOpen(false);
    if (hymnNumber()) setHymnPickerOpen(true);
  };

  // Phase 1 installs one bundled hymnbook; the picker lists what's installed,
  // so a second book is data, not a change here (arc42 §2.3).
  const installed = () => {
    const book = hymnbook();
    return book ? [book] : [];
  };
  const chooseHymnbook = (id: HymnbookId) => {
    setBookPickerOpen(false);
    // The current hymn stays up until one is chosen from the new book, so
    // the audience never sees an empty screen mid-swap (§16.4).
    if (id !== hymnbookId()) setHymnbookId(id);
    findHymn();
  };

  const sectionButton = (item: (typeof SECTIONS)[number], variant: "rail" | "menu") => (
    <button
      type="button"
      class={variant === "rail" ? "rail-item" : "list-row menu-item"}
      aria-current={section() === item.id ? "page" : undefined}
      disabled={item.id === "present" && !hymnbook()}
      onClick={() => go(item.id)}
    >
      <span class={variant === "rail" ? "rail-indicator" : ""}>
        <span class={`icon ${item.icon}`} aria-hidden="true" />
      </span>
      <span class={variant === "rail" ? "rail-label" : ""}>{item.label}</span>
    </button>
  );

  return (
    <div class="shell">
      <Show when={expanded()}>
        <nav class="nav-rail" aria-label="Sections">
          <For each={SECTIONS}>{(item) => sectionButton(item, "rail")}</For>
          <div class="rail-foot">
            <button
              type="button"
              class="rail-item"
              aria-haspopup="dialog"
              onClick={() => setSettingsOpen(true)}
            >
              <span class="rail-indicator">
                <span class="icon icon-settings" aria-hidden="true" />
              </span>
              <span class="rail-label">Settings</span>
            </button>
          </div>
        </nav>
      </Show>

      <div class="shell-main">
        <header
          class="switcher-row"
          ref={(el) => {
            // A Finder's search bar sticks just under this row, whatever
            // height the text scale gives it.
            if (typeof ResizeObserver !== "function") return;
            const observer = new ResizeObserver(() =>
              el
                .closest<HTMLElement>(".shell")
                ?.style.setProperty("--switcher-height", `${el.offsetHeight}px`),
            );
            observer.observe(el);
            onCleanup(() => observer.disconnect());
          }}
        >
          <Show when={!expanded()}>
            <button
              type="button"
              class="btn-text icon-button"
              aria-haspopup="dialog"
              onClick={() => setMenuOpen(true)}
            >
              <span class="icon icon-menu" aria-hidden="true" />
              <span class="visually-hidden">Menu</span>
            </button>
          </Show>
          <nav class="crumbs" aria-label="Hymnbook and hymn">
            <Show when={hymnbook()} fallback={<span class="crumb-static">Hymnal</span>}>
              {(book) => (
                <button
                  type="button"
                  class="crumb"
                  aria-haspopup="dialog"
                  onClick={() => setBookPickerOpen(true)}
                >
                  <span class="crumb-text">{book().title}</span>
                  <span class="icon icon-expand" aria-hidden="true" />
                </button>
              )}
            </Show>
            <Show when={section() === "present" && hymn()}>
              {(current) => (
                <>
                  <span class="crumb-separator" aria-hidden="true">
                    /
                  </span>
                  <button
                    type="button"
                    class="crumb"
                    aria-haspopup="dialog"
                    onClick={() => setHymnPickerOpen(true)}
                  >
                    <span class="crumb-number">#{current().number}</span>
                    <span class="crumb-text">{current().title}</span>
                    <span class="icon icon-expand" aria-hidden="true" />
                  </button>
                </>
              )}
            </Show>
          </nav>
        </header>

        <main
          class="workspace"
          classList={{ "workspace-full": section() === "present" && !!hymnNumber() }}
        >
          <Switch>
            <Match when={section() === "library"}>
              <Library onLoaded={setHymnbook} onReady={findHymn} />
            </Match>
            <Match when={section() === "present" && !hymnNumber()}>
              <Finder hymnbookId={hymnbookId()} onSelect={chooseHymn} />
            </Match>
            <Match when={section() === "present" && hymnNumber()}>
              {(number) => (
                <Presenter
                  hymnNumber={number()}
                  hymnbookId={hymnbookId()}
                  onLoaded={setHymn}
                  navigator={preferences.preferences().navigator}
                  onNavigatorChange={(navigator) =>
                    preferences.update({ ...preferences.preferences(), navigator })
                  }
                  onBack={() => setHymnPickerOpen(true)}
                />
              )}
            </Match>
          </Switch>
        </main>
      </div>

      {/* The FAB belongs to the whole Operator, not one screen: the Output is
          opened once per service, often before the first hymn (§16.1). */}
      <button
        type="button"
        class="fab-extended fab-fixed"
        onClick={() => window.open(OUTPUT_URL, OUTPUT_WINDOW_NAME, "popup")}
      >
        <span class="icon icon-present" aria-hidden="true" />
        <span class="fab-label">Show Output</span>
      </button>

      <Sheet
        open={hymnPickerOpen()}
        onClose={() => setHymnPickerOpen(false)}
        title="Go to a hymn"
        placement={expanded() ? "center" : "bottom"}
      >
        <Finder hymnbookId={hymnbookId()} onSelect={chooseHymn} />
      </Sheet>

      <Sheet
        open={bookPickerOpen()}
        onClose={() => setBookPickerOpen(false)}
        title="Hymnbooks"
        placement={expanded() ? "center" : "bottom"}
      >
        <ul class="list">
          <For each={installed()}>
            {(book) => (
              <li>
                <button
                  type="button"
                  class="list-row"
                  aria-current={book.id === hymnbookId() ? "true" : undefined}
                  onClick={() => chooseHymnbook(book.id)}
                >
                  {book.title}
                  <span class="list-row-supporting"> — {book.hymnCount} hymns</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Sheet>

      <Sheet open={menuOpen()} onClose={() => setMenuOpen(false)} title="Menu">
        <nav aria-label="Sections">
          <ul class="list">
            <For each={SECTIONS}>{(item) => <li>{sectionButton(item, "menu")}</li>}</For>
          </ul>
        </nav>
        <Settings controller={preferences} />
      </Sheet>

      <Sheet
        open={settingsOpen()}
        onClose={() => setSettingsOpen(false)}
        title="Settings"
        placement="center"
      >
        <Settings controller={preferences} />
      </Sheet>
    </div>
  );
}

export default App;
