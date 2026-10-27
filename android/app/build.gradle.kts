plugins {
    id("com.android.application")
}

// The signing key stays out of the repository: its path and passwords come
// from the environment (NOPLOAD_KEYSTORE, NOPLOAD_KEYSTORE_PASSWORD,
// NOPLOAD_KEY_ALIAS). Its SHA-256 fingerprint is in
// public/.well-known/assetlinks.json, which verifies the app for links to the site.
val keystore = System.getenv("NOPLOAD_KEYSTORE")

android {
    namespace = "dev.pages.nopload"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.pages.nopload"
        minSdk = 24
        targetSdk = 36
        versionCode = 8
        versionName = "1.7"
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

    buildFeatures {
        buildConfig = true
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.core:core:1.17.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.16")
    testImplementation("androidx.test:core:1.6.1")
}
