// Stands in for vite-plugin-pwa's virtual module so Vitest, which loads no PWA
// plugin, can resolve the import. It does nothing: tests that exercise
// registration pass their own registerSW.
export function registerSW(): () => Promise<void> {
  return async () => {};
}
