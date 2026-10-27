# Nopload for Android

The website in the app's own web view (`WebApp.java`): full screen, with a
launch screen until the first page has drawn, and never a browser bar.
(Chrome, which earlier versions handed the site to, shows a bar whenever it
hasn't confirmed the site belongs to the app, so the app no longer uses it.)
PDF work stays in the site; every deploy of the site updates the app.

What a browser would do for the site, the app does:

- **Open with**: PDFs, pictures and Word files from any app (Files, Gmail,
  WhatsApp, Drive…) open in Nopload, on `/en/open`, which takes them through
  `window.NoploadApp` (`src/components/OpenFiles.tsx`). One PDF goes straight
  to the viewer.
- **Share**: files shared to Nopload arrive the same way.
- **Links** to nopload.pages.dev open in the app; links to other sites open in
  the browser.
- **Files**: picking files, and saving results to Downloads/Nopload.
- **Camera** for Scan to PDF, asked for when the scanner starts.
- **Read aloud** with Android's voices, and **printing** (and Save as PDF)
  through Android's print dialog (`Native.java`, which stands in for the
  browser's `speechSynthesis` and `print()`).

`Launcher.java` takes the icon, Open with, the share sheet and links, and
after a crash shows what went wrong (`CrashActivity.java`) with Copy and Share.

`public/.well-known/assetlinks.json` names this package and the SHA-256 of the
key it's signed with, which verifies the app for links to the site.

## Build

Needs JDK 17+, Gradle 8.13+ and the Android SDK (platform 36). In `local.properties`
set `sdk.dir=/path/to/android-sdk`, then:

```sh
NOPLOAD_KEYSTORE=/path/to/nopload-release.jks \
NOPLOAD_KEYSTORE_PASSWORD=… \
gradle assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../public/app/nopload.apk
```

The keystore is **not** in the repository. Keep it safe: Android only installs an
update signed with the same key, and `assetlinks.json` names its fingerprint.
For CI, store it as repository secrets `ANDROID_KEYSTORE_BASE64` (the file,
base64) and `ANDROID_KEYSTORE_PASSWORD`; `.github/workflows/android.yml` then
builds a signed package on every change here.

## Publishing a new version

Raise `versionCode` (and `versionName`) in `app/build.gradle.kts`, build, and
copy the package to `public/app/nopload.apk`. The site serves it at
`/app/nopload.apk`, offered on Android in the install sheet and in Settings.
The same package can go to Google Play later without changes.
