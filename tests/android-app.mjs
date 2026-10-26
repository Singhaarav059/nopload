// The Android app (android/) and the site agree: the package served at
// /app/nopload.apk is signed with the key public/.well-known/assetlinks.json
// names (else the app opens with a browser bar), and it opens the same files
// and takes the same shares as the web app's manifest, at the same routes.
//
//   node tests/android-app.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p));
let failed = 0;
const test = (label, fn) => {
  try {
    const r = fn();
    console.log(`ok    ${label}${r ? `: ${r}` : ""}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${label}: ${e.message}`);
  }
};
const ok = (c, what) => {
  if (!c) throw new Error(what);
};

// The signing certificates of an APK signed with scheme v2 or v3 (the APK
// Signing Block, just before the zip's central directory).
function apkCerts(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  ok(eocd > 0, "not a zip");
  const cd = buf.readUInt32LE(eocd + 16);
  ok(buf.toString("latin1", cd - 16, cd) === "APK Sig Block 42", "no APK Signing Block (not signed with v2/v3)");
  const size = Number(buf.readBigUInt64LE(cd - 24));
  let at = cd - size - 8 + 8;
  const end = cd - 24;
  const certs = [];
  while (at < end) {
    const len = Number(buf.readBigUInt64LE(at));
    const id = buf.readUInt32LE(at + 8);
    if (id === 0x7109871a || id === 0xf05368c0) {
      // signers → signer → signed data → (digests, certificates)
      let p = at + 12;
      p += 4; // signers sequence length
      p += 4; // first signer length
      p += 4; // signed data length
      const digests = buf.readUInt32LE(p);
      p += 4 + digests;
      const certsEnd = p + 4 + buf.readUInt32LE(p);
      p += 4;
      while (p < certsEnd) {
        const n = buf.readUInt32LE(p);
        certs.push(buf.subarray(p + 4, p + 4 + n));
        p += 4 + n;
      }
      break;
    }
    at += 8 + len;
  }
  return certs;
}

const manifest = read("android/app/src/main/AndroidManifest.xml").toString();
const strings = read("android/app/src/main/res/values/strings.xml").toString();
// As Android's resource compiler reads it: \" is a quote, and a bare quote is
// dropped (so JSON in a string resource must escape its quotes).
const string = (name) => {
  const raw = strings.match(new RegExp(`name="${name}"[^>]*>([^<]*)<`))?.[1];
  if (raw === undefined) return undefined;
  ok(!/(^|[^\\])"/.test(raw), `${name} has a bare " (Android drops it): write \\"`);
  return raw.replace(/\\"/g, '"').replace(/&amp;/g, "&");
};
const web = JSON.parse(read("public/manifest.webmanifest"));
const links = JSON.parse(read("public/.well-known/assetlinks.json"));
const gradle = read("android/app/build.gradle.kts").toString();

test("the package served is signed with the key assetlinks.json names", () => {
  const certs = apkCerts(read("public/app/nopload.apk"));
  ok(certs.length, "no certificate");
  const fp = createHash("sha256").update(certs[0]).digest("hex").toUpperCase().match(/../g).join(":");
  const named = links.flatMap((l) => l.target.sha256_cert_fingerprints ?? []);
  ok(named.includes(fp), `signed ${fp}, assetlinks names ${named}`);
  return fp.slice(0, 23) + "…";
});

test("assetlinks.json names this package, and the app trusts this site", () => {
  const id = gradle.match(/applicationId = "([^"]+)"/)?.[1];
  ok(links.some((l) => l.target.package_name === id && l.relation.includes("delegate_permission/common.handle_all_urls")), `package ${id}`);
  const site = JSON.parse(string("asset_statements"))[0].target.site;
  ok(string("launch_url").startsWith(site) && string("file_url").startsWith(site), `site ${site}`);
  return `${id} ↔ ${site}`;
});

test("Open with: the same file types as the web app, to the same route", () => {
  const types = new Set(Object.keys(web.file_handlers[0].accept));
  const viewFilter = manifest.split("<intent-filter").find((f) => f.includes('scheme="content"'));
  ok(viewFilter, "no content:// VIEW filter");
  const mimes = [...viewFilter.matchAll(/mimeType="([^"]+)"/g)].map((m) => m[1]);
  for (const t of types) ok(mimes.includes(t), `${t} missing from the Android filter`);
  ok(new URL(string("file_url")).pathname === web.file_handlers[0].action, `${string("file_url")} vs ${web.file_handlers[0].action}`);
  return mimes.join(", ");
});

test("Share: the same target as the web app's share_target", () => {
  const share = JSON.parse(string("share_target"));
  ok(share.action === web.share_target.action && share.method === web.share_target.method && share.enctype === web.share_target.enctype, "action, method or enctype differ");
  ok(share.params.files[0].name === web.share_target.params.files[0].name, "file field differs");
  ok(/android\.intent\.action\.SEND_MULTIPLE/.test(manifest), "several files can't be shared");
  return `${share.method} ${share.action}`;
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
