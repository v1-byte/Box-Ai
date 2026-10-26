plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.boxai.app"
    compileSdk = 34

    signingConfigs {
        create("stable") {
            val keystorePath = providers.environmentVariable("BOXAI_RELEASE_KEYSTORE").orNull
            val storePass = providers.environmentVariable("BOXAI_RELEASE_STORE_PASSWORD").orNull
            val keyAliasEnv = providers.environmentVariable("BOXAI_RELEASE_KEY_ALIAS").orNull
            val keyPass = providers.environmentVariable("BOXAI_RELEASE_KEY_PASSWORD").orNull
            if (!keystorePath.isNullOrBlank() && !storePass.isNullOrBlank() &&
                !keyAliasEnv.isNullOrBlank() && !keyPass.isNullOrBlank()) {
                storeFile = file(keystorePath)
                storePassword = storePass
                keyAlias = keyAliasEnv
                keyPassword = keyPass
            }
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    defaultConfig {
        applicationId = "com.boxai.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 34
        versionName = "2.2.30"
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a")
        }
    }

    buildTypes {
        debug {
        }
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            if (signingConfigs.getByName("stable").storeFile != null) {
                signingConfig = signingConfigs.getByName("stable")
            }
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.documentfile:documentfile:1.0.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("dev.ffmpegkit-maintained:llama-android:0.1.1")
}
