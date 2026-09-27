import type { FlowLine } from "./flow.ts";
import type { Profile } from "./profile.ts";
import type { Note } from "./report.ts";

/** A song as found: its heading, and every line up to the next one. */
export interface FoundSong {
  number: number;
  /** As printed, a wrapped heading joined. */
  title: string;
  /** Where its heading is. */
  page: number;
  lines: FlowLine[];
}

/**
 * Starts a song at each title, and runs it on across columns and pages
 * until the next (SDD-0003 §1). A heading that wraps onto the next line, in
 * the title's font, is joined.
 */
export function findSongs(lines: FlowLine[], profile: Profile, notes: Note[]): FoundSong[] {
  const pattern = new RegExp(profile.title.pattern);
  const font = profile.title.font;
  const heading = (line: FlowLine) =>
    font === undefined || line.font === font ? pattern.exec(line.text) : null;

  const songs: FoundSong[] = [];
  const stray: FlowLine[] = [];
  let song: FoundSong | undefined;
  let inHeading = false;
  for (const line of lines) {
    const match = heading(line);
    if (match?.groups) {
      song = {
        number: Number(match.groups.number),
        title: match.groups.title.trim(),
        page: line.page,
        lines: [],
      };
      songs.push(song);
      inHeading = font !== undefined;
      continue;
    }
    if (song && inHeading && line.font === font && (line.gap ?? 0) <= profile.stanzaGap) {
      song.title = `${song.title} ${line.text}`;
      continue;
    }
    inHeading = false;
    if (song) song.lines.push(line);
    else stray.push(line);
  }

  if (stray.length > 0) {
    const sample = stray.slice(0, 3).map((line) => `"${line.text}"`);
    notes.push({
      kind: "stray",
      page: stray[0].page,
      message: `${stray.length} line(s) before the first title, dropped: ${sample.join(", ")}${stray.length > 3 ? " …" : ""}`,
    });
  }
  for (const s of songs.filter((s) => s.lines.length === 0)) {
    notes.push({
      kind: "stray",
      hymn: s.number,
      page: s.page,
      message: "a title with no lines under it",
    });
  }
  return songs;
}
