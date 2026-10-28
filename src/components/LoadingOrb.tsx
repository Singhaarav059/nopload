// While something works with no machine to show (the AI tools, a page or
// the viewer opening): a frame with corner marks on a field of crosses, a
// glowing orb floating in it, a ring going out from it, and the percentage
// under it when there is one (globals.css .lorb).
export function LoadingOrb({ value, label, small = false }: { value?: number; label?: string; small?: boolean }) {
  const pct = value === undefined ? null : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={`lorb ${small ? "lorb-sm" : ""}`} role={pct === null ? "status" : undefined}>
      <div aria-hidden className="lorb-frame">
        <i /><i /><i /><i />
        <span className="lorb-ring" />
        <span className="lorb-ball" />
        <span className="lorb-shadow" />
        {pct !== null && <span className="lorb-pct tabular">{pct}%</span>}
      </div>
      {label && <p className="lorb-label">{label}</p>}
    </div>
  );
}
