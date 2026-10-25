# Market research, October 2026

What competitors offer, what users complain about, and what nobody offers
yet, with sources. Two research passes (competitor features; user needs from
Hacker News, the Stirling-PDF issue tracker, Trustpilot, G2, Capterra and
Adobe Community). Reddit couldn't be read directly, so nothing here rests on
it. Vendor claims are marked as such; uncertain items say so.

## Where Nopload already wins

- No task, hourly or daily caps; no size caps beyond the device; no account;
  no watermark. Competitors: iLovePDF 1 task per tool for most tools and 15 MB
  for OCR/Office ([pricing](https://www.ilovepdf.com/pricing)); Sejda 3
  tasks a day, 50 MB, 200 pages ([sejda](https://www.sejda.com/desktop));
  Xodo 1 web action a day; UPDF watermarks saved edits; Adobe needs an ID and
  puts text editing, OCR and Compare in Pro.
- Files never leave the device. iLovePDF, Smallpdf, Sejda online, PDF24 web
  and Acrobat online all upload. Users ask for privacy they can verify (open
  source, offline mode, visible network activity:
  [HN 43880962](https://news.ycombinator.com/item?id=43880962)); Nopload has
  all three (privacy chip, offline, MIT).
- Free certificate (PAdES) signing, verifiable redaction, exact-size
  compression with exam presets, workflows, Bates numbering, compare with
  export, on-device AI. Each of these is paid or missing elsewhere.

Closest competitor: BentoPDF, the same in-browser model with about 118 tools,
a text editor, a workflow builder, timestamping, EPUB/CBZ conversion, table
extraction and layers ([bentopdf.com](https://www.bentopdf.com/)).

## The biggest gap: real editing

The most common complaint about PDF editors is fake text editing: new text
laid over the old, both visible after export, or Helvetica everywhere
([HN 43880962](https://news.ycombinator.com/item?id=43880962)). "Edit PDF
text directly" is among the most-discussed Stirling-PDF requests (#1141), and
at least six "edits real text" Show HN launches appeared in 2025 to 2026.

What the leaders do:
- Acrobat Pro reflows text within a paragraph box (boxes don't push each
  other), keeps the embedded font where it can, edits images (replace, crop,
  rotate, flip, order) and line art, and runs OCR when you edit a scan. Pro
  only.
- Foxit claims reflow across paragraphs and pages; UPDF says its boxes grow as
  you type (vendor claims). PDFgear splits paragraphs into separate blocks and
  substitutes Helvetica; Sejda edits one line at a time; iLovePDF (February
  2026) and Stirling edit line by line with no reflow.
- Almost no web tool has an object or layers panel. Sejda and PDFgear can't
  edit scanned text in place.

Nopload's plan (in progress): every object on the page editable (text,
images, shapes, embedded graphics: move, resize, rotate, delete, restyle,
reorder, replace images), a live preview drawn from the edited PDF itself,
paragraph editing with reflow in the original font, scanned-page editing via
OCR, an objects panel, undo and redo for all of it.

## What to add next, ranked

Ranked by demand in the sources, by fit with Nopload's privacy model, and by
what competitors charge for.

1. **Annotations and links in the editor.** Sticky notes, underline,
   strike-through, stamps, comments; add/edit/remove links; find and replace
   across the document; page operations (insert, delete, rotate, reorder)
   without leaving the editor. Standard in Acrobat and PDF Expert; iLovePDF
   added annotations in 2026.
2. **Statements and tables to Excel/CSV, with a totals check.** Accountants
   won't upload client statements; the paid alternatives are upload-based and
   tell users to "always review" ([example](https://www.capterra.co.uk/software/1238259/Secure-Bank-Statement-Converter)).
   Nopload already extracts tables; a check that extracted totals add up would
   be unique. (Demand inferred.)
3. **Scrub personal data before AI.** Detect and truly redact names, emails,
   ID numbers (PAN, Aadhaar, SSN) on the device, then summarize or chat
   ([HN 47563103](https://news.ycombinator.com/item?id=47563103)). The redact
   presets exist; this is a one-step "prepare for AI" flow.
4. **Accessibility checker with AI alt text.** US ADA Title II requires WCAG
   2.1 AA documents from public bodies by April 2027/2028
   ([source](https://www.jamworks.com/news/ada-title-ii-compliance-higher-education-2027-deadline-documents-jama11y)).
   No credible free tool. Nopload has tagging; add a checker (reading order,
   headings, alt text, contrast) and on-device alt-text drafts.
5. **Scan cleanup.** Whiten grey backgrounds while keeping photos, deskew,
   auto-rotate by text direction ([HN 47563103](https://news.ycombinator.com/item?id=47563103);
   deskew in Sejda and BentoPDF).
6. **More formats.** From PDF: EPUB, TXT, PNG, TIFF, SVG, HTML, extract
   images. To PDF: EPUB, TXT, Markdown, ODT/RTF, HEIC/WebP/TIFF, SVG. Closes
   BentoPDF's and PDF24's tool-count lead.
7. **Study AI on the device.** Quiz and flashcards from a PDF (Smallpdf has a
   question generator), mind map (UPDF), chat across several PDFs (Acrobat
   Studio, paid).
8. **Portal presets that stay current.** Indian e-Visa 10 to 500 KB, FRRO
   under 200 KB, OCI 1 MB per file, SSC photo 20 to 50 KB and signature 10 to
   20 KB at 140x60 px; photo and signature joined into one image; name and
   date printed on the photo. Limits change, so presets should be editable.
   Sources disagree on some figures; check official pages.
9. **Continuous Bates numbering across files, plus an exhibit index.** Free
   tools number one file at a time; Acrobat Pro is about $240 a year.
10. **Print preflight.** Page boxes and bleed, embedded fonts, colour spaces,
    image resolution, PDF/X. Free tools are shallow; Acrobat Reader can't
    inspect bleed.
11. **Lower priority or poor fit.** E-sign requests to other people (needs a
    server and email), RFC 3161 timestamps (needs a third-party server, which
    breaks the no-upload promise), XFA government forms (no browser engine
    handles them fully), e-invoices (ZUGFeRD; EU niche).

## Recurring pain points, for positioning

1. "Free" that isn't: task caps, trial traps, cancellation fees (Adobe
   $75-156 after a trial,
   [Adobe Community](https://community.adobe.com/questions-6/subject-request-to-cancel-subscription-and-waive-cancellation-fee-hardship-dispute-1614072)).
2. Size, batch and daily limits on free tiers.
3. Uploading sensitive files; trackers in "private" tools (Stirling #3283).
4. Fake text editing.
5. Fake redaction (DOJ Epstein files, December 2025:
   [Mediaite](https://www.mediaite.com/media/news/doj-redactions-of-some-epstein-files-easily-revealed-with-copy-and-paste)).
6. Weak compression and lossy PDF to Word.
7. Missing basics: undo, links lost, encrypted files failing.
