# Box AI Android — tampilan & app utama

**Version:** 0.1.0 · **applicationId:** `com.boxai.app`

## Fitur UI (assets/www)
- Chat on-device UI (history, attach file/image, pals, model aktif)
- Models: daftar, detail, install/uninstall simulasi, rekomendasi
- Pals: default + custom
- Settings: tema, haptics, generasi, privacy toggles, about
- Files: browser file lokal simulasi + catatan

## Build
```bash
cd BoxAI-Android
gradle assembleDebug   # atau buka di Android Studio
# APK: app/build/outputs/apk/debug/app-debug.apk
```

CI: workflow `Build Box AI APK` di GitHub Actions mengunggah artifact APK.
