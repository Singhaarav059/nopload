"use client";

// Paper in motion, sized by its parent: the 2D version (CSS, in the HTML from
// the start, so nothing shifts) with the 3D scene cross-fading over it where
// the device allows (src/lib/paper.ts wants3d). Purely decorative.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { PaperStack } from "../Motion";
import { wants3d, type PaperAction, type PaperMode, type PaperMotion } from "@/lib/paper";

const PaperScene = dynamic(() => import("./PaperScene"), { ssr: false });

// The CSS version of an action: two sheets and a mark (cut line, seal, scan
// bar) that globals.css animates per action (.p2d-*).
// A tool's own motion (paper.ts paperMotion) adds what it needs: a padlock,
// a pen's line, bars, a stamp, a page number, a second page, new lines.
export function Paper2D({ action, motion }: { action: PaperAction; motion?: PaperMotion | null }) {
  return (
    <div aria-hidden className={`p2d p2d-${motion ?? action}`}>
      <span className="p2d-sheet p2d-b">
        {(motion === "compare" || motion === "translate") && <><i /><i /><i /><i /></>}
      </span>
      <span className="p2d-sheet p2d-a">
        <i /><i /><i /><i />
        {motion === "redact" && <b className="p2d-bars"><u /><u /><u /></b>}
        {motion === "sign" && (
          <svg className="p2d-sig" viewBox="0 0 100 40"><path d="M4 30c8-18 14-24 18-16s-6 18 2 14 10-22 16-18-4 18 4 16 8-14 14-12 2 10 8 8 10-6 14-4" /></svg>
        )}
        {motion === "stamp" && <b className="p2d-stampmark" />}
        {motion === "number" && <b className="p2d-num"><span>1</span><span>2</span><span>3</span></b>}
        {motion === "summarize" && <b className="p2d-gist" />}
      </span>
      {(motion === "lock" || motion === "unlock") && <span className="p2d-padlock"><span className="p2d-shackle" /><span className="p2d-body" /></span>}
      <span className="p2d-mark" />
    </div>
  );
}

export function PaperStage({ mode, motion, className = "" }: { mode: PaperMode; motion?: PaperMotion | null; className?: string }) {
  const [three, setThree] = useState(false);
  const [ready, setReady] = useState(false);
  // Decided after mount: it reads the screen, motion and WebGL settings.
  // Waits for an idle moment, so the page's own work goes first.
  useEffect(() => {
    // A tool with its own motion stays in 2D: the 3D scene knows the families only.
    const run = () => setThree(!motion && wants3d());
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(run, { timeout: 1500 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(run, 200);
    return () => clearTimeout(id);
  }, [motion]);
  const onReady = useCallback(() => setReady(true), []);

  return (
    <div aria-hidden className={`relative ${className}`}>
      <div className={`absolute inset-0 grid place-items-center transition-opacity duration-700 ${ready ? "opacity-0" : "opacity-100"}`}>
        {mode === "hero" ? <PaperStack /> : <Paper2D action={mode} motion={motion} />}
      </div>
      {three && (
        <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}>
          <PaperScene mode={mode} onReady={onReady} />
        </div>
      )}
    </div>
  );
}
