import { createEffect, createSignal, For, type JSX, Show } from "solid-js";
import type { TextError } from "../import/songtext.ts";
import { Sheet } from "../shell/Sheet.tsx";
import { count } from "./books.ts";
import { type FieldProblems, slugify, type TextFields } from "./textbook.ts";

/** What has been typed in the text sheet; kept by the Library so a Cancel in the review comes back to it. */
export function createTextDraft() {
  const [title, setTitle] = createSignal("");
  const [language, setLanguage] = createSignal("");
  const [script, setScript] = createSignal("");
  const [id, setId] = createSignal("");
  const [number, setNumber] = createSignal("");
  const [songText, setSongText] = createSignal("");
  const [sourceText, setSourceText] = createSignal("");
  // The id follows the title until it is edited by hand.
  const [idEdited, setIdEdited] = createSignal(false);
  return {
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
    setLanguage,
    setScript,
    setId: (value: string) => {
      setIdEdited(value !== "");
      setId(value === "" ? slugify(title()) : value);
    },
    setNumber,
    setSongText,
    setSourceText,
    reset: () => {
      for (const set of [
        setTitle,
        setLanguage,
        setScript,
        setId,
        setNumber,
        setSongText,
        setSourceText,
      ]) {
        set("");
      }
      setIdEdited(false);
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

/** Reads a picked text file into a setter; a file that cannot be read says nothing is changed. */
async function readText(file: File | undefined, into: (text: string) => void) {
  if (!file) return;
  try {
    into((await file.text()).replace(/^﻿/, ""));
  } catch {
    // The area keeps what it had; the person can paste instead.
  }
}

/**
 * A book from song text (ADR-0029, SDD-0004 §9): the book's own fields, which
 * are required and never guessed, the song text, and optionally the source text
 * to check it against. Review parses; the errors are listed with their lines
 * and nothing is written. Everything stays on this device.
 */
export function TextSheet(props: TextSheetProps) {
  const d = props.draft;
  let errorBox: HTMLDivElement | undefined;
  const [songFile, setSongFile] = createSignal<HTMLInputElement>();
  const [sourceFile, setSourceFile] = createSignal<HTMLInputElement>();

  // After a Review that found something wrong, bring it into view (the button is below).
  createEffect(() => {
    const shown = props.errors.length + Object.keys(props.problems).length;
    if (props.open && shown > 0)
      queueMicrotask(() => errorBox?.scrollIntoView?.({ block: "start" }));
  });

  const picker = (setRef: (el: HTMLInputElement) => void, into: (text: string) => void) => (
    <input
      ref={setRef}
      type="file"
      class="visually-hidden"
      accept=".txt,.text,text/plain"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        void readText(event.currentTarget.files?.[0], into);
        event.currentTarget.value = "";
      }}
    />
  );

  const lineCount = (text: string) => (text.trim() ? text.split(/\r\n|\r|\n/).length : 0);

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
        <div class="field-row">
          <Field
            id="book-language"
            label="Language"
            hint="en, ml, ta…"
            problem={props.problems.language}
            class="field-short"
          >
            {(by) => (
              <input
                class="field-input"
                type="text"
                autocomplete="off"
                autocapitalize="off"
                spellcheck={false}
                id="book-language"
                value={d.language()}
                aria-invalid={!!props.problems.language}
                aria-describedby={by}
                onInput={(e) => d.setLanguage(e.currentTarget.value)}
              />
            )}
          </Field>
          <Field
            id="book-script"
            label="Script"
            hint="Latn, Mlym, Taml…"
            problem={props.problems.script}
            class="field-short"
          >
            {(by) => (
              <input
                class="field-input"
                type="text"
                autocomplete="off"
                autocapitalize="off"
                spellcheck={false}
                id="book-script"
                value={d.script()}
                aria-invalid={!!props.problems.script}
                aria-describedby={by}
                onInput={(e) => d.setScript(e.currentTarget.value)}
              />
            )}
          </Field>
        </div>
        <div class="field-row">
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
            hint="One song, no number."
            problem={props.problems.number}
            class="field-short"
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

        <div class="field">
          <div class="field-top">
            <label class="field-label" for="song-text">
              Song text
            </label>
            <button type="button" class="btn-text" onClick={() => songFile()?.click()}>
              <span class="icon icon-file-open" aria-hidden="true" />
              Open a .txt
            </button>
            {picker(setSongFile, d.setSongText)}
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
            onInput={(e) => d.setSongText(e.currentTarget.value)}
          />
          <span class="field-hint num">{count(lineCount(d.songText()))} lines</span>
        </div>

        <Show when={props.errors.length > 0}>
          <div class="parse-errors" ref={errorBox} tabIndex={-1}>
            <div class="callout callout-bad" role="alert">
              <span class="icon icon-error" aria-hidden="true" />
              <div>
                <h4>
                  {count(props.errors.length)} {props.errors.length === 1 ? "error" : "errors"} in
                  the text
                </h4>
                <p>Nothing is repaired or stored. Fix the text and review it again.</p>
              </div>
            </div>
            <ul class="violations" aria-label="Parse errors">
              <For each={props.errors}>
                {(e) => (
                  <li class="violation violation-line violation-parse">
                    <span class="vwhere num">{e.line > 0 ? `Line ${e.line}` : "Text"}</span>
                    <span>{e.message}</span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>

        <div class="field">
          <div class="field-top">
            <label class="field-label" for="source-text">
              Source text <span class="field-optional">optional</span>
            </label>
            <button type="button" class="btn-text" onClick={() => sourceFile()?.click()}>
              <span class="icon icon-file-open" aria-hidden="true" />
              Open a .txt
            </button>
            {picker(setSourceFile, d.setSourceText)}
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
            The text the songs started from. The review lists lines the book added or dropped.
          </span>
        </div>

        <div class="review-actions">
          <button type="submit" class="btn-filled" disabled={props.busy}>
            Review the Book
          </button>
        </div>
      </form>
    </Sheet>
  );
}
