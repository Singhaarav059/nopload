import { ImageResponse } from "next/og";
import { BRAND, SITE_URL } from "@/lib/brand";
import en, { type DictKey } from "@/lib/i18n/dict/en";
import { OG_SIZE } from "@/lib/seo";
import { TOOLS, descKey } from "@/lib/tools";

// Social cards (og:image, twitter:image), drawn at build time: one per tool
// and "home" for every other page. Every language shares them, so the text
// is English. Colours are the light theme's (src/app/globals.css).
export function generateStaticParams() {
  return [...TOOLS.map((t) => ({ image: `${t.slug}.png` })), { image: "home.png" }];
}

export async function GET(_req: Request, { params }: RouteContext<"/og/[image]">) {
  const { image } = await params;
  const tool = TOOLS.find((t) => `${t.slug}.png` === image);
  if (!tool && image !== "home.png") return new Response("Not found", { status: 404 });
  const title = tool ? en[`tool.${tool.id}.name` as DictKey] : en["home.title"];
  const body = tool ? en[descKey(tool) as DictKey] : en["home.subtitle"];
  const note = !tool ? BRAND.tagline : tool.ai ? en["home.aiBadge"] : tool.runtime === "browser" ? en["home.privateBadge"] : en["home.serverBadge"];

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: 72, background: "#000000", color: "#f7f7f7" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 40, letterSpacing: "-0.03em" }}>
          <svg width="44" height="56" viewBox="5 2 22 28">
            <path d="M10 4h8l7 7v16.5l-2.75-2-2.75 2-2.75-2-2.75 2-2.75-2L7 27.5V7a3 3 0 0 1 3-3z" fill="#ff6a13" />
            <path d="M18 4v5a2 2 0 0 0 2 2h5z" fill="#b84a0d" />
            <ellipse cx="12.4" cy="15.6" rx="2.55" ry="3.05" fill="#fff" />
            <ellipse cx="18.6" cy="15.6" rx="2.55" ry="3.05" fill="#fff" />
            <circle cx="12.9" cy="16.1" r="1.35" fill="#000" />
            <circle cx="19.1" cy="16.1" r="1.35" fill="#000" />
            <path d="M14.2 21.2q1.8 1.5 3.6 0" fill="none" stroke="#000" strokeWidth="0.9" strokeLinecap="round" />
          </svg>
          {BRAND.name}
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 64 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ fontSize: tool ? 96 : 76, lineHeight: 1.04, letterSpacing: "-0.045em" }}>{title}</div>
            <div style={{ marginTop: 28, fontSize: tool ? 34 : 30, lineHeight: 1.4, color: "#c9c9c9" }}>{body}</div>
          </div>
          {/* The mascot, large. */}
          <svg width="220" height="280" viewBox="5 2 22 28">
            <path d="M10 4h8l7 7v16.5l-2.75-2-2.75 2-2.75-2-2.75 2-2.75-2L7 27.5V7a3 3 0 0 1 3-3z" fill="#ff6a13" />
            <path d="M18 4v5a2 2 0 0 0 2 2h5z" fill="#b84a0d" />
            <ellipse cx="12.4" cy="15.6" rx="2.55" ry="3.05" fill="#fff" />
            <ellipse cx="18.6" cy="15.6" rx="2.55" ry="3.05" fill="#fff" />
            <circle cx="12.9" cy="16.1" r="1.35" fill="#000" />
            <circle cx="19.1" cy="16.1" r="1.35" fill="#000" />
            <path d="M14.2 21.2q1.8 1.5 3.6 0" fill="none" stroke="#000" strokeWidth="0.9" strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #232323", paddingTop: 28, fontSize: 28, color: "#8e8e8e" }}>
          <span>{note}</span>
          <span>{new URL(SITE_URL).host}</span>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
