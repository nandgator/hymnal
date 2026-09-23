import { createSignal, Match, Switch } from "solid-js";
import type { HymnNumber } from "./domain/types.ts";
import { Finder } from "./finder/Finder.tsx";
import { Library } from "./library/Library.tsx";
import { Presenter } from "./presenter/Presenter.tsx";

type View = "library" | "finder" | "presenter";

/** Signal-based view state, not a router — SDD-0001 §12. */
function App() {
  const [view, setView] = createSignal<View>("library");
  const [hymnNumber, setHymnNumber] = createSignal<HymnNumber>();

  return (
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
  );
}

export default App;
