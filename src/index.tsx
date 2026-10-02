/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

render(() => <App />, root);

if (import.meta.env.DEV) {
  void import("./dev/hymnal-dev.ts").then((m) => m.installHymnalDev());
}
