# Box AI - Android

Shell Android (WebView, offline) untuk Box AI: https://github.com/v1-byte/Box-Ai  
**Tampilan utama** APK. UI: Chat, Models, Pals, Settings, Pencari file, Pembersih.  
File web ada di `app/src/main/assets/www`.

## Build APK
- Android Studio: buka folder ini, tunggu Gradle sync, Build > Build APK(s).
- GitHub Actions: push ke repo, tab Actions > "Build Box AI APK", unduh artifact.
- CLI (JDK 17, Android SDK, Gradle 8.9): `gradle assembleDebug`

## Fitur
- **Models:** cari model GGUF di Hugging Face (tab Models > HF Hub), unduh nyata lewat DownloadManager ke folder aplikasi. Token HF untuk model gated: Settings > Token Hugging Face.
- **Mesin LLM (aktif):** llama.cpp via library `llama-android` 0.1.1 (prebuilt, arm64-v8a, tanpa NDK).  
  - `engineAvailable()` → `true`  
  - `generate(json)` → load GGUF, chat completion, streaming token ke `window.BoxEngine`  
  - Model di-cache di memori sampai diganti / `unloadModel()`
- **Talents:** calculate, datetime, render_html (Settings > Talents). Di chat: `/calc 2+2`, `/waktu`, `/html <kode>`.
- **Benchmark:** CPU, memori, info perangkat, dan kecocokan model dengan RAM (Settings > Benchmark).
- **Pembersih dan Pencari:** memakai ukuran dan file nyata dari perangkat.
- **Pencarian web:** tombol globe di samping kolom pesan (on/off, mati secara bawaan). Saat aktif, tiap pertanyaan dicari lewat DuckDuckGo (tanpa API key), hasilnya disisipkan ke konteks model dan sumbernya ditampilkan di jawaban. Perintah `/cari <kata>` juga tersedia.

## Model yang disarankan
| Model | Ukuran (Q4_K_M) | Catatan |
|-------|------------------|---------|
| Qwen2.5 0.5B | ~400 MB | paling cepat |
| Gemma 2 2B | ~1.6 GB | seimbang |
| Llama 3.2 3B | ~2.0 GB | chat bagus |
| Phi-3.5 Mini | ~2.2 GB | reasoning |

Unduh lewat tab **Models → HF Hub** di dalam app.

## Catatan teknis
- ABI: **arm64-v8a** saja (mayoritas device modern).
- Free edition llama-android: completion + embeddings (tanpa real streaming / Vulkan). Streaming disimulasikan di Bridge agar UX tetap bagus.
- Min SDK 24, target 34.
