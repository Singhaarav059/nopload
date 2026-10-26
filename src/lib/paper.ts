// Motion settings and the theme's colours, for the pieces that draw.

export const reducedMotion = () => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// The current theme's colours, read from the CSS tokens.
export function paperColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { bg: v("--bg"), surface: v("--surface"), surface2: v("--surface-2"), ink: v("--ink"), line: v("--line-strong"), accent: v("--accent") };
}
export type PaperColors = ReturnType<typeof paperColors>;

// Calls back when the theme changes: the device's setting or the header's choice.
export function onThemeChange(fn: () => void) {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  mq.addEventListener("change", fn);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", fn);
  };
}
