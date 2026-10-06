/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** The short commit and day of the build, or "dev" (vite.config.ts). */
declare const __APP_BUILD__: string;

/** The public-domain sample files in this build, under `sample/` (vite.config.ts). */
declare const __SAMPLE_FILES__: readonly string[];
