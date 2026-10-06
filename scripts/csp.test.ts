// @vitest-environment node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CSP, contentSecurityPolicy } from "./csp.ts";

describe("the Content Security Policy (ADR-0030)", () => {
  it("is injected into the built index.html as a meta tag, first in the head", async () => {
    const plugin = contentSecurityPolicy();
    expect(plugin.apply).toBe("build");
    const hook = plugin.transformIndexHtml;
    const fn = typeof hook === "function" ? hook : hook?.handler;
    const tags = await (fn as () => unknown)();
    expect(tags).toEqual([
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
        injectTo: "head-prepend",
      },
    ]);
  });

  it("allows scripts, workers, connections and frames from the site only", () => {
    expect(CSP).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(CSP).toContain("connect-src 'self'");
    expect(CSP).toContain("object-src 'none'");
    expect(CSP).toContain("form-action 'none'");
    expect(CSP).toContain("base-uri 'none'");
    expect(CSP).not.toMatch(/(?<!wasm-)unsafe-eval'|script-src[^;]*unsafe-inline|https?:|\*/);
    expect(CSP).not.toContain("frame-ancestors"); // not honoured in a meta tag
  });

  const built = new URL("../dist/index.html", import.meta.url);
  it.skipIf(!existsSync(built))("is in dist/index.html, when there is a build", () => {
    const html = readFileSync(built, "utf8");
    expect(html).toContain(`http-equiv="Content-Security-Policy"`);
    // Vite writes the policy's quotes as character references; a browser reads them back.
    expect(html).toContain(`content="${CSP.replaceAll("'", "&#39;")}"`);
  });

  // deploy.yml ignores seroval's advisories on this ground: Solid's server
  // serializer is not in the client bundle.
  const assets = new URL("../dist/assets/", import.meta.url);
  it.skipIf(!existsSync(assets))(
    "ships no seroval in dist/assets, so its audit ignore holds",
    () => {
      const shipping = readdirSync(assets).filter((name) =>
        readFileSync(new URL(name, assets), "utf8").includes("seroval"),
      );
      expect(shipping).toEqual([]);
    },
  );
});
