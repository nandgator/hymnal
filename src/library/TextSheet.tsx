import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { ASSORTED_ORIGIN } from "../domain/own.ts";
import type { TextError } from "../import/songtext.ts";
import { Sheet } from "../shell/Sheet.tsx";
import { count } from "./books.ts";
import { suggestLanguage } from "./detectLanguage.ts";
import { LanguagePicker } from "./LanguagePicker.tsx";
import { englishName, scriptName, scriptOf } from "./languages.ts";
import {
  type BookChoice,
  CHOICE_DEFAULT,
  CHOICE_NEW,
  type FieldProblems,
  joinSongTexts,
  normalScript,
  scriptProblem,
  songCount,
  suggestBookTitle,
  type TextFields,
} from "./textbook.ts";

/** Typing or pasting pauses this long before the text is read for a language. */
const SUGGEST_DELAY_MS = 300;

/** What has been typed in the text sheet; kept by the Library so a Cancel in the review comes back to it. */
export function createTextDraft() {
  const [title, setTitle] = createSignal("");
  const [language, setLanguage] = createSignal("");
  // The language is the person's once picked; until then the text may suggest
  // one, preselected and never over a choice (detectLanguage.ts).
  const [chosen, setChosen] = createSignal(false);
  const [suggested, setSuggested] = createSignal<string>();
  let suggestTimer: ReturnType<typeof setTimeout> | undefined;
  let suggestRun = 0;
  // The script follows the language ("ml" is Mlym) until it is changed by hand.
  const [scriptEdit, setScriptEdit] = createSignal<string>();
  const script = () => scriptEdit() ?? scriptOf(language());
  const [number, setNumber] = createSignal("");
  const [songText, setSongText] = createSignal("");
  // Where the songs go (ADR-0033 §4): what the person picked, if anything; the Library resolves
  // the rest (the book last added to, else Assorted Hymns).
  const [choice, setChoice] = createSignal<string>();
  const songs = createMemo(() => songCount(songText()));
  const scheduleSuggest = () => {
    clearTimeout(suggestTimer);
    const run = ++suggestRun;
    suggestTimer = setTimeout(async () => {
      const code = await suggestLanguage(songText());
      if (run !== suggestRun || chosen()) return;
      batch(() => {
        setSuggested(code);
        setLanguage(code ?? "");
        setScriptEdit(undefined);
      });
    }, SUGGEST_DELAY_MS);
  };
  onCleanup(() => clearTimeout(suggestTimer));
  return {
    /** The language the text suggests, while it is still the one set. */
    suggestion: () =>
      !chosen() && suggested() && suggested() === language() ? suggested() : undefined,
    title,
    language,
    script,
    number,
    songText,
    /** How many songs the text holds. */
    songs,
    choice,
    setChoice,
    setTitle,
    setLanguage: (code: string) => {
      setChosen(true);
      setSuggested(undefined);
      setLanguage(code);
      setScriptEdit(undefined);
    },
    setScript: (code: string) => setScriptEdit(code),
    resetScript: () => setScriptEdit(undefined),
    scriptEdited: () => scriptEdit() !== undefined,
    setNumber,
    setSongText: (value: string) => {
      setSongText(value);
      scheduleSuggest();
    },
    reset: () => {
      clearTimeout(suggestTimer);
      suggestRun++;
      setChosen(false);
      setSuggested(undefined);
      for (const set of [setTitle, setLanguage, setNumber, setSongText]) {
        set("");
      }
      setChoice(undefined);
      setScriptEdit(undefined);
    },
    fields: (): Omit<TextFields, "destination"> => ({
      title: title(),
      language: language(),
      script: script(),
      number: number(),
    }),
  };
}

export type TextDraft = ReturnType<typeof createTextDraft>;

export interface TextSheetProps {
  open: boolean;
  draft: TextDraft;
  /** What the last Review found wrong; nothing was written. */
  errors: TextError[];
  problems: FieldProblems;
  /** The person's own books, in the Library's order: what Add to offers. */
  books: BookChoice[];
  /** The Add to value now (resolved by the Library): a book's key, "default" or "new". */
  choice: string;
  busy: boolean;
  placement: "bottom" | "center";
  onCancel: () => void;
  onReview: () => void;
}

const Field = (props: {
  id: string;
  label: string;
  hint?: string;
  problem?: string;
  children: (describedBy: string | undefined) => JSX.Element;
  class?: string;
}) => {
  const hintId = `${props.id}-hint`;
  return (
    <div class={`field ${props.class ?? ""}`}>
      <label class="field-label" for={props.id}>
        {props.label}
      </label>
      {props.children(props.problem || props.hint ? hintId : undefined)}
      <Show when={props.problem || props.hint}>
        <span
          class="field-hint"
          classList={{ "field-problem": !!props.problem }}
          id={hintId}
          role={props.problem ? "alert" : undefined}
        >
          {props.problem ?? props.hint}
        </span>
      </Show>
    </div>
  );
};

/** Reads picked text files, in the order picked; a file that cannot be read says nothing is changed. */
async function readTexts(files: FileList | null | undefined): Promise<string[] | undefined> {
  if (!files || files.length === 0) return undefined;
  try {
    return await Promise.all(
      [...files].map(async (file) => (await file.text()).replace(/^\uFEFF/, "")),
    );
  } catch {
    // The area keeps what it had; the person can paste instead.
    return undefined;
  }
}

/** While a section grows, keep its end in view frame by frame: past the card's cap the body scrolls with it, with no jump. */
function followGrowth(el: HTMLDetailsElement) {
  if (typeof requestAnimationFrame !== "function") return;
  const end = performance.now() + 300;
  const step = () => {
    if (!el.open) return;
    el.querySelector(".advanced-body")?.scrollIntoView?.({ block: "nearest" });
    if (performance.now() < end) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A parse error as a field error: "Line 12: …", or the message alone when it has no line. */
const errorText = (e: TextError) => (e.line > 0 ? `Line ${e.line}: ${e.message}` : e.message);

/**
 * Songs from plain text (ADR-0029, ADR-0033 §4): one form. Add to (one of the
 * person's books, or a new one), the songs' language, the song text, and what
 * remains optional under Advanced. Review parses; every error is a field error
 * under its field, and it hides the moment that field is edited. Nothing is
 * written, and everything stays on this device.
 */
export function TextSheet(props: TextSheetProps) {
  const d = props.draft;
  let form: HTMLFormElement | undefined;
  const [songFile, setSongFile] = createSignal<HTMLInputElement>();
  const [changingScript, setChangingScript] = createSignal(false);
  const [advanced, setAdvanced] = createSignal(false);
  // A script typed by hand is checked as it is typed; a code still short is left until the field is left.
  const [scriptTouched, setScriptTouched] = createSignal(false);
  // Fields edited since the last Review: what that Review found wrong about them is no longer so.
  const [gone, setGone] = createSignal<ReadonlySet<string>>(new Set());
  const hide = (...keys: string[]) => setGone((was) => new Set<string>([...was, ...keys]));
  createEffect(
    on(
      () => [props.errors, props.problems],
      () => setGone(new Set<string>()),
      { defer: true },
    ),
  );
  const problem = (key: keyof FieldProblems) => (gone().has(key) ? undefined : props.problems[key]);
  const errors = () => (gone().has("text") ? [] : props.errors);

  const hasProblem = () => errors().length + Object.keys(props.problems).length > 0;

  // After a Review that found something wrong, bring the first thing wrong into view.
  createEffect(() => {
    if (!props.open || !hasProblem()) return;
    if (props.problems.number) setAdvanced(true);
    queueMicrotask(() => {
      const first = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (!first) return;
      // The field takes focus where it is; what is shown is its error, under it.
      // (The language list opens on focus, so that field is only scrolled to.)
      if (first.getAttribute("role") !== "combobox") first.focus({ preventScroll: true });
      const shown =
        first.id === "song-text" ? form?.querySelector<HTMLElement>("#song-text-errors") : first;
      shown?.scrollIntoView?.({ block: "center" });
    });
  });

  const picker = (setRef: (el: HTMLInputElement) => void, into: (texts: string[]) => void) => (
    <input
      ref={setRef}
      type="file"
      class="visually-hidden"
      accept=".txt,.text,text/plain"
      multiple
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        const input = event.currentTarget;
        void readTexts(input.files).then((texts) => texts && into(texts));
        input.value = "";
      }}
    />
  );

  const lineCount = (text: string) => (text.trim() ? text.split(/\r\n|\r|\n/).length : 0);
  const script = () => d.script();
  const newBook = () => props.choice === CHOICE_NEW;
  const hasAssorted = () => props.books.some((b) => b.origin === ASSORTED_ORIGIN);
  // A language the platform has no default script for, or a script being changed.
  const scriptOpen = () => changingScript() || (!!d.language() && !script());
  const liveScript = () => {
    if (!d.scriptEdited()) return undefined;
    const code = script().trim();
    const bad = scriptProblem(code);
    if (!bad) return undefined;
    // Still being typed: a short run of letters is not wrong yet.
    return !scriptTouched() && /^[A-Za-z]{0,3}$/.test(code) ? undefined : bad;
  };
  const scriptMessage = () => problem("script") ?? liveScript();
  const finishScript = () => {
    const bad = scriptProblem(script());
    setScriptTouched(true);
    if (bad) return;
    d.setScript(normalScript(script()));
    setChangingScript(false);
  };

  // The options are made after the select; its value follows the choice once they are there.
  const [choiceSelect, setChoiceSelect] = createSignal<HTMLSelectElement>();
  createEffect(() => {
    const select = choiceSelect();
    const value = props.choice;
    props.books.length;
    if (select) select.value = value;
  });
  const choose = (value: string) => {
    d.setChoice(value);
    // Where the songs go changes which numbers are free: the text's errors are stale.
    hide("text");
    if (value === CHOICE_NEW && !d.title().trim()) {
      d.setTitle(suggestBookTitle(props.books.map((b) => b.title)));
    }
  };

  const songs = () => d.songs();
  const reviewLabel = () =>
    songs() === 0 ? "Review" : songs() === 1 ? "Review Song" : `Review ${count(songs())} Songs`;

  return (
    <Sheet
      open={props.open}
      onClose={props.onCancel}
      title="From Text"
      closeLabel="Cancel"
      placement={props.placement}
      tall
    >
      <form
        ref={form}
        class="textsheet"
        novalidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!props.busy) props.onReview();
        }}
      >
        <p class="textsheet-lead">
          Paste songs or open .txt files. You review them before anything is saved, and nothing
          leaves this device.
        </p>

        <div class="field">
          <label class="field-label" for="book-choice">
            Add to
          </label>
          <div class="select-box">
            <select
              ref={setChoiceSelect}
              id="book-choice"
              class="field-input field-select"
              onChange={(e) => choose(e.currentTarget.value)}
            >
              <Show when={!hasAssorted()}>
                <option value={CHOICE_DEFAULT}>Assorted Hymns</option>
              </Show>
              <For each={props.books}>{(b) => <option value={b.key}>{b.title}</option>}</For>
              <option value={CHOICE_NEW}>New book…</option>
            </select>
            <span class="icon icon-expand select-chevron" aria-hidden="true" />
          </div>
        </div>

        <Show when={newBook()}>
          <Field id="book-title" label="Book name" problem={problem("title")}>
            {(by) => (
              <input
                class="field-input"
                type="text"
                autocomplete="off"
                id="book-title"
                value={d.title()}
                aria-invalid={!!problem("title")}
                aria-describedby={by}
                onInput={(e) => {
                  d.setTitle(e.currentTarget.value);
                  hide("title");
                }}
              />
            )}
          </Field>
        </Show>

        <div class="field">
          <label class="field-label" for="book-language">
            {songs() > 1 ? "Songs’ language" : "Song’s language"}
          </label>
          <LanguagePicker
            id="book-language"
            value={d.language()}
            invalid={!!problem("language")}
            describedBy={problem("language") ? "book-language-hint" : undefined}
            onPick={(code) => {
              d.setLanguage(code);
              hide("language", "script");
            }}
          />
          <Show when={problem("language")}>
            <span class="field-hint field-problem" id="book-language-hint" role="alert">
              {problem("language")}
            </span>
          </Show>
          <Show when={d.suggestion()}>
            {(code) => (
              <span class="field-hint" id="book-language-suggestion">
                Looks like {englishName(code()) ?? code()}
              </span>
            )}
          </Show>
          <Show when={d.language()}>
            <div class="script-line">
              <Show
                when={scriptOpen()}
                fallback={
                  <>
                    <span>
                      Script: {scriptName(script())} <span class="facts-code">({script()})</span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      class="script-change"
                      onClick={() => setChangingScript(true)}
                    >
                      Change
                    </button>
                  </>
                }
              >
                <label class="script-label" for="book-script">
                  Script code
                </label>
                <input
                  class="field-input script-input"
                  type="text"
                  id="book-script"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                  placeholder="Latn, Mlym, Taml…"
                  value={script()}
                  aria-invalid={!!scriptMessage()}
                  aria-describedby={scriptMessage() ? "book-script-hint" : undefined}
                  onInput={(e) => {
                    d.setScript(e.currentTarget.value);
                    setScriptTouched(false);
                    hide("script");
                  }}
                  onBlur={(e) => {
                    setScriptTouched(true);
                    const code = e.currentTarget.value.trim();
                    if (/^[A-Za-z]{4}$/.test(code)) d.setScript(normalScript(code));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      finishScript();
                    }
                  }}
                />
                <Show when={script()}>
                  <button type="button" class="script-change" onClick={finishScript}>
                    Done
                  </button>
                </Show>
              </Show>
            </div>
          </Show>
          <Show when={scriptMessage()}>
            <span class="field-hint field-problem" id="book-script-hint" role="alert">
              {scriptMessage()}
            </span>
          </Show>
        </div>

        <div class="field">
          <div class="field-top">
            <label class="field-label" for="song-text">
              Song text
            </label>
            <button type="button" class="btn-text" onClick={() => songFile()?.click()}>
              <span class="icon icon-file-open" aria-hidden="true" />
              Open .txt Files
            </button>
            {picker(setSongFile, (texts) => {
              d.setSongText(joinSongTexts(texts));
              hide("text");
            })}
          </div>
          <textarea
            id="song-text"
            class="field-area"
            rows={10}
            spellcheck={false}
            autocapitalize="off"
            placeholder={
              "1. Amazing Grace\n\nAmazing grace! how sweet the sound,\nThat saved a wretch like me!"
            }
            value={d.songText()}
            aria-invalid={errors().length > 0}
            aria-describedby={errors().length > 0 ? "song-text-errors" : "song-text-hint"}
            onInput={(e) => {
              d.setSongText(e.currentTarget.value);
              hide("text");
            }}
          />
          <Show
            when={errors().length > 0}
            fallback={
              <span class="field-hint num" id="song-text-hint">
                {songs() === 0
                  ? "0 lines. Put --- on its own line between songs."
                  : `${count(lineCount(d.songText()))} ${lineCount(d.songText()) === 1 ? "line" : "lines"}, ${songs() === 1 ? "1 song" : `${count(songs())} songs`}. Put --- on its own line between songs.`}
              </span>
            }
          >
            <ul class="field-problems" id="song-text-errors" aria-label="Parse errors" role="alert">
              <For each={errors()}>
                {(e) => <li class="field-hint field-problem">{errorText(e)}</li>}
              </For>
            </ul>
          </Show>
        </div>

        <details
          class="advanced"
          open={advanced()}
          onToggle={(e) => {
            const el = e.currentTarget;
            setAdvanced(el.open);
            if (el.open) followGrowth(el);
          }}
        >
          <summary class="advanced-summary">
            <span class="icon icon-chevron-right advanced-chevron" aria-hidden="true" />
            Advanced
          </summary>
          <div class="advanced-body">
            <Field
              id="book-number"
              label="Song number"
              hint="For one song with no number written. Left blank, it takes the book’s next number."
              problem={problem("number")}
            >
              {(by) => (
                <input
                  class="field-input"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  id="book-number"
                  value={d.number()}
                  aria-invalid={!!problem("number")}
                  aria-describedby={by}
                  onInput={(e) => {
                    d.setNumber(e.currentTarget.value);
                    hide("number", "text");
                  }}
                />
              )}
            </Field>
          </div>
        </details>

        <div class="review-actions">
          <button type="submit" class="btn-filled" disabled={props.busy}>
            {reviewLabel()}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
