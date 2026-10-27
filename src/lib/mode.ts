// The free hosted build (NOPLOAD_STATIC=1, see next.config.ts): plain files,
// no server. Every tool runs in the browser; server conversions and the
// contact form are left out.
export const STATIC = process.env.NEXT_PUBLIC_STATIC === "1";

// This build has the server AI that every AI tool uses (src/lib/ai/cloud.ts,
// NOPLOAD_AI_CLOUD in next.config.ts); without it the AI tools say they
// can't run here.
export const AI_CLOUD = process.env.NEXT_PUBLIC_AI_CLOUD === "1";

// The source code, whose issues page is where problems get reported. From
// package.json's "repository" unless NEXT_PUBLIC_REPO_URL is set (next.config.ts).
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? "";
