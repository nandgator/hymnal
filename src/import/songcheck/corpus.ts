/**
 * The labelled set of ADR-0034 §1, for tests: songs and non-songs with where
 * each came from. Reads the JSON beside it, so it is for node only (tests and
 * scripts), never the app. The files are in `fixtures/`: `songs.json`,
 * `not-songs.json` and `gaps.json` (what the set lacks and why).
 */
import { readFileSync } from "node:fs";

export interface CorpusItem {
  id: string;
  label: "song" | "not-song";
  /** Non-songs only: code, maths, data, urls, chat, email, prose or emoji. */
  category?: "code" | "maths" | "data" | "urls" | "chat" | "email" | "prose" | "emoji";
  /** BCP 47. */
  language: string;
  /** ISO 15924. */
  script: string;
  /** Writing traits and layout quirks the item stands for. */
  traits: string[];
  /** What it is, in a few words. */
  what: string;
  source: string;
  licence: string;
  /** For a song made from another by a mechanical change. */
  derivedFrom?: string;
  text: string;
}

const read = (name: string): CorpusItem[] =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

export const songs: CorpusItem[] = read("songs.json");
export const notSongs: CorpusItem[] = read("not-songs.json");
export const gaps: unknown = JSON.parse(
  readFileSync(new URL("./fixtures/gaps.json", import.meta.url), "utf8"),
);
