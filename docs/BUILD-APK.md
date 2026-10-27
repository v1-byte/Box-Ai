# Panduan Build APK lewat GitHub Actions

Dokumen ini menjelaskan target proses build; workflow belum disertakan atau dijalankan oleh ZIP UI asal.

## Persiapan
1. Lengkapi struktur proyek Android dan Gradle.
2. Pilih JDK, Android Gradle Plugin, Gradle, SDK, NDK, dan CMake yang saling kompatibel.
3. Pin versi dependency dan runtime native.
4. Tambahkan workflow `.github/workflows/android-build.yml`.
5. Jangan menyimpan model GGUF besar di repository kecuali alasan dan lisensinya jelas.

## Workflow minimum
1. Checkout repository.
2. Siapkan JDK.
3. Siapkan Android SDK/NDK yang dibutuhkan.
4. Jalankan verifikasi UI.
5. Jalankan unit test.
6. Jalankan `assembleDebug`.
7. Unggah APK sebagai artifact.
8. Jika release ditambahkan, signing memakai GitHub Secrets dan hanya dijalankan pada jalur rilis yang disengaja.

## Rahasia
- Simpan signing key dan password sebagai GitHub Secrets.
- Jangan tulis token GitHub/HF/Cloudflare ke file konfigurasi yang dikomit.
- Jangan cetak nilai secret ke log.
- Jika secret pernah masuk repo atau log, cabut/rotasi token tersebut.

## Hasil yang wajib dicatat
- Commit SHA.
- Versi JDK/Gradle/AGP/SDK/NDK.
- Status pemeriksaan UI dan tes.
- Nama artifact APK.
- Apakah APK sudah dipasang dan diuji di perangkat.
- Daftar batasan yang belum diselesaikan.
