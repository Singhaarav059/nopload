// While something works with no machine to show (the AI tools, a PDF being
// read, the viewer or the editor opening): a thin ring that fills with the
// progress, the percentage inside it, or that turns while the time isn't
// known (globals.css .lr).
export function LoadingOrb({ value, label, small = false }: { value?: number; label?: string; small?: boolean }) {
  const pct = value === undefined ? null : Math.round(Math.max(0, Math.min(1, value)) * 100);
  const r = 26, c = 2 * Math.PI * r;
  return (
    <div className={`lr-wrap ${small ? "lr-sm" : ""}`} role={pct === null ? "status" : undefined}>
      <svg aria-hidden viewBox="0 0 60 60" className={`lr ${pct === null ? "lr-spin" : ""}`}>
        <circle cx="30" cy="30" r={r} className="lr-track" />
        <circle cx="30" cy="30" r={r} className="lr-fill" strokeDasharray={c} strokeDashoffset={pct === null ? c * 0.72 : c * (1 - pct / 100)} />
      </svg>
      {pct !== null && <span aria-hidden className="lr-pct tabular">{pct}%</span>}
      {label && <p className="lr-label">{label}</p>}
    </div>
  );
}

// The AI writing an answer: three dots, one after another.
export function Typing() {
  return <span aria-hidden className="typing"><i /><i /><i /></span>;
}
