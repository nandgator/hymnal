import { For, Show } from "solid-js";
import { REPORT_URL, SAMPLE_FILES, SAMPLE_RIGHTS_URL } from "../config.ts";
import { type ContentAdmin, getContentAdmin } from "../persistence/content-store.ts";
import { userState as defaultUserState, type UserStateHandle } from "../persistence/user-state.ts";

const PRIVACY =
  "The hymnal keeps everything on this device: your books, your settings and the hymns you have sung. Nothing is sent anywhere, and there is no tracking and no cookies. The site is hosted on GitHub Pages, which logs visitors’ IP addresses under GitHub’s own privacy statement.";

const YOUR_BOOKS =
  "The books you load are yours to load: you answer for having the right to use them.";
// Said only where this build offers the sample (Board #43): elsewhere it would not be true.
const SAMPLE_BOOKS =
  "The sample books offered in the Library are in the public domain, and each song’s record says why.";

/** What the app is built from, each with the licence it carries (ADR-0016). */
const CREDITS: { name: string; licence: string }[] = [
  {
    name: "Hymnal Sans (renamed Google Sans)",
    licence: "SIL OFL 1.1",
  },
  { name: "SQLite", licence: "public domain" },
  { name: "SolidJS", licence: "MIT" },
  { name: "idb", licence: "ISC" },
  { name: "Comlink", licence: "Apache 2.0" },
  { name: "fflate", licence: "MIT" },
  { name: "pdf.js", licence: "Apache 2.0" },
  { name: "fast-xml-parser", licence: "MIT" },
  { name: "The hymnal itself", licence: "Apache 2.0" },
];

const MB = 1024 * 1024;
const megabytes = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;

export interface DiagnosticsSources {
  admin: Pick<ContentAdmin, "listBooks" | "storageMode">;
  state: Pick<UserStateHandle, "mode">;
}

/**
 * What Copy Diagnostics puts on the clipboard (SDD-0001 §16.10): the build,
 * the device, the storage and the books by state as counts. No titles, no
 * recents, no lyrics.
 */
export async function diagnostics({ admin, state }: DiagnosticsSources): Promise<string> {
  const storage = navigator.storage as StorageManager | undefined;
  const persisted = await storage?.persisted?.().catch(() => undefined);
  const estimate = await storage?.estimate?.().catch(() => undefined);
  const mode = await admin.storageMode().catch(() => "unknown");
  const rows = await admin.listBooks().catch(() => []);
  const byState = new Map<string, number>();
  for (const row of rows) byState.set(row.state, (byState.get(row.state) ?? 0) + 1);
  const books =
    byState.size === 0
      ? "none"
      : [...byState].map(([name, number]) => `${name} ${number}`).join(", ");
  return [
    `Build: ${__APP_BUILD__}`,
    `User agent: ${navigator.userAgent}`,
    `Screen: ${screen.width}x${screen.height} at ${window.devicePixelRatio}x`,
    `Storage persisted: ${persisted === undefined ? "unknown" : persisted ? "yes" : "no"}`,
    `Storage estimate: ${
      estimate?.usage === undefined || estimate.quota === undefined
        ? "unknown"
        : `${megabytes(estimate.usage)} of ${megabytes(estimate.quota)}`
    }`,
    `Store mode: ${mode}`,
    `User state mode: ${state.mode()}`,
    `Books: ${books}`,
  ].join("\n");
}

/** About (SDD-0001 §16.10): the app, privacy, the books, a problem, credits. */
export function About(
  props: Partial<DiagnosticsSources> & { onNotice?: (message: string) => void },
) {
  const copy = async () => {
    try {
      const text = await diagnostics({
        admin: props.admin ?? getContentAdmin(),
        state: props.state ?? defaultUserState,
      });
      await navigator.clipboard.writeText(text);
      props.onNotice?.("Diagnostics copied");
    } catch {
      props.onNotice?.("Couldn’t copy the diagnostics");
    }
  };

  return (
    <section class="settings-section about" id="settings-about" aria-labelledby="about-title">
      <h3 id="about-title" class="settings-heading">
        About
      </h3>

      <div class="about-group">
        <h4 id="about-app" class="settings-subheading">
          The app
        </h4>
        <div class="settings-row">
          <span class="settings-label">
            Hymnal
            <span class="settings-supporting">
              A hymnal for presenting hymns in any language, on a screen or a projector.
            </span>
          </span>
        </div>
        <div class="settings-row">
          <span class="settings-label">
            Build
            <span class="settings-supporting about-build">{__APP_BUILD__}</span>
          </span>
        </div>
      </div>

      <div class="about-group">
        <h4 id="about-privacy" class="settings-subheading">
          Privacy
        </h4>
        <p class="settings-note">{PRIVACY}</p>
      </div>

      <div class="about-group">
        <h4 id="about-books" class="settings-subheading">
          Your books
        </h4>
        <p class="settings-note">
          {YOUR_BOOKS}
          <Show when={SAMPLE_FILES.length > 0}>
            {" "}
            {SAMPLE_BOOKS}{" "}
            <a href={SAMPLE_RIGHTS_URL} target="_blank" rel="noopener noreferrer">
              The sample’s rights
            </a>
          </Show>
        </p>
      </div>

      <div class="about-group">
        <h4 id="about-report" class="settings-subheading">
          Report a problem
        </h4>
        <p class="settings-note">
          Copy the diagnostics, then report the problem and paste them in if you choose. They hold
          the build, your browser and screen, how storage is set up and how many books you have.
          They hold no titles, no recents and no lyrics.
        </p>
        <div class="settings-row">
          <div class="settings-screen-control">
            <button type="button" class="btn-tonal" onClick={() => void copy()}>
              Copy Diagnostics
            </button>
            <a class="btn-text" href={REPORT_URL} target="_blank" rel="noopener noreferrer">
              Report a Problem
            </a>
          </div>
        </div>
      </div>

      <div class="about-group">
        <h4 id="about-credits" class="settings-subheading">
          Credits
        </h4>
        <ul class="about-credits">
          <For each={CREDITS}>
            {(credit) => (
              <li class="settings-note">
                {credit.name}, {credit.licence}
              </li>
            )}
          </For>
        </ul>
      </div>
    </section>
  );
}
