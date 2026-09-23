import { createSignal, Match, Switch } from "solid-js";
import type { HymnNumber } from "./domain/types.ts";
import { Finder } from "./finder/Finder.tsx";
import { Library } from "./library/Library.tsx";
import { Output } from "./output/Output.tsx";
import { Presenter } from "./presenter/Presenter.tsx";
import { Settings } from "./shell/Settings.tsx";

type View = "library" | "finder" | "presenter";

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

function Operator() {
  const [view, setView] = createSignal<View>("library");
  const [hymnNumber, setHymnNumber] = createSignal<HymnNumber>();

  return (
    <>
      <header class="app-bar">
        <button
          type="button"
          class="btn-tonal"
          onClick={() => window.open(OUTPUT_URL, OUTPUT_WINDOW_NAME, "popup")}
        >
          Show Output
        </button>
        <Settings />
      </header>
      <main>
        <Switch>
          <Match when={view() === "library"}>
            <Library onReady={() => setView("finder")} />
          </Match>
          <Match when={view() === "finder"}>
            <Finder
              onSelect={(number) => {
                setHymnNumber(number);
                setView("presenter");
              }}
            />
          </Match>
          <Match when={view() === "presenter" && hymnNumber()}>
            {(number) => <Presenter hymnNumber={number()} onBack={() => setView("finder")} />}
          </Match>
        </Switch>
      </main>
    </>
  );
}

export default App;
