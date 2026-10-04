import { batch, createEffect, createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import type { TextError } from "../import/songtext.ts";
import { Sheet } from "../shell/Sheet.tsx";
import { count } from "./books.ts";
import { suggestLanguage } from "./detectLanguage.ts";
import { LanguagePicker } from "./LanguagePicker.tsx";
import { englishName, scriptName, scriptOf } from "./languages.ts";
import { type FieldProblems, joinSongTexts, slugify, type TextFields } from "./textbook.ts";

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
  const [id, setId] = createSignal("");
  const [number, setNumber] = createSignal("");
  const [songText, setSongText] = createSignal("");
  const [sourceText, setSourceText] = createSignal("");
  // The id follows the title until it is edited by hand.
  const [idEdited, setIdEdited] = createSignal(false);
  const scheduleSuggest = () => {
    clearTimeout(suggestTimer);
    const run = ++suggestRun;
    suggestTimer = setTimeout(async () => {
      const code = await suggestLanguage(songText() || sourceText());
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
    id,
    number,
    songText,
    sourceText,
    setTitle: (value: string) => {
      setTitle(value);
      if (!idEdited()) setId(slugify(value));
    },
    setLanguage: (code: string) => {
      setChosen(true);
      setSuggested(undefined);
      setLanguage(code);
      setScriptEdit(undefined);
    },
    setScript: (code: string) => setScriptEdit(code),
    resetScript: () => setScriptEdit(undefined),
    scriptEdited: () => scriptEdit() !== undefined,
    setId: (value: string) => {
      setIdEdited(value !== "");
      setId(value === "" ? slugify(title()) : value);
    },
    setNumber,
    setSongText: (value: string) => {
      setSongText(value);
      scheduleSuggest();
    },
    setSourceText: (value: string) => {
      setSourceText(value);
      scheduleSuggest();
    },
    reset: () => {
      clearTimeout(suggestTimer);
      suggestRun++;
      setChosen(false);
      setSuggested(undefined);
      for (const set of [setTitle, setLanguage, setId, setNumber, setSongText, setSourceText]) {
        set("");
      }
      setIdEdited(false);
      setScriptEdit(undefined);
    },
    fields: (): TextFields => ({
      title: title(),
      language: language(),
      script: script(),
      id: id(),
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

/** A parse error as a field error: "Line 12: …", or the message alone when it has no line. */
const errorText = (e: TextError) => (e.line > 0 ? `Line ${e.line}: ${e.message}` : e.message);

/**
 * A book from song text (ADR-0029, SDD-0004 §9): the book's own fields, which
 * are required and never guessed, the song text, and optionally the book's
 * original text to check it against. Review parses; every error is a field
 * error under its field and nothing is written. Everything stays on this
 * device.
 */
export function TextSheet(props: TextSheetProps) {
  const d = props.draft;
  let form: HTMLFormElement | undefined;
  const [songFile, setSongFile] = createSignal<HTMLInputElement>();
  const [sourceFile, setSourceFile] = createSignal<HTMLInputElement>();
  const [changingScript, setChangingScript] = createSignal(false);
  const [advanced, setAdvanced] = createSignal(false);

  const hasProblem = () => props.errors.length + Object.keys(props.problems).length > 0;

  // After a Review that found something wrong, bring the first thing wrong into view.
  createEffect(() => {
    if (!props.open || !hasProblem()) return;
    if (props.problems.id || props.problems.number) setAdvanced(true);
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

  const picker = (
    setRef: (el: HTMLInputElement) => void,
    into: (texts: string[]) => void,
    several: boolean,
  ) => (
    <input
      ref={setRef}
      type="file"
      class="visually-hidden"
      accept=".txt,.text,text/plain"
      multiple={several}
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
  // A language the platform has no default script for, or a script being changed.
  const scriptOpen = () => changingScript() || (!!d.language() && !script());

  return (
    <Sheet
      open={props.open}
      onClose={props.onCancel}
      title="Book from Text"
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
          Songs written as plain text, in the <span class="nowrap">text format</span>, become a
          book. You see it all before anything is stored, and nothing leaves this device.
        </p>

        <Field id="book-title" label="Title" problem={props.problems.title}>
          {(by) => (
            <input
              class="field-input"
              type="text"
              autocomplete="off"
              id="book-title"
              value={d.title()}
              aria-invalid={!!props.problems.title}
              aria-describedby={by}
              onInput={(e) => d.setTitle(e.currentTarget.value)}
              autofocus
            />
          )}
        </Field>

        <div class="field">
          <label class="field-label" for="book-language">
            Language
          </label>
          <LanguagePicker
            id="book-language"
            value={d.language()}
            invalid={!!props.problems.language}
            describedBy={props.problems.language ? "book-language-hint" : undefined}
            onPick={d.setLanguage}
          />
          <Show when={props.problems.language}>
            <span class="field-hint field-problem" id="book-language-hint" role="alert">
              {props.problems.language}
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
                  aria-invalid={!!props.problems.script}
                  aria-describedby={props.problems.script ? "book-script-hint" : undefined}
                  onInput={(e) => d.setScript(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (script()) setChangingScript(false);
                    }
                  }}
                />
                <Show when={script()}>
                  <button
                    type="button"
                    class="script-change"
                    onClick={() => setChangingScript(false)}
                  >
                    Done
                  </button>
                </Show>
              </Show>
            </div>
          </Show>
          <Show when={props.problems.script}>
            <span class="field-hint field-problem" id="book-script-hint" role="alert">
              {props.problems.script}
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
              Open .txt files
            </button>
            {picker(setSongFile, (texts) => d.setSongText(joinSongTexts(texts)), true)}
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
            aria-invalid={props.errors.length > 0}
            aria-describedby={props.errors.length > 0 ? "song-text-errors" : "song-text-hint"}
            onInput={(e) => d.setSongText(e.currentTarget.value)}
          />
          <Show
            when={props.errors.length > 0}
            fallback={
              <span class="field-hint num" id="song-text-hint">
                {count(lineCount(d.songText()))} lines. Several files are joined with --- between.
              </span>
            }
          >
            <ul class="field-problems" id="song-text-errors" aria-label="Parse errors" role="alert">
              <For each={props.errors}>
                {(e) => <li class="field-hint field-problem">{errorText(e)}</li>}
              </For>
            </ul>
          </Show>
        </div>

        <div class="field">
          <div class="field-top">
            <label class="field-label" for="source-text">
              Original text, to check against <span class="field-optional">optional</span>
            </label>
            <button type="button" class="btn-text" onClick={() => sourceFile()?.click()}>
              <span class="icon icon-file-open" aria-hidden="true" />
              Open a .txt
            </button>
            {picker(setSourceFile, (texts) => d.setSourceText(texts.join("\n")), false)}
          </div>
          <textarea
            id="source-text"
            class="field-area"
            rows={6}
            spellcheck={false}
            autocapitalize="off"
            aria-describedby="source-hint"
            value={d.sourceText()}
            onInput={(e) => d.setSourceText(e.currentTarget.value)}
          />
          <span class="field-hint" id="source-hint">
            Paste the book as printed, and Hymnal checks your songs against it. The review lists
            lines that were added, changed or left out.
          </span>
        </div>

        <details
          class="advanced"
          open={advanced()}
          onToggle={(e) => setAdvanced(e.currentTarget.open)}
        >
          <summary class="advanced-summary">
            <span class="icon icon-chevron-right advanced-chevron" aria-hidden="true" />
            Advanced
          </summary>
          <div class="advanced-body">
            <Field
              id="book-id"
              label="Id"
              hint="Made from the title; change it if you like."
              problem={props.problems.id}
            >
              {(by) => (
                <input
                  class="field-input"
                  type="text"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                  id="book-id"
                  value={d.id()}
                  aria-invalid={!!props.problems.id}
                  aria-describedby={by}
                  onInput={(e) => d.setId(e.currentTarget.value)}
                />
              )}
            </Field>
            <Field
              id="book-number"
              label="Song number"
              hint="For one song whose first line has no number."
              problem={props.problems.number}
            >
              {(by) => (
                <input
                  class="field-input"
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  id="book-number"
                  value={d.number()}
                  aria-invalid={!!props.problems.number}
                  aria-describedby={by}
                  onInput={(e) => d.setNumber(e.currentTarget.value)}
                />
              )}
            </Field>
          </div>
        </details>

        <div class="review-actions">
          <button type="submit" class="btn-filled" disabled={props.busy}>
            Review the Book
          </button>
        </div>
      </form>
    </Sheet>
  );
}
