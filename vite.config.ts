import { readdirSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import solid from "vite-plugin-solid";

// The site defaults to the root of its domain. A deploy under a subpath, such
// as a GitHub Pages project URL, sets BASE_PATH=/<repo>/ for the build. Only
// the production build and preview use it; dev stays at "/".
const BASE = `/${(process.env.BASE_PATH ?? "").replace(/^\/+|\/+$/g, "")}/`.replace("//", "/");

// The JSON Schemas' source of truth is src/schema/1/ (code imports them; Vite
// forbids importing from public/). The published URLs stay /schema/1/<file>:
// served in dev, emitted into the build (ADR-0022).
const SCHEMA_DIR = new URL("./src/schema/1/", import.meta.url);
const schemaFiles = () => readdirSync(SCHEMA_DIR).filter((name) => name.endsWith(".schema.json"));
function publishSchemas(): Plugin {
  let base = "/";
  return {
    name: "hymnal-publish-schemas",
    configResolved: (config) => {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split("?")[0]?.slice(`${base}schema/1/`.length);
        if (!req.url?.startsWith(`${base}schema/1/`) || !name || !schemaFiles().includes(name))
          return next();
        res.setHeader("Content-Type", "application/schema+json");
        res.end(readFileSync(new URL(name, SCHEMA_DIR)));
      });
    },
    generateBundle() {
      for (const name of schemaFiles())
        this.emitFile({
          type: "asset",
          fileName: `schema/1/${name}`,
          source: readFileSync(new URL(name, SCHEMA_DIR)),
        });
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  // isPreview, not just command === "build" — `vite preview` also reports
  // command "serve", but it serves the already-built dist/, whose URLs are
  // already baked in at BASE.
  base: command === "build" || isPreview ? BASE : "/",
  plugins: [
    solid(),
    publishSchemas(),
    VitePWA({
      // "prompt", not "autoUpdate": a new version downloads and waits; the
      // shell offers Restart, never while the Output is live (SDD-0001 §15,
      // PLAN Board #32). autoUpdate skipped waiting and reloaded at once.
      registerType: "prompt",
      // Books are loaded into OPFS by the content store (SDD-0004), never
      // precached: the service worker's precache exists only to make the app
      // shell (JS/CSS/fonts/wasm) available offline (arc42 §7, §8.5: content
      // and app-shell caching are deliberately separate lifecycles). Nothing
      // ships under content/ now (ADR-0026); the glob stays for a sample. wasm is the app shell, not content — sqlite3's own
      // binary, without which nothing else works — and was missing here
      // until offline testing against a real build caught it.
      workbox: {
        globPatterns: ["**/*.{js,css,html,wasm,woff2,svg,png}"],
        globIgnores: ["content/**"],
      },
      manifest: {
        name: "Hymnal",
        short_name: "Hymnal",
        description: "A multilingual hymnal for presenting hymns during a service.",
        start_url: BASE,
        scope: BASE,
        display: "standalone",
        background_color: "#17130d",
        theme_color: "#17130d",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  // opfs-sahpool needs no COOP/COEP headers (unlike the "opfs" VFS), but the
  // dev server must not pre-bundle this package — see its README.
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
}));
