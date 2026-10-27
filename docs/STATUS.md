# Status Fitur Native

Status memakai istilah dari `BOXAI_SPEC_LENGKAP.md` §7. **Belum ada yang berstatus AKTIF / LULUS TES**:
kode ditulis tanpa dapat dibangun atau dijalankan di lingkungan penulisnya.

| Area | Status | Catatan |
| --- | --- | --- |
| WebView + navigasi terbatas (M1) | DIBUAT, BELUM LULUS TES | Memakai WebViewAssetLoader (`https://appassets.androidplatform.net`), bukan `file://` |
| Bridge + validasi (M2) | DIBUAT, BELUM LULUS TES | Seluruh kontrak `NATIVE_BRIDGE.md`; tambahan `stopGeneration()` |
| Secure storage | DIBUAT, BELUM LULUS TES | AES-GCM + Android Keystore |
| Runtime GGUF (M3) | DIBUAT, BELUM LULUS TES | llama.cpp tag `b5000` lewat FetchContent; API JNI harus dicocokkan bila tag diganti |
| Model & unduhan (M4) | DIBUAT, BELUM LULUS TES | Range resume, verifikasi ukuran + magic GGUF |
| Model dari folder SAF | DIBUAT, BELUM LULUS TES | Dimuat lewat `/proc/self/fd/N` |
| Pencarian web | DIBUAT, BELUM LULUS TES | Scrape `html.duckduckgo.com`; rapuh terhadap perubahan HTML |
| Termal | TERBATAS | `PowerManager.currentThermalStatus` (API 29+); CPU% hanya beban proses Box AI (`/proc/stat` diblokir Android) |
| Update in-app | DIBUAT, BELUM LULUS TES | Verifikasi package + versionCode; pemasangan lewat installer sistem |
| Lampiran Foto/File | DIBUAT, BELUM LULUS TES | `WebChromeClient.onShowFileChooser`; tombol Kamera membuka pemilih sistem, bukan jepretan langsung (TERBATAS) |
| Tombol kembali | DIBUAT, BELUM LULUS TES | Menutup sheet; selain itu tekan dua kali untuk keluar (UI asli tidak punya navigasi kembali) |
| Analisis gambar | TIDAK DIDUKUNG | Tidak ada runtime vision/mmproj |
| Connector `/gh` `/cf` | Di sisi UI (JS) | Tidak berubah |
| CI (M6) | DIBUAT, BELUM LULUS TES | Belum pernah dijalankan |
