// Nopload for Android: a Trusted Web Activity. The app is the website
// (https://nopload.pages.dev) shown full screen by Chrome; this shell only
// adds what a web app can't declare on Android: an entry under "Open with"
// for PDFs, images and Word files, and the share sheet, both handed to the
// site (launchQueue at /en/open, and the /share POST). See README.md.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "nopload"
include(":app")
