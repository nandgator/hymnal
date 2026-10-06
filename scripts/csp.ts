import type { Plugin } from "vite";

/**
 * The Content Security Policy of the built site (ADR-0030). GitHub Pages sends
 * no headers, so it travels in a `<meta>` tag, which cannot carry
 * `frame-ancestors`. Everything comes from the site's own origin.
 */
export const CSP_DIRECTIVES: Record<string, string> = {
  "default-src": "'self'",
  // 'wasm-unsafe-eval': SQLite's wasm compiles. No inline script, no eval.
  "script-src": "'self' 'wasm-unsafe-eval'",
  "worker-src": "'self'",
  "connect-src": "'self'",
  // data: is the icon masks inlined into the stylesheet.
  "img-src": "'self' data:",
  "font-src": "'self'",
  "style-src": "'self'",
  "object-src": "'none'",
  "base-uri": "'none'",
  "form-action": "'none'",
  "manifest-src": "'self'",
};

export const CSP = Object.entries(CSP_DIRECTIVES)
  .map(([name, value]) => `${name} ${value}`)
  .join("; ");

/** Puts the policy in the built `index.html` only: dev's HMR needs inline script. */
export function contentSecurityPolicy(): Plugin {
  return {
    name: "hymnal-csp",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
        injectTo: "head-prepend",
      },
    ],
  };
}
