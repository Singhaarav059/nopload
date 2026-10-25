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

There is no app code: the whole app is `LauncherActivity` from Google's
[android-browser-helper](https://github.com/GoogleChrome/android-browser-helper),
configured in `app/src/main/AndroidManifest.xml`. PDF work stays in the site;
every deploy of the site updates the app.

## Full screen needs Digital Asset Links

`public/.well-known/assetlinks.json` names this package and the SHA-256 of the
key it's signed with. If they don't match (a different key, or the site on
another domain), Chrome still opens the app but with a browser bar on top.

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
