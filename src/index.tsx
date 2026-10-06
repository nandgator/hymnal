/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App.tsx";
import { installErrorLogging } from "./shell/errorLog.ts";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

installErrorLogging();
render(() => <App />, root);
