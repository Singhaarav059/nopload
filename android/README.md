# Nopload for Android

A Trusted Web Activity: the app *is* the website, shown full screen by Chrome.
It exists only for what an installed web app can't declare on Android:

- **Open with**: PDFs, pictures and Word files from any app (Files, Gmail,
  WhatsApp, Drive…) open in Nopload. Android hands the file to Chrome, which
  gives it to the site through `launchQueue` at `/en/open`, the same route
  "Open with" uses on a computer. One PDF goes straight to the viewer.
- **Share**: files shared to Nopload are posted to `/share`, the manifest's
  `share_target`, handled by the service worker as for the installed web app.
- **Links** to nopload.pages.dev open in the app.

The app is `LauncherActivity` from Google's
[android-browser-helper](https://github.com/GoogleChrome/android-browser-helper),
configured in `app/src/main/AndroidManifest.xml`, with a little code of its
own. PDF work stays in the site; every deploy of the site updates the app.

## No browser bar, ever

Chrome shows the site with a browser bar on top until it has confirmed that
the site and the app belong together (Digital Asset Links, below): on a first
launch, on a slow or missing connection, after a Chrome update. So the app
never hands over before that (`Launcher.java`): it shows its launch screen
and asks Chrome to confirm, in the background. Confirmed, the site opens full
screen in Chrome. Not confirmed, no answer within 4 seconds, or no browser
that can show it full screen, it opens in the app's own web view
(`WebApp.java`) instead, with the launch screen kept until the first page has
drawn. The web view does what Chrome would: picking files, saving results to
Downloads/Nopload, the camera for the scanner, other sites in the browser, and
"Open with" and the share sheet, whose files `/en/open` takes through
`window.NoploadApp` (`src/components/OpenFiles.tsx`). Read aloud uses the
browser's voices, which a web view doesn't have.

## Full screen needs Digital Asset Links

`public/.well-known/assetlinks.json` names this package and the SHA-256 of the
key it's signed with. If they don't match (a different key, or the site on
another domain), Chrome can't confirm the app, and the site always opens in the
app's web view.

Moving to a custom domain: add it to `launch_url`, `file_url`,
`asset_statements` and the https intent filter, serve the same
`assetlinks.json` there, and publish a new version.

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
