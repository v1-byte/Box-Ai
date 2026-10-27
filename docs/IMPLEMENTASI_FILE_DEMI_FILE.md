# Rencana Implementasi File demi File

**Aturan:** jangan mulai milestone berikutnya sebelum milestone aktif lulus tes. Daftar ini adalah target file; file-file ini belum ada di ZIP asal kecuali disebutkan sebagai file UI/dokumen.

## Milestone 0 — Baseline dan perlindungan UI
File asal yang dilindungi:
- `BoxAI-Android/app/src/main/assets/www/index.html`
- `BoxAI-Android/app/src/main/assets/www/styles.css`
- `BoxAI-Android/app/src/main/assets/www/app.js`
- `BoxAI-Android/app/src/main/assets/www/assets/logo.webp`
- `BoxAI-Android/app/src/main/assets/www/assets/logo-128.webp`
- `BoxAI-Android/app/src/main/assets/www/assets/logo-64.webp`

Tugas:
1. Catat SHA-256 tiap file UI.
2. Simpan screenshot semua layar dan dialog utama.
3. Jalankan pemeriksaan sintaks JavaScript.
4. Catat fitur UI yang memanggil `window.BoxNative`.
5. Jangan edit file UI dalam milestone ini.

Lulus bila file UI sama persis dan baseline tercatat.

## Milestone 1 — Fondasi Android
Target:
- `BoxAI-Android/settings.gradle.kts`
- `BoxAI-Android/build.gradle.kts`
- `BoxAI-Android/gradle.properties`
- `BoxAI-Android/gradlew` dan `gradlew.bat`
- `BoxAI-Android/gradle/wrapper/`
- `BoxAI-Android/app/build.gradle.kts`
- `BoxAI-Android/app/src/main/AndroidManifest.xml`
- `BoxAI-Android/app/src/main/java/com/boxai/app/MainActivity.kt`
- `BoxAI-Android/app/src/main/java/com/boxai/app/WebViewConfig.kt`

Tugas:
- Pilih versi JDK, Gradle, Android Gradle Plugin, SDK, dan NDK yang kompatibel; pin versinya.
- Muat UI dari `file:///android_asset/www/index.html`.
- Batasi navigasi WebView ke aset lokal atau host yang disetujui.
- Tangani tombol kembali, lifecycle, ukuran layar, keyboard, dan error pemuatan.
- Jangan membuat native bridge palsu hanya untuk menghilangkan pesan error.

Tes:
- Build debug APK.
- Instal dan buka pada perangkat Android.
- Pastikan semua layar UI tampil tanpa perubahan desain.
- Pastikan tidak ada crash saat pindah tab, membuka keyboard, atau kembali.

## Milestone 2 — Native bridge dan penyimpanan
Target:
- `BoxAI-Android/app/src/main/java/com/boxai/app/BoxNativeBridge.kt`
- `.../SecureStorage.kt`
- `.../WorkspaceManager.kt`
- `.../DeviceMonitor.kt`
- `.../DownloadManager.kt`
- `BoxAI-Android/app/src/test/` atau `src/androidTest/`

Tugas:
- Implementasikan kontrak pada `NATIVE_BRIDGE.md`.
- Validasi parameter, ukuran data, izin, path, dan status hasil.
- Gunakan callback JavaScript untuk operasi asynchronous yang lama.
- Simpan rahasia terpisah dari preferensi biasa.
- Terapkan izin folder melalui Storage Access Framework jika dibutuhkan.
- Operasi file/unduhan tidak boleh berjalan di main thread.

Tes:
- Uji metode yang berhasil, input salah, izin ditolak, file tidak ditemukan, dan jaringan putus.
- Pastikan callback sukses/error tidak membuat UI macet.
- Pastikan token tidak tertulis ke log.

## Milestone 3 — Runtime GGUF
Target:
- `BoxAI-Android/app/src/main/java/com/boxai/app/LlamaEngine.kt`
- `BoxAI-Android/app/src/main/java/com/boxai/app/ModelManager.kt`
- `BoxAI-Android/app/src/main/cpp/CMakeLists.txt`
- `BoxAI-Android/app/src/main/cpp/boxai_jni.cpp`
- `third_party/llama.cpp/` atau dependensi runtime yang dipatok

Tugas:
- Pilih runtime kompatibel GGUF dan catat versi/commit serta lisensinya.
- Build native untuk ABI target.
- Muat satu model kecil yang lisensinya sesuai.
- Jalankan inferensi di background.
- Streaming token, stop, unload, reload, dan error.
- Tangani memori rendah, file rusak, model tidak didukung, dan suhu tinggi.
- Terapkan chat template yang cocok dengan model.

Tes penerimaan:
1. Dengan internet mati, model terunduh dapat dimuat.
2. Model menjawab prompt sederhana.
3. Token tampil bertahap.
4. Tombol stop menghentikan generasi.
5. Model bisa di-unload dan dimuat ulang.
6. Model yang rusak menghasilkan error, bukan crash.
7. Ukuran konteks dan parameter generasi benar-benar diterapkan.

## Milestone 4 — Model dan unduhan
Target:
- `ModelManager.kt`
- `DownloadManager.kt`
- sumber model dan metadata sesuai UI
- unit/instrumentation tests

Tugas:
- Daftar lokal, pemindaian folder, unduh, pause/resume/cancel, verifikasi selesai, rename/delete.
- Terapkan timeout, ukuran maksimum yang wajar, HTTPS, dan pesan error.
- Jangan menganggap unduhan selesai hanya karena koneksi berakhir.
- Tangani URL yang berubah atau token akses kedaluwarsa.

Tes:
- Unduhan sukses, jeda/lanjut, batal, putus jaringan, ruang disk penuh, token invalid, dan file parsial.

## Milestone 5 — Integrasi fitur UI
Target:
- `BoxNativeBridge.kt`, `SecureStorage.kt`, `WorkspaceManager.kt`, `DeviceMonitor.kt`
- file UI hanya diubah bila tes membuktikan ada masalah nyata
- `docs/FEATURES_CHECKLIST.md`

Tugas:
- Sambungkan setiap tombol ke fungsi nyata.
- Chat, Pal, Talents, connector, editor, pembersih, benchmark, termal, dan update diuji satu per satu.
- Jika fitur tidak dapat didukung, ubah status menjadi TERBATAS/TIDAK DIDUKUNG dan jelaskan; jangan menampilkan sukses palsu.

Tes:
- Jalankan seluruh checklist dan dokumentasikan bukti hasilnya.

## Milestone 6 — GitHub Actions
Target:
- `.github/workflows/android-build.yml`
- `scripts/verify-ui.sh`
- `docs/BUILD-APK.md`
- `docs/TESTING.md`

Pipeline yang diharapkan:
1. Checkout.
2. Siapkan JDK/Android SDK/NDK yang dipatok.
3. Verifikasi UI dan JavaScript.
4. Jalankan unit test.
5. Build debug APK.
6. Simpan APK sebagai artifact.
7. Untuk release, gunakan signing secrets dari GitHub Secrets; jangan pernah commit secret.

Tes:
- Jalankan workflow dari commit bersih.
- Pastikan artifact APK dapat diunduh, dipasang, dan dibuka.
- Build sukses saja tidak membuktikan inferensi GGUF bekerja; tes perangkat tetap wajib.

## Larangan
- Jangan menimpa UI dengan desain baru.
- Jangan menambahkan token/API key ke source.
- Jangan membuat runtime tiruan atau jawaban hard-coded untuk mengklaim AI bekerja.
- Jangan menandai semua fitur aktif hanya karena tombolnya terlihat.
- Jangan melanjutkan ke milestone berikutnya jika milestone aktif belum lulus.
