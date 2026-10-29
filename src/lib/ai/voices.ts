// The device's voices for Read aloud, as a person would want to pick them:
// only the document's language, grouped by accent (English (India), English
// (United Kingdom)…), the natural-sounding ones first, and the accent that
// suits the visitor picked to start with. A voice is known by its voiceURI:
// on Android several voices share one name, so a name can't tell them apart.
// Pure, so tests can run it in Node with made-up voices.

export type VoiceLike = { name: string; lang: string; voiceURI?: string; localService?: boolean; default?: boolean };

export const voiceId = (v: VoiceLike) => v.voiceURI || `${v.name}|${v.lang}`;

const tagOf = (lang: string) => lang.replace("_", "-");
const baseOf = (lang: string) => tagOf(lang).toLowerCase().split("-")[0];
export const regionOf = (lang: string) => tagOf(lang).split("-")[1]?.toUpperCase() ?? "";

// How natural a voice sounds, by what its name says: neural and "natural"
// voices (Edge, Windows), Apple's enhanced and premium ones and Siri, and
// Google's (Chrome, Android) above the old robotic ones (eSpeak, compact).
export function quality(v: VoiceLike): number {
  const n = v.name.toLowerCase();
  let q = 0;
  if (/natural|neural|wavenet|premium|enhanced|siri|studio|journey/.test(n)) q += 4;
  if (/google|microsoft .* online/.test(n)) q += 2;
  if (/espeak|compact|robot|novelty|bad news|bells|boing|bubbles|cellos|whisper|zarvox|trinoids|jester|organ|superstar|wobble|albert|bahh|fred|junior|ralph|kathy/.test(n)) q -= 6;
  if (v.localService) q += 0.5;
  return q;
}

// The accent to start with for a language: the visitor's own when they use
// that language (en-IN for someone in India reading English), else the
// language's home region.
const HOME: Record<string, string> = {
  en: "US", es: "ES", fr: "FR", de: "DE", it: "IT", pt: "BR", ja: "JP", ko: "KR", zh: "CN", ar: "SA",
  ru: "RU", hi: "IN", bn: "IN", ta: "IN", te: "IN", mr: "IN", ur: "PK", fa: "IR", nl: "NL", sv: "SE",
  pl: "PL", tr: "TR", uk: "UA", vi: "VN", th: "TH", id: "ID", ms: "MY", sw: "KE", el: "GR", bg: "BG", ca: "ES",
};
export function preferredRegion(lang: string, visitor: readonly string[] = []): string {
  const base = baseOf(lang);
  const own = visitor.map(tagOf).find((l) => baseOf(l) === base && regionOf(l));
  return (own && regionOf(own)) || regionOf(lang) || HOME[base] || "";
}

// A voice's name without its maker and the obvious: "Microsoft Aria Online
// (Natural) - English (United States)" is "Aria".
export function shortName(v: VoiceLike): string {
  const n = v.name
    .replace(/^(Microsoft|Google|Apple|Samsung)\s+/i, "")
    .replace(/\s*[-–]\s*[^-–]*\([^)]*\)\s*$/, "")
    .replace(/\s*\((Natural|Enhanced|Premium)\)/i, "")
    .replace(/\s+Online\b/i, "")
    .trim();
  return n || v.name;
}
export const isNatural = (v: VoiceLike) => quality(v) >= 4;

export type Group<V> = { region: string; voices: V[] };

// The language's voices grouped by accent: the preferred accent first, then
// the others by their best voice; in each, the most natural first.
export function voiceGroups<V extends VoiceLike>(all: readonly V[], lang: string, visitor: readonly string[] = []): Group<V>[] {
  const base = baseOf(lang);
  const want = preferredRegion(lang, visitor);
  const mine = all.filter((v) => baseOf(v.lang) === base);
  const by = new Map<string, V[]>();
  for (const v of mine) {
    const r = regionOf(v.lang);
    by.set(r, [...(by.get(r) ?? []), v]);
  }
  const best = (list: V[]) => Math.max(...list.map(quality));
  return [...by]
    .map(([region, voices]) => ({ region, voices: [...voices].sort((a, b) => quality(b) - quality(a) || Number(!!b.default) - Number(!!a.default) || a.name.localeCompare(b.name)) }))
    .sort((a, b) => Number(b.region === want) - Number(a.region === want) || best(b.voices) - best(a.voices) || a.region.localeCompare(b.region));
}

// The voice to start with: the one asked for when it's still there, else the
// best in the preferred accent.
export function pickVoice<V extends VoiceLike>(groups: Group<V>[], saved?: string | null): V | undefined {
  const all = groups.flatMap((g) => g.voices);
  return (saved && all.find((v) => voiceId(v) === saved)) || all[0];
}
