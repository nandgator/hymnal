import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  // opfs-sahpool needs no COOP/COEP headers (unlike the "opfs" VFS), but the
  // dev server must not pre-bundle this package — see its README.
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
});
