// Legal text describes how this app actually behaves. It is a starting point:
// the operator's name, country and contact come from src/lib/brand.ts (a
// release build refuses the placeholders), and the text should be reviewed by
// a lawyer before going live.
import { BRAND, OPERATOR } from "./brand";
import { STATIC } from "./mode";

// The static build has no server or cookies, so its text says so.
const on = <T,>(when: boolean, items: T[]) => (when ? items : []);

export const LEGAL_UPDATED = "2026-10-26";

// link: a line ending in a link, as [lead-in, text, href]; no href, no link.
type Section = { id?: string; h: string; p: string[]; list?: string[]; link?: [string, string, string] };
export type LegalDoc = { title: string; intro: string; sections: Section[] };

// Who runs the site and how to reach them, at the top of the privacy policy and terms.
const operator = (p: string): Section => ({
  id: "operator",
  h: "Who runs this site",
  p: [p],
  link: ["Contact:", OPERATOR.contact, OPERATOR.contactHref],
});

export const LEGAL: Record<"privacy" | "terms" | "cookies", LegalDoc> = {
  privacy: {
    title: "Privacy policy",
    intro: `This policy explains what ${BRAND.name} collects, why, and what you can do about it.`,
    sections: [
      operator(`${BRAND.name} is run by ${OPERATOR.name}, based in ${OPERATOR.country}, who is responsible for your data. Questions about this policy or your data go to the contact below.`),
      {
        h: "Files you process",
        p: STATIC
          ? [
              "Every tool works on your files inside your browser. Your files are never sent to us or to anyone else. The AI tools are the one exception to keeping their contents on your device: see “The AI tools” below.",
              "Office and HTML files are laid out in your browser and saved through its own print dialog.",
              "High-fidelity Office conversion and high-accuracy OCR download their engines (LibreOffice, and PaddleOCR with ONNX Runtime) from this same site the first time you use them. They run on your device too, so your files still stay there.",
            ]
          : [
              "Tools marked “Runs on your device” process files entirely in your browser. Those files are never sent to us.",
              "High-accuracy OCR downloads its engine (PaddleOCR with ONNX Runtime) from this same site the first time you use it. It runs on your device too, so your files still stay there.",
              "The AI tools (Chat with PDF, Summarize, Translate) send some of a document's text to AI services: see “The AI tools” below.",
              "Office conversions and web page conversion send the file to our server over HTTPS. We process it in memory or a temporary folder and delete it as soon as the result is returned. We don't keep copies or look at the contents.",
            ],
      },
      {
        id: "recent",
        h: "PDFs you read",
        p: [
          "The PDF viewer keeps the PDFs you open in it in your browser's storage on this device (IndexedDB), with the page you reached, so you can open them again from Recent in one tap, offline too. They are never uploaded. The first time a file is kept, the viewer says so.",
          "At most 12 files and 300 MB are kept; past that, the oldest go first. Remove one with its ✕ in Recent, all of them with Clear, or turn off “Remember opened files” (under Recent in the viewer, or in the app's Settings), which also removes those already kept. Clearing your browser data removes them too. On a shared computer, turn it off or use a private window.",
        ],
      },
      {
        id: "ai",
        h: "The AI tools",
        p: [
          "Chat with PDF, Summarize PDF and Translate PDF use AI on our server; there is no AI on your device. Your file stays on your device, but some of its text is sent: for Chat with PDF, your question, the earlier questions and answers in that chat, and the passages of the PDF that best match the question; for Summarize PDF, the document's text (about the first 15,000 words, plus its key sentences when it's longer); for Translate PDF, the document's text, a few blocks at a time. Each tool says so next to its options. The other tools send nothing.",
          "That text goes over HTTPS to a small function of ours on Cloudflare, which passes it to the first of these that answers: open models (gpt-oss by OpenAI, Qwen by Alibaba, Llama by Meta) run by Groq or by Cerebras; Claude, an AI model made by Anthropic; Gemini, an AI model made by Google, on Google's free tier; and Qwen3, an open model, on Cloudflare Workers AI. Gemini is asked only when Groq and Claude don't answer, so most text never reaches it.",
          "Groq, Cerebras, Anthropic and Cloudflare process the text under their own terms and privacy policies; under those terms none of them uses it to train AI models. They may keep it for a limited time to detect misuse.",
          "Google's terms for its free tier are different: Google may use the text it's sent, and the answers, to provide and improve its products and to develop its AI, and its human reviewers may read them (Google says it first separates them from our account). Google asks that sensitive, confidential or personal information isn't sent this way. For visitors in the European Economic Area, Switzerland and the United Kingdom, Google's terms apply its paid-service rules instead, under which it doesn't use the text to improve its products. If a document is sensitive, don't use the AI tools on it.",
          "We don't log the text or the answers. So that the same request is answered again without asking an AI model, the function keeps recent answers in its memory (never on disk) for up to six hours, under a code computed from the request rather than the text itself. To stop one visitor using up the service, it counts how much text each IP address sent in the last hour, for up to an hour, and how many chat questions it asked today (at most 10 a minute and 60 a day), until the end of the day.",
          "Your browser keeps the answers the AI gave you for a week, on your device only, so asking the same question about the same PDF again is answered at once. Clearing this site's data in your browser removes them.",
          "Chat with PDF never shows passages of the document as an answer on their own. When the AI services don't answer, the tools say so and send nothing more.",
        ],
      },
      ...on(!STATIC, [{
        h: "Messages",
        p: ["If you use the contact form we store your email address and message so we can reply."],
      }]),
      {
        h: "Technical data",
        p: [
          STATIC
            ? "This site is served as plain files by a hosting provider, which may log requests (IP address, time, page requested) under its own privacy policy. Apart from the AI function described above, we don't run a server of our own."
            : "Our server logs requests (IP address, time, page requested) for security and rate limiting. Logs are kept for a short period and then deleted.",
        ],
      },
      {
        h: "What we don't do",
        p: ["We don't sell data, show ads, or use third-party trackers or analytics."],
      },
      {
        h: "Your rights",
        p: STATIC
          ? [
              "We hold no personal data about you, apart from the in-memory counts of AI use per IP address described above. What this site keeps in your browser (workflows, signatures, the PDFs you read and where you stopped, your language, the AI answers you got) is removed when you clear your browser data.",
            ]
          : [
              "What this site keeps in your browser (workflows, signatures, the PDFs you read and where you stopped, your language) is removed when you clear your browser data. To have a message you sent through the contact form deleted, contact us.",
              "Depending on where you live you may have further rights, such as access, correction and objection. Contact us through the contact page to use them.",
            ],
      },
    ],
  },
  terms: {
    title: "Terms of use",
    intro: `By using ${BRAND.name} you agree to these terms.`,
    sections: [
      operator(`${BRAND.name} is run by ${OPERATOR.name}, based in ${OPERATOR.country}.`),
      {
        h: "Using the service",
        p: [
          "You may use the tools for any lawful purpose. Only process documents you have the right to process.",
          STATIC
            ? "Don't attempt to disrupt the service."
            : "Don't attempt to overload, probe or disrupt the service, or use the web page converter to reach systems you aren't allowed to access.",
        ],
      },
      {
        h: "Your content",
        p: ["You keep all rights to your files. We only handle them to perform the task you ask for, as described in the privacy policy."],
      },
      {
        h: "No warranty",
        p: [
          "The service is provided as is. We work to keep it accurate and available but can't guarantee that every conversion is perfect or that the service is uninterrupted. Keep your originals.",
        ],
      },
      {
        h: "Liability",
        p: ["To the extent the law allows, we aren't liable for indirect losses or for data loss arising from use of the service."],
      },
      {
        h: "Governing law",
        p: [`These terms are governed by the law of ${OPERATOR.country}. If you live elsewhere, you keep any protection the law of your own country gives you that an agreement can't take away.`],
      },
      {
        h: "Changes",
        p: ["We may update these terms. The date at the top shows the latest version."],
      },
    ],
  },
  cookies: {
    title: "Cookies",
    intro: "We use as little browser storage as possible, and none of it tracks you.",
    sections: [
      STATIC
        ? { h: "Cookies", p: ["This site doesn't set any cookies."] }
        : {
            h: "Cookies",
            p: ["We set one cookie, which is strictly necessary:"],
            list: ["locale: remembers the language you picked. Expires after a year."],
          },
      {
        h: "Local storage",
        p: [
          "Signatures and workflows you save, the language you picked and where the AI tools run, are kept in your browser's local storage on your device only. Clearing your browser data removes them.",
          "The PDF viewer keeps the PDFs you open in it (at most 12 files and 300 MB), the page you reached and your highlights, in your browser's storage on your device only, to open them again from Recent. Turn off “Remember opened files” to stop it and remove them; see the privacy policy.",
          "The installable app stores the site's code in your browser so the on-device tools work offline.",
        ],
      },
      {
        h: "No tracking",
        p: ["There are no advertising, analytics or social media cookies, so there's no consent banner."],
      },
    ],
  },
};
