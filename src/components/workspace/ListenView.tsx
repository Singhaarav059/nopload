"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, FileText, Moon, Pause, Play, RotateCcw, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Square, Volume2 } from "lucide-react";
import { useI18n } from "../I18n";
import { LoadingOrb } from "../LoadingOrb";
import { humanSize } from "@/lib/pdf/common";
import { format, getDictionary } from "@/lib/i18n/dictionary";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { chapterOf, chapters, type Cues } from "@/lib/ai/narrate";
import { isNatural, pickVoice, regionOf, shortName, voiceGroups, voiceId } from "@/lib/ai/voices";
import type { Engine, Mode, Narrator, Passage, Segment } from "@/lib/ai/speak";

export const prepareListen = () => import("@/lib/ai/speak");

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SLEEP = [0, 15, 30, 60];

// Remembered on this device: a convenience, never needed.
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(`nopload:listen:${k}`);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(`nopload:listen:${k}`, v);
    } catch {
      /* private mode */
    }
  },
};

// The dictionary of the document's language, for the narrator's own words.
const localeOf = (lang: string): Locale => {
  const base = lang.toLowerCase().split("-")[0];
  if (base === "zh") return lang.toLowerCase().includes("tw") || lang.toLowerCase().includes("hant") ? "zh-tw" : "zh-cn";
  return (LOCALES.find((l) => l.code === base)?.code as Locale | undefined) ?? "en";
};

// Read aloud (P2-16): a player for the document, as a narrator would read it
// (src/lib/ai/narrate.ts) or as a presenter would explain it, with the
// device's voices (grouped by accent, the natural ones first) or the studio
// voice made on the server (src/lib/ai/speak.ts). The section being read is
// at the top, the whole text below with the passage and word being read
// marked; a click reads from any passage, a section from the list jumps to it.
export function ListenView({ file, onError, onClose }: { file: File; onError: (e: unknown) => void; onClose?: () => void }) {
  const { t } = useI18n();
  const [doc, setDoc] = useState<{ lang: string; pages: number; passages: Passage[] } | null>(null);
  const [reading, setReading] = useState(0);
  const [mod, setMod] = useState<typeof import("@/lib/ai/speak") | null>(null);
  const [cues, setCues] = useState<{ cues: Cues; sample: string } | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceKey, setVoiceKey] = useState<string | null>(null);
  const [engineKind, setEngineKind] = useState<"device" | "studio">(() => (store.get("engine") === "studio" ? "studio" : "device"));
  const [mode, setMode] = useState<Mode>(() => (store.get("mode") === "explain" ? "explain" : "read"));
  const [rate, setRate] = useState(() => Number(store.get("rate")) || 1);
  const [chimeOn, setChimeOn] = useState(() => store.get("chime") !== "off");
  const [sleep, setSleep] = useState(0);
  const [sleepLeft, setSleepLeft] = useState(0);
  const [state, setState] = useState<"idle" | "playing" | "paused">("idle");
  const [waiting, setWaiting] = useState(false);
  const [at, setAt] = useState<{ passage: number; word?: [number, number] }>({ passage: 0 });
  const [caption, setCaption] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [studioLangs, setStudioLangs] = useState<string[]>([]);
  const [cloud, setCloud] = useState(false);
  const [settings, setSettings] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [docked, setDocked] = useState(false);
  const narrator = useRef<Narrator | null>(null);
  const stage = useRef<HTMLElement>(null);
  const failed = useRef(onError);
  useEffect(() => {
    failed.current = onError;
  });
  const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
  const spot = `pos:${file.name}:${file.size}`;

  useEffect(() => {
    let live = true;
    import("@/lib/ai/speak")
      .then((s) => {
        if (live) setMod(s);
        return s.readingOrder(file, (d, total) => live && setReading(d / total));
      })
      .then((d) => {
        if (!live) return;
        setDoc(d);
        const n = Number(store.get(spot));
        if (n > 0 && n < d.passages.length) setSaved(n);
      }, (e) => live && failed.current(e));
    import("@/lib/ai/cloud").then(async (c) => {
      const [ok, langs] = await Promise.all([c.cloudAvailable(), c.studioLanguages()]);
      if (!live) return;
      setCloud(ok);
      setStudioLangs(langs);
    });
    return () => {
      live = false;
    };
  }, [file, spot]);

  // The narrator's words in the document's language, not the page's.
  useEffect(() => {
    if (!doc) return;
    let live = true;
    const locale = localeOf(doc.lang);
    void getDictionary(locale).then((d) => {
      if (!live) return;
      const f = (k: string, v: Record<string, number>) => format((d as Record<string, string>)[k] ?? "", v, locale);
      setCues({
        cues: {
          intro: (pages, sections) => (sections ? f("listen.cue.intro", { pages, sections }) : f("listen.cue.pages", { pages })),
          list: (n) => f("listen.cue.list", { n }),
          table: (rows, cols) => f("listen.cue.table", { rows, cols }),
          more: (n) => f("listen.cue.more", { n }),
        },
        sample: (d as Record<string, string>)["listen.sample"],
      });
    });
    return () => {
      live = false;
    };
  }, [doc]);

  // Voices arrive asynchronously in Chrome; the list is read again when it changes.
  useEffect(() => {
    if (!synth) return;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => {
      synth.removeEventListener?.("voiceschanged", load);
      narrator.current?.stop();
      synth.cancel();
    };
  }, [synth]);

  const base = doc?.lang.split("-")[0] ?? "en";
  const groups = useMemo(() => (doc ? voiceGroups(voices, doc.lang, typeof navigator === "undefined" ? [] : navigator.languages) : []), [doc, voices]);
  const voice = pickVoice(groups, voiceKey ?? store.get(`voice:${base}`));
  const studioHere = studioLangs.includes(base);
  const kind = engineKind === "studio" && studioHere ? "studio" : "device";
  const list = useMemo(() => (doc ? chapters(doc.passages) : []), [doc]);
  const chapter = chapterOf(list, at.passage);

  const engineOf = (k: "device" | "studio", v = voice): Engine | null => {
    if (!mod || !doc) return null;
    if (k === "studio") return new mod.StudioEngine(doc.lang);
    return synth ? new mod.DeviceEngine(synth, v, doc.lang) : null;
  };

  const planOf = (m: Mode) => {
    if (!mod || !doc || !cues) return null;
    if (m === "read") return mod.readPlan(doc.passages, doc.pages, cues.cues);
    return mod.explainPlan(
      doc.passages,
      doc.pages,
      cues.cues,
      async (text, k) => (await (await import("@/lib/ai/cloud")).cloudText({ task: "narrate", text, language: doc.lang, first: k === 0 })).text,
      () => setNotice(t("listen.explainDown")),
    );
  };

  // Starts reading at `passage`, with the settings given (or the current ones).
  const play = (passage: number, o: { mode?: Mode; kind?: "device" | "studio"; rate?: number } = {}) => {
    const plan = planOf(o.mode ?? mode);
    const engine = engineOf(o.kind ?? kind);
    if (!plan || !engine || !mod || !doc) return;
    narrator.current?.stop();
    const n = new mod.Narrator(plan, engine, { rate: o.rate ?? rate, chime: chimeOn, fallback: () => engineOf("device")! }, {
      onPosition: (p, word) => {
        setAt({ passage: p, word });
        if (!word) {
          store.set(spot, String(p));
          document.querySelector(`[data-passage="${p}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      },
      onSay: (s: Segment) => setCaption(s.text),
      onEnd: () => {
        setState("idle");
        setCaption("");
        store.set(spot, "0");
      },
      onNotice: (k) => {
        setNotice(t(k === "studioDown" ? "listen.studioDown" : "listen.explainDown"));
        if (k === "studioDown") setEngineKind("device");
      },
      onWaiting: setWaiting,
    });
    narrator.current = n;
    setSaved(null);
    setState("playing");
    void n.play(plan.unitOf(passage)).catch((e) => {
      setState("idle");
      failed.current(e);
    });
  };

  const toggle = () => {
    const n = narrator.current;
    if (state === "playing" && n) {
      n.pause();
      setState("paused");
    } else if (state === "paused" && n) {
      n.resume();
      setState("playing");
    } else play(saved ?? at.passage);
  };
  const stop = () => {
    narrator.current?.stop();
    narrator.current = null;
    setState("idle");
    setCaption("");
    setAt({ passage: 0 });
  };
  // Previous and next: a paragraph in Read, a section in Explain.
  const skip = (by: 1 | -1) => {
    if (!doc) return;
    if (mode === "explain") {
      const k = Math.min(list.length - 1, Math.max(0, chapter + by));
      play(list[k].start);
    } else play(Math.min(doc.passages.length - 1, Math.max(0, at.passage + by)));
  };
  // A setting changed while reading: the sentence being said starts again with it.
  const live = state !== "idle" && narrator.current;
  const changeRate = (r: number) => {
    setRate(r);
    store.set("rate", String(r));
    if (live) narrator.current!.restart({ rate: r });
  };
  const changeVoice = (key: string) => {
    setVoiceKey(key);
    store.set(`voice:${base}`, key);
    const v = groups.flatMap((g) => g.voices).find((x) => voiceId(x) === key);
    if (live && kind === "device") {
      const e = engineOf("device", v);
      if (e) narrator.current!.restart({ engine: e });
    }
  };
  const changeKind = (k: "device" | "studio") => {
    setEngineKind(k);
    store.set("engine", k);
    setNotice(null);
    if (live) {
      const e = engineOf(k);
      if (e) narrator.current!.restart({ engine: e });
    }
  };
  const changeMode = (m: Mode) => {
    setMode(m);
    store.set("mode", m);
    setNotice(null);
    if (state !== "idle") play(mode === "read" ? list[chapter].start : at.passage, { mode: m });
  };
  const preview = () => {
    if (!mod || !doc || !cues || state === "playing") return;
    const e = engineOf(kind);
    if (!e) return;
    narrator.current?.pause();
    if (state === "paused") narrator.current?.stop();
    setState("idle");
    void e.say({ passage: 0, text: cues.sample, style: "body", before: 0, after: 0 }, rate, () => {}).catch(() => setNotice(t("listen.studioDown")));
  };

  // The sleep timer: reading pauses when it runs out.
  const cycleSleep = () => {
    const next = SLEEP[(SLEEP.indexOf(sleep) + 1) % SLEEP.length];
    setSleep(next);
    setSleepLeft(next);
  };
  useEffect(() => {
    if (!sleep) return;
    const end = Date.now() + sleep * 60_000;
    const id = setInterval(() => {
      const left = Math.ceil((end - Date.now()) / 60_000);
      setSleepLeft(left);
      if (left <= 0) {
        narrator.current?.pause();
        setState((s) => (s === "playing" ? "paused" : s));
        setSleep(0);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [sleep]);

  // The lock screen and headphones: play, pause, previous, next.
  const controls = useRef({ toggle, skip });
  useEffect(() => {
    controls.current = { toggle, skip };
  });
  useEffect(() => {
    if (!doc) return;
    mediaSession(list[chapter]?.title || file.name.replace(/\.pdf$/i, ""), file.name, state, {
      toggle: () => controls.current.toggle(),
      skip: (by) => controls.current.skip(by),
    });
  }, [doc, chapter, state, list, file.name]);

  // The small player at the bottom once the big one has scrolled away.
  useEffect(() => {
    const el = stage.current;
    if (!el || !doc) return;
    const io = new IntersectionObserver(([e]) => setDocked(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [doc]);

  if (!synth && !studioHere) return <p className="mt-6 text-[15px] text-muted" role="alert">{t("listen.noSpeech")}</p>;
  if (!doc)
    return (
      <div className="ls-loading" role="status">
        <LoadingOrb small value={reading || undefined} label={t("listen.loading")} />
      </div>
    );

  const last = doc.passages.length - 1;
  const playing = state === "playing";
  const total = doc.passages.length;
  const progress = total > 1 ? at.passage / (total - 1) : 0;
  const title = list[chapter]?.title || t("listen.opening");
  const prevLabel = t(mode === "explain" ? "listen.prevSection" : "listen.prev");
  const nextLabel = t(mode === "explain" ? "listen.nextSection" : "listen.next");
  const noDeviceVoice = !groups.length && voices.length > 0;

  const playButton = (big: boolean) => (
    <button type="button" className={big ? "ls-play" : "ls-play ls-play-sm"} onClick={toggle} data-action={big ? "play" : undefined}
      aria-label={t(playing ? "listen.pause" : state === "paused" ? "listen.resume" : "listen.play")}>
      {waiting && playing ? <span className="ls-wait" aria-hidden /> : playing ? <Pause size={big ? 26 : 18} fill="currentColor" /> : <Play size={big ? 26 : 18} fill="currentColor" className="translate-x-[2px]" />}
    </button>
  );

  return (
    <div className="ls" data-listen={state}>
      {/* The player: the file, the section being read, its words, the controls. */}
      <section ref={stage} className="ls-stage" aria-label={t("listen.play")}>
        <div className="ls-file">
          <span className="ls-file-icon"><FileText size={16} /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{file.name}</span>
            <span className="block text-[12px] text-muted tabular">{t("ws.pages", { n: doc.pages })} · {humanSize(file.size)}</span>
          </span>
          {onClose && <button type="button" className="ls-ghost" onClick={() => { stop(); onClose(); }}><RotateCcw size={14} /> {t("res.startOver")}</button>}
        </div>

        <div className="ls-modes" role="radiogroup" aria-label={t("listen.mode")}>
          {(["read", "explain"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} data-mode={m} className="ls-mode" disabled={m === "explain" && !cloud} onClick={() => changeMode(m)}>
              {m === "read" ? <AudioLines size={15} /> : <Sparkles size={15} />} {t(`listen.mode.${m}`)}
            </button>
          ))}
        </div>
        <p className="ls-hint">{t(mode === "read" ? "listen.mode.readHint" : "listen.mode.explainHint")}</p>

        <div className="ls-now">
          <p className="ls-kicker tabular">{list.length > 1 ? `${t("listen.sections")} · ${chapter + 1}/${list.length}` : t("ws.page", { n: doc.passages[at.passage]?.page ?? 1 })}</p>
          <h2 className="ls-title">{title}</h2>
          <p className={`ls-caption ${caption && state !== "idle" ? "is-on" : ""}`} aria-live="off" lang={doc.lang}>
            {waiting && mode === "explain" && playing ? t("listen.explaining") : state !== "idle" ? caption : ""}
          </p>
        </div>

        {/* The sections as one bar: each a part as long as its passages, the one being read filling. */}
        <div className="ls-track" aria-hidden>
          {list.map((c, k) => {
            const end = list[k + 1]?.start ?? total;
            const span = end - c.start;
            const fill = k < chapter ? 1 : k > chapter ? 0 : (at.passage - c.start + 1) / span;
            return (
              <button key={k} type="button" tabIndex={-1} className="ls-track-part" style={{ flexGrow: span }} onClick={() => play(c.start)} title={c.title || t("listen.opening")}>
                <i style={{ transform: `scaleX(${state === "idle" && at.passage === 0 ? 0 : fill})` }} />
              </button>
            );
          })}
        </div>
        <div className="ls-track-meta tabular"><span>{Math.round(progress * 100)}%</span><span>{t("ws.page", { n: doc.passages[at.passage]?.page ?? 1 })}</span></div>

        <div className="ls-controls">
          <button type="button" className="ls-chip tabular" onClick={() => changeRate(SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length])} aria-label={`${t("listen.speed")} ${rate}×`}>{rate}×</button>
          <button type="button" className="ls-round" aria-label={prevLabel} disabled={at.passage === 0} onClick={() => skip(-1)}><SkipBack size={19} fill="currentColor" /></button>
          {playButton(true)}
          <button type="button" className="ls-round" aria-label={nextLabel} disabled={at.passage >= last} onClick={() => skip(1)}><SkipForward size={19} fill="currentColor" /></button>
          <button type="button" className={`ls-chip ${sleep ? "is-on" : ""}`} onClick={cycleSleep} aria-label={`${t("listen.sleep")}: ${sleep ? t("listen.sleepMin", { n: sleepLeft || sleep }) : t("listen.sleepOff")}`}>
            <Moon size={14} />{sleep ? <span className="tabular">{sleepLeft || sleep}′</span> : null}
          </button>
        </div>

        <div className="ls-foot">
          <button type="button" className="ls-voice" onClick={() => setSettings((s) => !s)} aria-expanded={settings}>
            <SlidersHorizontal size={14} />
            <span className="truncate">{kind === "studio" ? t("listen.engine.studio") : voice ? shortName(voice) : t("listen.voiceDefault")}</span>
            {kind === "device" && voice && regionOf(voice.lang) && <span className="ls-tag">{regionName(voice.lang)}</span>}
          </button>
          <button type="button" className="ls-ghost" aria-label={t("listen.stop")} disabled={state === "idle"} onClick={stop}><Square size={13} fill="currentColor" /></button>
        </div>

        {settings && (
          <div className="ls-settings" aria-label={t("listen.settings")} role="group">
            <div className="ls-modes ls-modes-sm" role="radiogroup" aria-label={t("listen.engine")}>
              {(["device", "studio"] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={kind === k} data-engine={k} className="ls-mode" disabled={k === "studio" && !studioHere} onClick={() => changeKind(k)}>
                  {k === "device" ? <Volume2 size={14} /> : <Sparkles size={14} />} {t(`listen.engine.${k}`)}
                </button>
              ))}
            </div>
            <p className="ls-hint">{kind === "studio" ? t("listen.studioHint") : !studioHere && studioLangs.length ? t("listen.studioNone") : ""}</p>
            {kind === "device" && (
              <label className="ls-field">
                <span>{t("listen.voice")}</span>
                <select className="input" value={voice ? voiceId(voice) : ""} onChange={(e) => changeVoice(e.target.value)} disabled={!groups.length}>
                  {!groups.length && <option value="">{t("listen.voiceDefault")}</option>}
                  {groups.map((g) => (
                    <optgroup key={g.region || "-"} label={regionName(`${base}-${g.region}`)}>
                      {g.voices.map((v) => <option key={voiceId(v)} value={voiceId(v)}>{shortName(v)}{isNatural(v) ? ` · ${t("listen.natural")}` : ""}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="ls-ghost ls-ghost-line" onClick={preview} disabled={playing || !cues}><Play size={13} fill="currentColor" /> {t("listen.preview")}</button>
              <label className="ls-check">
                <input type="checkbox" checked={chimeOn} onChange={(e) => { setChimeOn(e.target.checked); store.set("chime", e.target.checked ? "on" : "off"); }} />
                {t("listen.chime")}
              </label>
            </div>
            {noDeviceVoice && kind === "device" && <p className="ls-hint">{t("listen.noVoice")}</p>}
          </div>
        )}
        {notice && <p className="ls-notice" role="status">{notice}</p>}
      </section>

      {saved !== null && state === "idle" && (
        <div className="ls-resume">
          <button type="button" className="ls-ghost ls-ghost-line" onClick={() => play(saved)}><Play size={13} fill="currentColor" /> {t("listen.continue", { n: doc.passages[saved].page })}</button>
          <button type="button" className="ls-ghost" onClick={() => { setSaved(null); store.set(spot, "0"); }}>{t("listen.fromStart")}</button>
        </div>
      )}

      <div className="ls-body">
        {list.length > 1 && (
          <nav className="ls-chapters" aria-label={t("listen.sections")}>
            <p className="ls-kicker">{t("listen.sections")}</p>
            <ol>
              {list.map((c, k) => (
                <li key={k}>
                  <button type="button" aria-current={k === chapter && state !== "idle" ? "true" : undefined} onClick={() => play(c.start)} className={`ls-chapter lvl-${c.level}`}>
                    <span className="truncate">{c.title || t("listen.opening")}</span>
                    <span className="tabular text-muted">{doc.passages[c.start].page}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}
        {/* The text, as it's read. */}
        <article lang={doc.lang} className="ls-text">
          {doc.passages.map((p, i) => {
            const current = i === at.passage && state !== "idle";
            const word = current ? at.word : undefined;
            const Tag = p.kind === "heading" ? (p.level === 1 ? "h2" : "h3") : "div";
            const body = p.kind === "table" && p.rows ? (
              <table>
                <tbody>{p.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => (ri === 0 ? <th key={ci}>{c}</th> : <td key={ci}>{c}</td>))}</tr>)}</tbody>
              </table>
            ) : word ? (
              <>
                {p.text.slice(0, word[0])}
                <mark>{p.text.slice(word[0], word[1])}</mark>
                {p.text.slice(word[1])}
              </>
            ) : p.text;
            return (
              <div key={i} className="contents">
                {(i === 0 || doc.passages[i - 1].page !== p.page) && <p className="ls-page tabular">{t("ws.page", { n: p.page })}</p>}
                <Tag data-passage={i} data-kind={p.kind} aria-current={current || undefined} onClick={() => play(i)} className={`ls-p ls-${p.kind}`}>
                  {body}
                </Tag>
              </div>
            );
          })}
        </article>
      </div>

      {/* On a phone, once the player has scrolled away, a small one stays in reach. */}
      <div className={`ls-dock ${docked ? "is-on" : ""}`} aria-hidden={!docked} inert={!docked}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium">{title}</span>
          <span className="ls-dock-bar"><i style={{ transform: `scaleX(${progress})` }} /></span>
        </span>
        {playButton(false)}
        <button type="button" className="ls-round" aria-label={nextLabel} disabled={at.passage >= last} onClick={() => skip(1)}><SkipForward size={17} fill="currentColor" /></button>
      </div>
    </div>
  );
}

// The lock screen's and headphones' controls, where the browser has them.
function mediaSession(title: string, artist: string, state: string, on: { toggle: () => void; skip: (by: 1 | -1) => void }) {
  const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
  if (!ms) return;
  try {
    ms.metadata = new MediaMetadata({ title, artist, album: "Nopload", artwork: [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }] });
    ms.playbackState = state === "playing" ? "playing" : state === "paused" ? "paused" : "none";
    ms.setActionHandler("play", on.toggle);
    ms.setActionHandler("pause", on.toggle);
    ms.setActionHandler("previoustrack", () => on.skip(-1));
    ms.setActionHandler("nexttrack", () => on.skip(1));
  } catch {
    /* not supported here */
  }
}

// "English (India)": a voice's accent, named in the page's language.
function regionName(lang: string) {
  try {
    const page = typeof document !== "undefined" ? document.documentElement.lang || "en" : "en";
    return new Intl.DisplayNames([page], { type: "language" }).of(lang.replace("_", "-")) ?? lang;
  } catch {
    return lang;
  }
}
