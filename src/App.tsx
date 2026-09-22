import { createSignal, Match, Switch } from "solid-js";
import { Finder } from "./finder/Finder.tsx";
import { Library } from "./library/Library.tsx";

type View = "library" | "finder";

/** Signal-based view state, not a router — SDD-0001 §12. */
function App() {
  const [view, setView] = createSignal<View>("library");

  return (
    <Switch>
      <Match when={view() === "library"}>
        <Library onReady={() => setView("finder")} />
      </Match>
      <Match when={view() === "finder"}>
        <Finder />
      </Match>
    </Switch>
  );
}

export default App;
