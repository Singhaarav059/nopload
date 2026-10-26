import { Fragment } from "react";

// Small, server-rendered motion pieces. All of them animate in CSS
// (src/app/globals.css), so the text is in the HTML and reads the same
// with scripts off or motion reduced.

// A headline whose words lift in one by one. The spaces stay text nodes, so
// textContent is the original string. Languages without spaces animate as one.
export function Words({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <span className="words">
      {words.map((w, i) => (
        <Fragment key={i}>
          <span style={{ "--i": i } as React.CSSProperties}>{w}</span>
          {i < words.length - 1 && " "}
        </Fragment>
      ))}
    </span>
  );
}
