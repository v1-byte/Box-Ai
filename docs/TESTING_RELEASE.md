# Pengujian dan Rilis Box AI

## Jenis pengujian

### Pemeriksaan statis
- Sintaks JavaScript.
- Konfigurasi Gradle dan versi dependency.
- Pemeriksaan secret yang tidak sengaja masuk ke repo.
- Pemeriksaan lisensi dependency/runtime.
- Verifikasi hash file UI.

### Unit test
- Validasi input bridge.
- Penyusunan prompt dan parameter generasi.
- Parser argumen Talents.
- Validasi nama/path file.
- Perhitungan progres dan state unduhan.
- Penyimpanan dan pemuatan preferensi.

### Instrumentation/device test
- WebView membuka UI.
- Izin storage/folder.
- Model GGUF dimuat dan dilepas.
- Generasi, streaming, stop, dan error.
- Lifecycle saat aplikasi diminimalkan/dibuka kembali.
- Perangkat dengan RAM rendah dan ruang disk terbatas.
- Jaringan dimatikan untuk memvalidasi mode on-device.

## Matriks perangkat minimum
Catat untuk setiap perangkat:
- Merek/model dan versi Android.
- ABI CPU.
- RAM total dan RAM tersedia sebelum tes.
- Ruang kosong.
- Model GGUF dan quantization.
- Ukuran konteks.
- Waktu muat model.
- Kecepatan generasi bila tersedia.
- Suhu/status termal sebelum dan sesudah.
- Hasil: lulus/gagal dan log yang sudah disanitasi.

## Gerbang rilis
Jangan rilis bila:
- Build gagal atau artifact tidak ada.
- APK crash pada startup.
- UI berubah tanpa persetujuan.
- Model lokal tidak dapat menjawab saat offline.
- Stop/unload model tidak bekerja.
- Token muncul dalam log.
- Mode on-device mengirim prompt ke server tanpa izin.
- Ada fitur penting yang dilaporkan aktif tetapi belum diuji.

## GitHub Actions
- Workflow menggunakan versi toolchain yang dipatok.
- Jangan menyimpan token/keystore di repository.
- Gunakan GitHub Secrets untuk signing.
- Simpan APK debug sebagai artifact untuk pengujian.
- Signing release dilakukan setelah tes debug lulus.
- APK dari CI harus dipasang dan diuji di perangkat; build hijau bukan bukti semua fitur berfungsi.

## Format laporan milestone
- Milestone:
- Commit:
- File berubah:
- File UI berubah? Jika ya, alasan:
- Build:
- Tes yang dijalankan:
- Hasil:
- Bukti/log yang sudah disanitasi:
- Fitur yang masih terbatas:
- Keputusan: LANJUT / PERBAIKI DULU
