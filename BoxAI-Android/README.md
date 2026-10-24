# Box AI - Android

Shell Android (WebView, offline) untuk Box AI: https://github.com/v1-byte/Box-Ai  
**Tampilan utama** APK. UI: Chat, Models, Pals, Settings, Pencari file, Pembersih.  
File web ada di `app/src/main/assets/www`.

## Build APK
- Android Studio: buka folder ini, tunggu Gradle sync, Build > Build APK(s).
- GitHub Actions: push ke `main` atau buat Release → artifact `BoxAI-v*-apk`.
- CLI (JDK 17, Android SDK, Gradle 8.9): `cd BoxAI-Android && gradle assembleDebug`

## Fitur
- **Models:** cari model GGUF di Hugging Face (tab Models > HF Hub), unduh nyata lewat DownloadManager. Token HF: Settings > Token Hugging Face.
- **Mesin LLM (aktif):** llama.cpp via `llama-android` 0.1.1 (prebuilt arm64-v8a).  
  `engineAvailable()` = true · model di-cache · streaming token ke JS.
- **Talents:** `/calc`, `/waktu`, `/html` (Settings > Talents).
- **Benchmark, Pembersih, Pencari file, Web search (DuckDuckGo).**

## UI / kompatibilitas HP (v2.2.0)
- Edge-to-edge + `viewport-fit=cover`
- Safe-area hanya di CSS (`env(safe-area-inset-*)`) — **tanpa double padding** native
- Keyboard: native IME height → CSS `--kb` + sembunyikan tabbar
- `100dvh`, overscroll terkunci, font 16px di input (anti-zoom iOS)
- Cutout / notch / gesture nav didukung
- Portrait preferred, largeHeap untuk model besar

## Model disarankan
| Model | Ukuran Q4 | Catatan |
|-------|-----------|---------|
| Qwen2.5 0.5B | ~400 MB | tercepat |
| Gemma 2 2B | ~1.6 GB | seimbang |
| Llama 3.2 3B | ~2.0 GB | chat bagus |

Unduh lewat **Models → HF Hub**.
