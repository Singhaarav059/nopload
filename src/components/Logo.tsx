import { BRAND } from "@/lib/brand";

// The mascot: a page that floats like a little ghost (your files leave no
// trace), orange, with big eyes. Same drawing as public/icon.svg. Inside a
// `group`, it bobs up a little on hover; its eyes blink.
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="5 2 22 28"
      aria-hidden
      className="shrink-0 overflow-visible transition-transform duration-500 ease-(--ease-spring) group-hover:-translate-y-1 group-hover:-rotate-6"
    >
      <Ghost />
    </svg>
  );
}

// The drawing, in the 22 × 28 box at (5, 2). `look` moves the pupils.
function Ghost({ look = false }: { look?: boolean }) {
  return (
    <>
      <path d="M10 4h8l7 7v16.5l-2.75-2-2.75 2-2.75-2-2.75 2-2.75-2L7 27.5V7a3 3 0 0 1 3-3z" fill="var(--brand)" />
      <path d="M18 4v5a2 2 0 0 0 2 2h5z" fill="#000" opacity="0.28" />
      <g className="blink">
        <ellipse cx="12.4" cy="15.6" rx="2.55" ry="3.05" fill="#fff" />
        <ellipse cx="18.6" cy="15.6" rx="2.55" ry="3.05" fill="#fff" />
      </g>
      <g className={look ? "mascot-look" : undefined}>
        <circle cx="12.9" cy="16.1" r="1.35" fill="#000" />
        <circle cx="19.1" cy="16.1" r="1.35" fill="#000" />
      </g>
      <path d="M14.2 21.2q1.8 1.5 3.6 0" fill="none" stroke="#000" strokeWidth="0.9" strokeLinecap="round" />
    </>
  );
}

// The mascot large, looking around: peeking over a title or a search box
// (`peek`: only its top half shows, as if behind it), or whole.
export function Mascot({ size = 96, peek = false, className = "" }: { size?: number; peek?: boolean; className?: string }) {
  return (
    <span aria-hidden className={`mascot ${peek ? "mascot-peek" : ""} ${className}`} style={{ "--m": `${size}px` } as React.CSSProperties}>
      <svg viewBox="5 2 22 28" width={size} height={(size * 28) / 22} className="overflow-visible">
        <Ghost look />
      </svg>
    </span>
  );
}

export function Logo() {
  return (
    <span className="group inline-flex items-center gap-2">
      <LogoMark />
      <span className="text-[1.15rem] font-semibold leading-none tracking-[-0.035em]">{BRAND.name}</span>
    </span>
  );
}
