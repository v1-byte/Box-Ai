# Box AI - Android

Shell Android (WebView, offline) untuk Box AI: https://github.com/v1-byte/Box-Ai  
**Tampilan utama** APK. UI: Chat, Models, Pals, Settings, Pencari file, Pembersih.  
File web ada di `app/src/main/assets/www`.

## Build APK
- Android Studio: buka folder ini, tunggu Gradle sync, Build > Build APK(s).
- GitHub Actions: push ke `main` menghasilkan artifact; tag `v*` menerbitkan release setelah secret signing dikonfigurasi.
- CLI (JDK 17, Android SDK): `cd BoxAI-Android && ./gradlew assembleDebug`
- Release signing tidak disimpan di repository. Set `BOXAI_RELEASE_KEYSTORE`, `BOXAI_RELEASE_STORE_PASSWORD`, `BOXAI_RELEASE_KEY_ALIAS`, dan `BOXAI_RELEASE_KEY_PASSWORD` hanya di environment/CI secret.

## Fitur
- **Models:** cari model GGUF di Hugging Face (tab Models > HF Hub), unduh nyata lewat DownloadManager. Token HF: Settings > Token Hugging Face.
- **Mesin LLM (aktif):** llama.cpp via `llama-android` 0.1.1 (prebuilt arm64-v8a).  
  `engineAvailable()` = true · model di-cache · streaming token ke JS.
- **Talents:** `/calc`, `/waktu`, `/html` (Settings > Talents).
- **Benchmark, Pembersih, Pencari file, Web search (DuckDuckGo).**

## UI / kompatibilitas HP (v2.2.0)
- WebView memakai `WebViewAssetLoader`, CSP, Safe Browsing, dan tanpa akses `file://`.
- Token connector disimpan AES-GCM Android Keystore, bukan localStorage.
- Akses folder bersama memakai Storage Access Framework (SAF), tanpa `MANAGE_EXTERNAL_STORAGE`.
- Edge-to-edge + `viewport-fit=cover`
- Safe-area hanya di CSS (`env(safe-area-inset-*)`) — **tanpa double padding** native
- Keyboard: native IME height → CSS `--kb` + sembunyikan tabbar
- `100dvh`, overscroll terkunci, font 16px di input (anti-zoom iOS)
- Cutout / notch / gesture nav didukung
- Portrait preferred; model besar memakai folder app-scoped dan cleanup terkontrol

## Model disarankan
| Model | Ukuran Q4 | Catatan |
|-------|-----------|---------|
| Qwen2.5 0.5B | ~400 MB | tercepat |
| Gemma 2 2B | ~1.6 GB | seimbang |
| Llama 3.2 3B | ~2.0 GB | chat bagus |

Unduh lewat **Models → HF Hub**.
