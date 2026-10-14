import { describe, expect, it } from "vitest";
import { checkSong, checkSongText } from "../songcheck.ts";
import { notSongs, songs } from "./corpus.ts";

const reason = (text: string) => {
  const r = checkSongText(text);
  return r.ok ? undefined : r.reason;
};

describe("checkSongText on the labelled set (ADR-0034 §2)", () => {
  it("flags no song of the set", () => {
    const flagged = songs.filter((s) => !checkSongText(s.text).ok);
    expect(flagged.map((s) => `${s.id}: ${reason(s.text)}`)).toEqual([]);
  });

  it("catches at least 95% of the non-songs, and prints each category", () => {
    const byCategory = new Map<string, { caught: number; total: number; missed: string[] }>();
    for (const n of notSongs) {
      const key = n.category ?? "?";
      const row = byCategory.get(key) ?? { caught: 0, total: 0, missed: [] };
      row.total++;
      if (checkSongText(n.text).ok) row.missed.push(n.id);
      else row.caught++;
      byCategory.set(key, row);
    }
    const lines = [...byCategory].map(
      ([k, r]) =>
        `${k.padEnd(6)} ${r.caught}/${r.total} ${((100 * r.caught) / r.total).toFixed(0)}%${r.missed.length ? `  missed: ${r.missed.join(", ")}` : ""}`,
    );
    const caught = [...byCategory.values()].reduce((a, r) => a + r.caught, 0);
    const total = [...byCategory.values()].reduce((a, r) => a + r.total, 0);
    console.info(
      `song check: songs flagged 0/${songs.length}\n${lines.join("\n")}\nall    ${caught}/${total} ${((100 * caught) / total).toFixed(1)}%`,
    );
    expect(caught / total).toBeGreaterThanOrEqual(0.95);
    // The measured floor of each category, so one that slips shows at once.
    for (const [k, r] of byCategory) {
      expect(r.caught / r.total, k).toBeGreaterThanOrEqual(0.9);
    }
  });
});

describe("checkSongText reasons", () => {
  it("passes a hymn, in English and in Malayalam", () => {
    expect(
      reason(
        "Amazing grace! how sweet the sound,\nThat saved a wretch like me!\nI once was lost, but now am found,\nWas blind, but now I see.",
      ),
    ).toBeUndefined();
    expect(
      reason("യേശുവെ ഞാൻ കണ്ടെത്തിയേ\nവിലയേറിയ മുത്തിവൻ താൻ\nമോദ ഗീതം ഞാൻ പാടുമേ,\nയേശു എത്ര നൽ രക്ഷകൻ"),
    ).toBeUndefined();
  });

  it("passes a few emoji at line ends, and musical and religious symbols", () => {
    expect(
      reason(
        "♪ Praise the Lord, my soul ♫\nAll that is within me 🙏\nBless his holy name ✝️\nSing it out with joy 🎶\nHallelujah, amen ✝",
      ),
    ).toBeUndefined();
  });

  it("says mostly emoji, and counts a ZWJ sequence and a flag as one each", () => {
    expect(reason("🙏🙏🙏🙏🙏\n🎶🎶🎶🎶🎶\n👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦\n🇮🇳🇮🇳🇮🇳")).toBe(
      "Lines are mostly emoji, not words.",
    );
  });

  it("does not take the joiners of Indic words for a sign of anything", () => {
    const zwj = "ന്‍";
    const line = `${zwj}യേശു ${zwj}കർത്താവ് ${zwj}ദൈവം ${zwj}രക്ഷകൻ`;
    expect(reason(`${line}\n${line}\n${line}`)).toBeUndefined();
  });

  it("names the symbols of code", () => {
    expect(reason("function a(x) {\n  return x + 1;\n}\nconsole.log(a(2));")).toMatch(
      /like code|read like code/,
    );
    expect(
      reason("const a = { b: [1, 2], c: () => 3 };\nlet d = a.b[0] * 2;\nif (d > 1) { run(); }"),
    ).toMatch(/\{|code/);
  });

  it("flags a table, links, a chat, an email, equations and paragraphs", () => {
    expect(reason("id,name,city\n1,Anu,Kochi\n2,Biju,Pune\n3,Cini,Delhi")).toMatch(/table/);
    expect(reason("https://example.org/a\nhttps://example.org/b\nhttps://example.org/c")).toMatch(
      /links/,
    );
    expect(
      reason(
        "[10:01] Anu: coming tonight?\n[10:02] Biju: yes\n[10:03] Anu: good\n[10:04] Biju: bye",
      ),
    ).toBeDefined();
    expect(reason("From: a@example.org\nTo: b@example.org\nSubject: hello\n\nSee you.")).toMatch(
      /email/,
    );
    expect(reason("3x + 5 = 20\n3x = 15\nx = 5")).toMatch(/equations/);
    expect(
      reason(
        "Whereas recognition of the inherent dignity and of the equal and inalienable rights of all members of the human family is the foundation of freedom, justice and peace in the world, whereas disregard and contempt for human rights have resulted in barbarous acts which have outraged the conscience of mankind.",
      ),
    ).toBe("Reads like a paragraph, not lines.");
  });

  it("checks a parsed song by its title and the lines of its parts", () => {
    const song = {
      title: "First",
      parts: [{ lines: ["function a() {", "  return 1;", "}", "a();"] }],
    };
    expect(checkSong(song).ok).toBe(false);
    expect(
      checkSong({ title: "First", parts: [{ lines: ["One line of a song", "Another line"] }] }).ok,
    ).toBe(true);
  });

  it("is quiet about very short text", () => {
    expect(reason("Amen")).toBeUndefined();
    expect(reason("")).toBeUndefined();
  });
});
