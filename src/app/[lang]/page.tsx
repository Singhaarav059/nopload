import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowRight, Check, Download, ShieldCheck, Zap } from "lucide-react";
import { ToolGrid } from "@/components/ToolGrid";
import { ToolIcon } from "@/components/ToolIcon";
import { Words } from "@/components/Motion";
import { HeroDrop } from "@/components/HeroDrop";
import { HowGuide } from "@/components/HowGuide";
import { HomeBoard } from "@/components/HomeBoard";
import { InstallBanner } from "@/components/InstallGuide";
import { OpenFab } from "@/components/OpenFab";
import { Mascot } from "@/components/Logo";
import { Greeting } from "@/components/Greeting";
import { Friend, HeroScene, SleepyCloud, Sparkle } from "@/components/Studio";
import { format, getDictionary } from "@/lib/i18n/dictionary";
import { hasLocale } from "@/lib/i18n/locales";
import { TOOLS } from "@/lib/tools";
import { STATIC } from "@/lib/mode";
import { BRAND } from "@/lib/brand";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: PageProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = await getDictionary(lang);
  return pageMetadata({ lang, title: `${BRAND.name}: ${t["home.title"]}`, description: t["home.subtitle"] });
}

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const t = await getDictionary(lang);
  const chain = ["merge", "compress", "pageNumbers", "protect"].map((id) => TOOLS.find((x) => x.id === id)!);
  const local = TOOLS.filter((x) => x.runtime === "browser").length;


  return (
    <div className="relative mx-auto max-w-[1240px] px-4 sm:px-6">
      {/* Hero: what this is, a way in for people who don't know which tool
          they need, and the most used tools. The scene says the rest: the
          work happens in this window, and the cloud gets nothing. */}
      {/* The one burst of colour: a soft glow behind the hero, drawn once. */}
      <div aria-hidden className="aurora-wash" />
      <section data-app-hero className="relative grid items-center gap-10 pb-10 pt-10 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:gap-8 lg:pb-16 lg:pt-20">
        <div className="flex min-w-0 flex-col">
          <div data-web-only className="fade-up flex flex-wrap items-center gap-2" style={{ "--d": "0ms" } as React.CSSProperties}>
            <p data-cat="organize" className="pill">
              <ShieldCheck size={14} strokeWidth={2} aria-hidden />
              <span className="tabular">{local}/{TOOLS.length}</span>
              {t["home.privateBadge"]}
            </p>
            {/* The exception, said where the claim is: AI can use the server. */}
            <Link href={`/${lang}/privacy`} className="pill text-ink-2 hover:text-ink">{t["home.aiBadge"]}</Link>
          </div>
          <p data-app-only className="mb-1"><Greeting /></p>
          <h1 data-app-title className="display hero-title relative mt-6 max-w-[14ch] text-[3rem] sm:text-[4.5rem] lg:text-[5.4rem]">
            <span data-web-only><Words text={t["home.title"]} /></span>
            <span data-app-only>{t["app.hello"]}</span>
          </h1>
          {/* The app: open a file, then choose what to do with it. */}
          <div data-app-only className="mt-4"><OpenFab /></div>
          <p data-web-only className="fade-up mt-6 max-w-[540px] text-pretty text-[17px] leading-[1.6] text-ink-2 sm:text-[18px]" style={{ "--d": "450ms" } as React.CSSProperties}>
            {t["home.subtitle"]}
          </p>
          <div data-web-only className="fade-up relative mt-14 max-w-[600px]" style={{ "--d": "600ms" } as React.CSSProperties}>
            <Mascot peek size={64} className="hero-peek" />
            <div className="relative z-[1]"><HeroDrop /></div>
          </div>
          <a data-web-only href="#tools" className="fade-up link-u mt-6 inline-flex items-center gap-1.5 self-start text-[14px] font-medium text-ink-2 hover:text-ink" style={{ "--d": "750ms" } as React.CSSProperties}>
            {format(t["home.browseAll"], { n: TOOLS.length })} <ArrowDown size={14} aria-hidden />
          </a>
        </div>
        <div data-web-only className="fade-up relative hidden sm:block" style={{ "--d": "200ms" } as React.CSSProperties}>
          <HeroScene badge={t["home.privateBadge"]} />
        </div>
      </section>

      <HomeBoard />
      <InstallBanner />

      <div data-web-only className="mt-14 sm:mt-20">
        <HowGuide />
      </div>

      {/* Every tool, to search and filter; in the app, the rest of its home. */}
      <div data-home-tools className="mt-16 sm:mt-20">
        <ToolGrid />
      </div>

      {/* Why the files stay put, and the promise with its proof. */}
      <section data-web-only aria-labelledby="home-cloud" className="relative mt-20 grid items-center gap-10 overflow-hidden rounded-[36px] bg-surface-2 px-6 py-12 sm:px-12 sm:py-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
        <div aria-hidden className="relative mx-auto aspect-[5/4] w-full max-w-[440px]">
          <div data-cat="organize" className="blob inset-[8%] bg-(--tint)" />
          <div className="absolute end-[6%] top-[0%] w-[34%]">
            <SleepyCloud className="bob w-full" />
          </div>
          <svg viewBox="0 0 100 80" className="absolute inset-0 h-full w-full overflow-visible rtl:-scale-x-100" fill="none">
            <path d="M44 40 C 52 28, 58 22, 64 19" stroke="var(--muted)" strokeWidth="0.8" strokeLinecap="round" className="flow" />
            <g transform="translate(66 17.5)">
              <circle r="3.6" fill="var(--surface)" stroke="var(--danger)" strokeWidth="0.9" />
              <path d="M-2.2 -2.2 L2.2 2.2" stroke="var(--danger)" strokeWidth="0.9" strokeLinecap="round" />
            </g>
          </svg>
          {/* A laptop with the friend at home inside. */}
          <div className="absolute bottom-[8%] start-[6%] w-[62%]">
            <div className="rounded-t-[18px] border border-line bg-surface p-[6%] shadow-lift">
              <div data-cat="security" className="mx-auto w-[42%]">
                <Friend mood="proud" className="w-full" />
              </div>
            </div>
            <div className="mx-[-8%] h-3 rounded-b-[10px] bg-line-strong" />
          </div>
          <Sparkle className="absolute start-[8%] top-[14%] w-5 text-coral" delay="-0.6s" />
        </div>
        <div className="min-w-0">
          <h2 id="home-cloud" className="reveal display max-w-[16ch] text-[2rem] sm:text-[2.75rem]">{t["home.cloudTitle"]}</h2>
          <p className="reveal mt-5 max-w-[520px] text-pretty text-[16px] leading-relaxed text-ink-2">{t["home.cloudBody"]}</p>
          <div data-promise className="reveal mt-8">
            <h3 className="sr-only">{t["home.promiseLabel"]}</h3>
            <ul className="grid gap-3 text-[15px] text-ink-2 sm:grid-cols-2">
              {(["home.promise1", "home.promise2", STATIC ? "home.promise3" : "home.promise3Server", "home.promise4"] as const).map((k) => (
                <li key={k} className="flex items-start gap-3 rounded-2xl bg-surface p-3.5 shadow-card">
                  <span data-cat="organize" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-(--tint) text-(--tint-ink)">
                    <Check size={14} strokeWidth={2.75} aria-hidden />
                  </span>
                  <span className="text-pretty leading-snug">{t[k]}</span>
                </li>
              ))}
            </ul>
            <Link href={`/${lang}/security#check`} className="link-u mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-ink-2 transition-colors hover:text-ink">
              {t["home.promiseCheck"]} <ArrowRight size={14} className="rtl:rotate-180" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      {/* Workflows: a few tools in a row, run as one. */}
      <section data-web-only aria-labelledby="home-workflows" className="mt-20 grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="min-w-0">
          <p className="reveal eyebrow">{t["nav.workflows"]}</p>
          <h2 id="home-workflows" className="reveal display mt-3 max-w-[18ch] text-[2rem] sm:text-[2.75rem]">{t["home.workflowsTitle"]}</h2>
          <p className="reveal mt-5 max-w-[480px] text-pretty text-[16px] leading-relaxed text-muted">{t["home.workflowsBody"]}</p>
          <ol className="mt-10 flex min-w-0 flex-wrap items-center gap-y-3" aria-label={t["nav.workflows"]}>
            {chain.map((tool, i) => (
              <li key={tool.id} className="reveal flex items-center" style={{ animationRangeEnd: `entry ${55 + i * 12}%` }}>
                <span data-cat={tool.category} className="flex items-center gap-2.5 rounded-full border border-line bg-surface py-1.5 pe-4 ps-1.5 text-[14px] font-medium shadow-card">
                  <ToolIcon tool={tool} size={30} />
                  {t[`tool.${tool.id}.name` as keyof typeof t]}
                </span>
                {i < chain.length - 1 && (
                  <svg aria-hidden viewBox="0 0 40 8" className="mx-1 h-2 w-7 sm:w-10 rtl:-scale-x-100" fill="none">
                    <path d="M2 4h30" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round" className="flow" />
                    <path d="M33 1l4 3-4 3" stroke="var(--line-strong)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </li>
            ))}
          </ol>
        </div>
        <Link href={`/${lang}/workflows`} className="btn btn-primary btn-lg max-w-full justify-self-start whitespace-normal">
          {t["home.workflowsCta"]} <ArrowRight size={16} className="rtl:rotate-180" />
        </Link>
      </section>

      {/* What makes it different, in three soft cards. */}
      <section data-web-only aria-labelledby="home-why" className="mt-20">
        <h2 id="home-why" className="reveal display text-[2rem] sm:text-[2.75rem]">{t["home.whyTitle"]}</h2>
        <dl className="mt-10 grid gap-4 md:grid-cols-3">
          {([
            ["home.why1Title", STATIC ? "home.why1BodyLocal" : "home.why1Body", ShieldCheck, "security"],
            ["home.why2Title", "home.why2Body", Zap, "optimize"],
            ["home.why3Title", "home.why3Body", Download, "convertFrom"],
          ] as const).map(([title, body, Icon, cat], i) => (
            <div
              key={title}
              data-cat={cat}
              className="reveal group relative overflow-hidden rounded-[28px] bg-(--tint) p-7 transition-[translate,rotate] duration-700 ease-(--ease-spring) hover:-translate-y-1 hover:-rotate-1"
              style={{ animationRangeEnd: `entry ${55 + i * 12}%` }}
            >
              <span className="grid h-14 w-14 place-items-center rounded-[20px] bg-surface text-(--tint-ink) shadow-card transition-transform duration-700 ease-(--ease-spring) group-hover:-rotate-12 group-hover:scale-110">
                <Icon size={24} strokeWidth={1.75} aria-hidden />
              </span>
              <dt className="mt-8 text-[18px] font-semibold tracking-[-0.015em]">{t[title]}</dt>
              <dd className="mt-2 max-w-[38ch] text-pretty text-[15px] leading-relaxed text-ink-2">{t[body]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
