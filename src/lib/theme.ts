// The colour theme: dark unless light or the device's setting ("system") was
// chosen in the header or settings (src/components/ThemeMenu.tsx). A choice
// is kept in localStorage; dark and light show as data-theme on <html>,
// which globals.css reads (no data-theme: the device's setting).

export type Theme = "system" | "light" | "dark";
export const THEMES: Theme[] = ["system", "light", "dark"];
export const THEME_KEY = "theme";

// The browser bar colour for each theme, matching --bg.
export const THEME_COLOR = { light: "#f5f4f1", dark: "#000000" } as const;
export const DEFAULT_THEME: Theme = "dark";

// Runs in <head> before the first paint, so a chosen theme never flashes the
// other one. Plain ES5, wrapped in try: storage can be blocked.
// The page is built with data-theme="dark" (src/app/[lang]/layout.tsx).
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}")||"${"dark"}",r=document.documentElement;if(t==="system")delete r.dataset.theme;else{if(t!=="light")t="dark";r.dataset.theme=t;document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.content=t==="dark"?"${THEME_COLOR.dark}":"${THEME_COLOR.light}"})}}catch(e){}`;
