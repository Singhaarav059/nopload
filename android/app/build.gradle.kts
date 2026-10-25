plugins {
    id("com.android.application")
}

// The signing key stays out of the repository: its path and passwords come
// from the environment (NOPLOAD_KEYSTORE, NOPLOAD_KEYSTORE_PASSWORD,
// NOPLOAD_KEY_ALIAS). Its SHA-256 fingerprint is in
// public/.well-known/assetlinks.json, which is what lets the site open
// full screen, without a browser bar.
val keystore = System.getenv("NOPLOAD_KEYSTORE")

android {
    namespace = "dev.pages.nopload"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.pages.nopload"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("NOPLOAD_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("NOPLOAD_KEY_ALIAS") ?: "nopload"
                keyPassword = System.getenv("NOPLOAD_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystore != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
}
