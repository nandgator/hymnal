import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import solid from "vite-plugin-solid";

// GitHub Pages serves a project page from /<repo>/, never the domain root —
// only the production build needs that; dev and preview stay at "/".
const BASE = "/hymnal/";

export default defineConfig(({ command, isPreview }) => ({
  // isPreview, not just command === "build" — `vite preview` also reports
  // command "serve", but it serves the already-built dist/, whose URLs are
  // already baked in at BASE.
  base: command === "build" || isPreview ? BASE : "/",
  plugins: [
    solid(),
    VitePWA({
      registerType: "autoUpdate",
      // The bundled hymnbook (public/content/*.sqlite) is fetched once by
      // ContentStore and persisted to OPFS itself (SDD-0001 §10) — it must
      // not also sit in the service worker's precache, which exists only to
      // make the app shell (JS/CSS/fonts/wasm) available offline (arc42 §7,
      // §8.5: content and app-shell caching are deliberately separate
      // lifecycles). wasm is the app shell, not content — sqlite3's own
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
        background_color: "#222222",
        theme_color: "#222222",
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
