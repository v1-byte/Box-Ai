# Box AI — Android (tampilan utama)

App Android native (Kotlin + WebView) yang memuat **UI utama Box AI**.

## Package
`com.boxai.app`

## Build APK
```bash
cd BoxAI-Android
# butuh Android SDK + JDK 17
./gradlew assembleDebug
# output: app/build/outputs/apk/debug/app-debug.apk
```

Atau pakai GitHub Actions: `.github/workflows/build-apk.yml`

## UI
File UI ada di `app/src/main/assets/www/` (HTML/CSS/JS + logo).
Ini adalah **tampilan utama** yang ditampilkan saat app dibuka.
