import { ErrorBoundary, type JSX, onMount } from "solid-js";
import { DEFAULT_OUTPUT_THEME } from "../persistence/user-state.ts";

function Failed(props: {
  error: unknown;
  onFailed: () => void;
  themed: boolean;
  children: JSX.Element;
}) {
  onMount(() => {
    console.error("[hymnal] the Output failed", props.error);
    // The blank Output's ground comes from the theme the Output was told; a
    // failure before that (or in its own setup) takes the default one.
    const root = document.documentElement;
    if (props.themed && !root.hasAttribute("data-output-theme"))
      root.setAttribute("data-output-theme", DEFAULT_OUTPUT_THEME);
    props.onFailed();
  });
  return props.children;
}

/**
 * The Output's own boundary (SDD-0001 §16.9): when its view throws, what is
 * left is the blank Output (background, nothing on it), and the Operator is
 * told. Never an error message: the audience sees nothing.
 */
export function OutputBoundary(props: {
  children: JSX.Element;
  onFailed: () => void;
  /** What shows instead; the Output's blank ground by default. */
  fallback?: JSX.Element;
}) {
  return (
    <ErrorBoundary
      fallback={(error) => (
        <Failed error={error} onFailed={props.onFailed} themed={!("fallback" in props)}>
          {"fallback" in props ? props.fallback : <div class="output-idle" />}
        </Failed>
      )}
    >
      {props.children}
    </ErrorBoundary>
  );
}
