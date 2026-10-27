# Arsitektur Sistem Box AI

## Diagram alur

```text
UI asli (HTML/CSS/JS di WebView)
             |
             | window.BoxNative + callback JS
             v
Native bridge Kotlin — validasi, izin, dispatch
   |             |               |
   v             v               v
ModelManager  Storage/Secure   Network/Connectors
   |
   v
LlamaEngine Kotlin
   |
   v
JNI / runtime native yang kompatibel dengan GGUF
   |
   v
Model GGUF lokal di penyimpanan perangkat
```

## Tanggung jawab lapisan

### UI WebView
- Menampilkan layar dan mengumpulkan input.
- Tidak menyimpan token rahasia di `localStorage`.
- Tidak mengasumsikan native tersedia.
- Menampilkan status yang dikirim native; tidak menciptakan status sukses sendiri.

### MainActivity dan WebViewConfig
- Menyiapkan WebView, lifecycle, orientasi/ukuran, keyboard, dan tombol kembali.
- Memuat aset lokal yang tepercaya.
- Membatasi navigasi keluar dan akses file.
- Menghindari bridge pada halaman eksternal.

### BoxNativeBridge
- Implementasi nyata dari metode di `NATIVE_BRIDGE.md`.
- Semua input diperiksa dan diberi batas.
- Metode cepat boleh mengembalikan nilai langsung; pekerjaan lama memakai ID tugas dan callback.
- Setiap operasi memiliki hasil sukses/error yang jelas.

### ModelManager dan DownloadManager
- Mengelola katalog dan lokasi model.
- Memeriksa nama file, ukuran, unduhan parsial, dan ruang penyimpanan.
- Menghindari dua unduhan/operasi yang saling merusak.
- Menghapus hanya file yang dikelola aplikasi atau dipilih secara eksplisit.

### LlamaEngine dan runtime GGUF
- Mengelola lifecycle model native.
- Menjalankan inferensi di background.
- Menyalurkan token ke UI.
- Membatalkan, unload, dan melepaskan memori native.
- Melaporkan batas dukungan model/template secara jujur.

### Storage dan secure storage
- Preferensi nonrahasia, riwayat, Pal, dan workspace dipisah secara logis.
- Token disimpan menggunakan penyimpanan rahasia Android yang sesuai.
- Operasi hapus memiliki konfirmasi dan ruang lingkup jelas.

### Network/Connectors
- Hanya digunakan untuk fitur yang membutuhkan internet.
- HTTPS, timeout, validasi status, batas respons, dan error.
- Token tidak dimasukkan ke URL atau log.
- Aksi yang mengubah data jarak jauh meminta persetujuan.

## Aliran generasi chat
1. UI memastikan teks tidak kosong dan model dipilih.
2. Bridge memeriksa runtime dan model aktif.
3. Pesan system/user/assistant disusun dan diberi template sesuai model.
4. Engine memulai generasi di background dan mengembalikan ID sesi.
5. Token dikirim ke `BoxEngine.token(...)`.
6. Selesai memanggil `BoxEngine.done()`; gagal memanggil `BoxEngine.error(...)`.
7. Stop dari UI membatalkan sesi native yang sesuai.
8. Status model dan riwayat diperbarui hanya setelah operasi nyata selesai.

## Ketentuan untuk mode on-device
- Inferensi utama tidak memerlukan permintaan ke server.
- Pengunduhan model, pencarian web, update, dan connector adalah fitur online yang terpisah.
- Bila mode “Hanya on-device” aktif, semua jaringan AI nonesensial harus diblokir atau memerlukan izin eksplisit.
- Uji dengan mode pesawat/jaringan dimatikan; jangan hanya mengandalkan label UI.
