import { describe, expect, it, vi } from "vitest";
import { type LanguageDetectorApi, languageFromScript, suggestLanguage } from "./detectLanguage.ts";

// Plain words, over twelve letters each.
const ML = "മലയാളം ഭാഷ എഴുതിയ വാക്കുകൾ";
const TA = "தமிழ் மொழி எழுதிய வார்த்தைகள்";
const KN = "ಕನ್ನಡ ಭಾಷೆ ಬರೆದ ಪದಗಳು";
const TE = "తెలుగు భాష రాసిన పదాలు ఇక్కడ ఉన్నాయి";
const GU = "ગુજરાતી ભાષા લખેલા શબ્દો";
const PA = "ਪੰਜਾਬੀ ਭਾਸ਼ਾ ਲਿਖੇ ਸ਼ਬਦ ਹਨ";
const OR = "ଓଡ଼ିଆ ଭାଷା ଲେଖା ଶବ୍ଦ ଗୁଡ଼ିକ";
const SI = "සිංහල භාෂාව ලියූ වචන මෙහි තිබේ";
const TH = "ภาษาไทยที่เขียนเป็นคำ";
const KO = "한국어로 쓴 단어들이 여기 있습니다";
const HE = "עברית שפה כתובה מילים";
const EL = "ελληνική γλώσσα γραμμένες λέξεις";
const KA = "ქართული ენა დაწერილი სიტყვები";
const HY = "հայերեն լեզու գրված բառեր";
const HI = "हिन्दी भाषा लिखे हुए शब्द हैं";
const BN = "বাংলা ভাষা লেখা শব্দগুলি";
const AR = "اللغة العربية كلمات مكتوبة";
const RU = "русский язык написанные слова";
const EN = "Plain words written in English here";
const ZH = "用中文写的文字内容在这里";

const detector = (
  availability: string,
  answer: { detectedLanguage: string | null; confidence: number }[] = [],
) => {
  const detect = vi.fn(async () => answer);
  const create = vi.fn(async () => ({ detect }));
  const api: LanguageDetectorApi = { availability: async () => availability, create };
  return { api, create, detect };
};

describe("languageFromScript", () => {
  it.each([
    ["ml", ML],
    ["ta", TA],
    ["kn", KN],
    ["te", TE],
    ["gu", GU],
    ["pa", PA],
    ["or", OR],
    ["si", SI],
    ["th", TH],
    ["ko", KO],
    ["he", HE],
    ["el", EL],
    ["ka", KA],
    ["hy", HY],
  ])("a script that implies %s", (code, text) => {
    expect(languageFromScript(text)).toBe(code);
  });

  it.each([
    ["Devanagari", HI],
    ["Bengali", BN],
    ["Arabic", AR],
    ["Cyrillic", RU],
    ["Latin", EN],
    ["Han", ZH],
  ])("does not guess from %s alone", (_name, text) => {
    expect(languageFromScript(text)).toBeUndefined();
  });

  it("takes the dominant script by letters, not the first seen", () => {
    expect(languageFromScript(`1. Hymn ${ML} ${ML} ${ML}`)).toBe("ml");
  });

  it("says nothing when no script holds most of the letters", () => {
    expect(languageFromScript(`${ML} ${EN} ${EN}`)).toBeUndefined();
  });

  it("says nothing for too little text, digits or punctuation", () => {
    expect(languageFromScript("മലയാളം")).toBeUndefined();
    expect(languageFromScript("1 2 3 4 5 6 7 8 9 10 11 12 13 14 ...")).toBeUndefined();
    expect(languageFromScript("")).toBeUndefined();
  });
});

describe("suggestLanguage", () => {
  it("answers from the script without asking a detector", async () => {
    const { api, create } = detector("available");
    expect(await suggestLanguage(TA, api)).toBe("ta");
    expect(create).not.toHaveBeenCalled();
  });

  it("leaves a shared script to the person when there is no detector", async () => {
    expect(await suggestLanguage(HI, undefined)).toBeUndefined();
  });

  it("uses an available on-device detector for a shared script, on a confident answer", async () => {
    const { api } = detector("available", [{ detectedLanguage: "mr", confidence: 0.93 }]);
    expect(await suggestLanguage(HI, api)).toBe("mr");
  });

  it("drops a low-confidence answer", async () => {
    const { api } = detector("available", [{ detectedLanguage: "hi", confidence: 0.5 }]);
    expect(await suggestLanguage(HI, api)).toBeUndefined();
  });

  it("drops an answer that does not fit the script", async () => {
    const { api } = detector("available", [{ detectedLanguage: "ru", confidence: 0.99 }]);
    expect(await suggestLanguage(EN, api)).toBeUndefined();
    expect(await suggestLanguage(RU, api)).toBe("ru");
  });

  it("accepts a Latin-script language the detector names", async () => {
    const { api } = detector("available", [{ detectedLanguage: "en", confidence: 0.97 }]);
    expect(await suggestLanguage(EN, api)).toBe("en");
  });

  it.each(["downloadable", "downloading", "unavailable"])(
    "never triggers a model that is %s",
    async (state) => {
      const { api, create } = detector(state, [{ detectedLanguage: "hi", confidence: 0.99 }]);
      expect(await suggestLanguage(HI, api)).toBeUndefined();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("leaves it to the person when the detector fails", async () => {
    const api: LanguageDetectorApi = {
      availability: async () => "available",
      create: async () => {
        throw new Error("no");
      },
    };
    expect(await suggestLanguage(HI, api)).toBeUndefined();
  });
});
