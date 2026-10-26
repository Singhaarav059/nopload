# Dependency advisories

What `npm audit` reports for the shipped dependencies, whether our code
can reach the affected part, and what we did about it. Update this file
when the audit changes.

Last checked: 2026-10-26 (finding R08 of the external audit).

## Summary

Before: 5 packages (3 high, 2 moderate). After: 1 (high, `node-forge`,
no fixed release exists and the affected code isn't used).

| Package | Advisory | Path | Reachable | Action |
| --- | --- | --- | --- | --- |
| `image-size` 1.2.1 | GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr | `pptxgenjs` → `image-size` | No | Override to 2.0.4 |
| `pptxgenjs` 4.0.1 | inherits from `image-size` | direct | n/a | Cleared by the override |
| `uuid` 8.3.2 | GHSA-w5hq-g745-h8pq | `exceljs` → `uuid` | No | Override to 11.1.1 |
| `exceljs` 4.4.0 | inherits from `uuid` | direct | n/a | Cleared by the override |
| `node-forge` 1.4.0 | GHSA-86w9-cpqp-85rv | direct | No | Kept, no fixed release |

npm's own suggested fixes were downgrades (`pptxgenjs` 4.0.0, `exceljs`
3.4.0). We didn't take them.

## image-size (via pptxgenjs)

The advisories: the JXL, HEIF and ICNS parsers can loop forever on a
crafted image. Fixed in 2.0.3.

Not reachable. `pptxgenjs` lists `image-size` as a dependency but never
loads it. Its built files (`dist/pptxgen.cjs.js`, `dist/pptxgen.es.js`,
the bundles) contain no `require("image-size")`; the only image-size code
is a commented-out `getSizeFromImage` that requires a different package
(`sizeof`). Its `package.json` also maps `image-size` to `false` for
browser builds. Nothing else in `node_modules` imports it (Next.js has its
own compiled copy).

We use `pptxgenjs` only in the browser, for PDF to PowerPoint
(`src/lib/pdf/convert.ts:558`, a `"use client"` file), and in test
fixtures (`tests/e2e-office.mjs`, `tests/libreoffice.mjs`). No server
route imports it.

Fix: `overrides.pptxgenjs.image-size` set to `^2.0.3` in `package.json`.
The lockfile now has 2.0.4, and `queue` (an image-size 1.x dependency)
is gone. Since no code calls image-size, the 2.x API change can't break
anything.

## uuid (via exceljs)

The advisory: `v3`, `v5` and `v6` don't check bounds when you pass your
own output buffer. Fixed in 11.1.1.

Not reachable. `exceljs` calls only `v4()`, with no arguments, when it
writes a conditional formatting rule
(`node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js:43`
and `:77`). It never passes a buffer and never calls v3, v5 or v6.

Where we use `exceljs`:

- Browser: PDF to Excel writes a workbook (`src/lib/pdf/convert.ts:338`,
  `:450`); Office to PDF reads one (`src/lib/office/html.ts:85`).
- Server build: `/api/convert/office` reads uploaded spreadsheets
  (`src/app/api/convert/office/route.server.ts:21` →
  `src/lib/server/office.ts:81` → `src/lib/office/html.ts:85`). Reading
  doesn't call uuid at all.

Fix: `overrides.exceljs.uuid` set to `^11.1.1`. uuid 11 still ships a
CommonJS build (`exports["."].node.require`), and `v4` is still a named
export, so `require('uuid').v4` in exceljs keeps working. uuid 12 and
later are ESM only, which is why the override stops at 11.

Note: the browser build uses `exceljs/dist/exceljs.min.js` (its
`browser` field), which bundles its own uuid 8 copy. The override can't
change that file. The same reasoning applies: the bundle calls only
`uuidv4()` with no buffer (`dist/exceljs.js:9287`, `:9315`).

## node-forge

The advisory: RSA PKCS#1 v1.5 signature verification accepts extra
nested DigestAlgorithm elements, so a forged signature can pass. Every
version up to 1.4.0 is affected and there is no fixed release (1.4.0 is
the latest on npm as of 2026-10-26).

Not reachable. The app uses forge in one file, `src/lib/pdf/p12.ts`, to
open a .p12/.pfx file for signing:

- `forge.asn1.fromDer`, `forge.pkcs12.pkcs12FromAsn1` (`p12.ts:56`,
  `:64`): parse and decrypt the file. The PKCS#12 integrity check is an
  HMAC (`node-forge/lib/pkcs12.js:465`), not an RSA signature.
- `forge.pki.certificateToAsn1`, `privateKeyToAsn1`, `wrapRsaPrivateKey`,
  `asn1.toDer` (`p12.ts:79`, `:86`, `:30`): convert the key and
  certificates to DER for WebCrypto.

None of these call `publicKey.verify`, `cert.verify`,
`pki.verifyCertificateChain` or `csr.verify` (the RSA verify paths, in
`node-forge/lib/x509.js:782`, `:1157`, `:1824`, `:2882`). A grep of
`src/`, `functions/`, `scripts/` and `tests/` finds no call to any of
them.

Signatures are checked elsewhere, without forge:

- Matching the key to its certificate: WebCrypto (`p12.ts:104`).
- Verify signature tool: PKI.js `SignedData.verify` on WebCrypto
  (`src/lib/pdf/sign.ts:519`, `:529`).

`tests/pades.mjs:62-65` uses forge to build a test .p12 file; it doesn't
verify anything with it.

Action: kept at 1.4.0. Upgrade when a fixed release appears. If we ever
need RSA verification, use WebCrypto or PKI.js, not forge.

## Regression checks

Run after the lockfile change (all pass):

- `npm audit`: 1 high (`node-forge`), was 3 high and 2 moderate.
- `npx tsc --noEmit -p .`
- `npx eslint src`
- `npm run test:pades`, 24 checks (opens .p12 files through forge,
  signs and verifies)
- `npm run test:ppt`, 17 checks (PDF to PowerPoint through pptxgenjs)
- `npm run test:sheets` (7) and `npm run test:tables` (11): exceljs
  read and write
- `require("uuid").v4()` from inside `node_modules/exceljs` returns a
  valid v4 id with uuid 11.1.1.
