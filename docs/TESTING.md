# Pengujian Box AI

Ringkasan cara menjalankan tes. Aturan umum ada di [`TESTING_RELEASE.md`](TESTING_RELEASE.md).

## Otomatis (CI)
- `scripts/verify-ui.sh` — hash SHA-256 file UI terhadap `scripts/ui.sha256`, `node --check app.js`, pemeriksaan pola token.
- `gradle testDebugUnitTest` — unit test JVM di `BoxAI-Android/app/src/test/` (validasi nama model, kunci rahasia,
  deteksi file teks, penolakan unduhan non-HTTPS).
- `gradle assembleDebug` — membangun APK debug (termasuk kompilasi llama.cpp lewat NDK).

## Wajib manual di perangkat (build hijau bukan bukti)
1. Pasang APK debug, buka, semua tab tampil. Bandingkan dengan screenshot baseline.
2. Unduh/salin satu model GGUF kecil (mis. Q4 ≤ 1 GB) → ketuk **Gunakan** → toast "siap dipakai".
3. Matikan jaringan (mode pesawat) → kirim prompt → token tampil bertahap.
4. Model rusak (potong file) → muncul pesan galat, aplikasi tidak crash.
5. Unduhan: jeda, lanjut, batal, putus jaringan, ruang penuh, token HF salah.
6. Folder SAF: pilih folder berisi `.gguf` → **Pindai** menemukan → model dapat dimuat.
7. Pembersih: hanya cache yang terhapus; model/chat/token tetap.
8. Update in-app: hanya untuk APK release dengan package sama dan versionCode lebih tinggi.
9. Catat matriks perangkat (lihat `TESTING_RELEASE.md`).

## Menambah baseline UI
Hanya bila perubahan UI disetujui: `bash scripts/verify-ui.sh --update`, lalu commit `scripts/ui.sha256`.
