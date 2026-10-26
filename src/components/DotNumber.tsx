// A number drawn in dots, like a departure board: each character a 5×7 grid,
// the lit dots in ink, the rest faint. Used for the home board's figures.
const GLYPHS: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "%": ["11000", "11001", "00010", "00100", "01000", "10011", "00011"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
};

export function DotNumber({ value, height = 44, className = "", label }: { value: string; height?: number; className?: string; label?: string }) {
  const chars = [...value].filter((c) => GLYPHS[c]);
  const step = 10;
  const width = chars.length * 6 * step - step;
  return (
    <svg role="img" aria-label={label ?? value} viewBox={`0 0 ${width} ${7 * step}`} height={height} className={`dot-number ${className}`}>
      {chars.map((c, i) =>
        GLYPHS[c].flatMap((row, y) =>
          [...row].map((on, x) => (
            <circle key={`${i}-${x}-${y}`} cx={i * 6 * step + x * step + step / 2} cy={y * step + step / 2} r={step * 0.36} className={on === "1" ? "dot-on" : "dot-off"} />
          )),
        ),
      )}
    </svg>
  );
}
