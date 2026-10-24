# Box AI - Android

Shell Android (WebView, offline) untuk Box AI: https://github.com/v1-byte/Box-Ai
UI: Chat, Models, Pals, Settings, Pencari file, Pembersih. File web ada di `app/src/main/assets/www`.

## Build APK
- Android Studio: buka folder ini, tunggu Gradle sync, Build > Build APK(s).
- GitHub Actions: push ke repo, tab Actions > "Build APK", unduh artifact `BoxAI-debug-apk`.
- CLI (JDK 17, Android SDK, Gradle 8.9): `gradle assembleDebug`

## Fitur
- **Models:** cari model GGUF di Hugging Face (tab Models > HF Hub), unduh nyata lewat DownloadManager ke folder aplikasi. Token HF untuk model gated: Settings > Token Hugging Face.
- **Talents:** calculate, datetime, render_html (Settings > Talents). Di chat: `/calc 2+2`, `/waktu`, `/html <kode>`.
- **Benchmark:** CPU, memori, info perangkat, dan kecocokan model dengan RAM (Settings > Benchmark).
- **Pembersih dan Pencari:** memakai ukuran dan file nyata dari perangkat.
- **Mesin LLM:** hook ada di `Bridge.engineAvailable()` dan `Bridge.generate()` (MainActivity.kt). Pasang llama.cpp (JNI) lalu ubah `engineAvailable()` jadi true agar chat dan benchmark token/detik aktif.
- **Pencarian web:** tombol globe di samping kolom pesan (on/off, mati secara bawaan). Saat aktif, tiap pertanyaan dicari lewat DuckDuckGo (tanpa API key), hasilnya disisipkan ke konteks model dan sumbernya ditampilkan di jawaban. Perintah `/cari <kata>` juga tersedia.
