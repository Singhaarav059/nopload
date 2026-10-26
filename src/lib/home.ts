// The logo and the Home tab, pressed: on another page they go home, at the
// very top (the router alone stops where the page's content starts, under
// the sticky header); already home, they scroll back to the top, and at the
// top they load the page afresh, as a site's logo does.
export function goHome(e: React.MouseEvent, home: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const trim = (p: string) => p.replace(/\/+$/, "");
  const target = trim(new URL(home, location.href).pathname);
  if (trim(location.pathname) !== target) {
    const until = performance.now() + 3000;
    const land = () => {
      if (trim(location.pathname) === target) requestAnimationFrame(() => scrollTo(0, 0));
      else if (performance.now() < until) requestAnimationFrame(land);
    };
    requestAnimationFrame(land);
    return;
  }
  e.preventDefault();
  if (scrollY > 4) scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  else location.reload();
}
