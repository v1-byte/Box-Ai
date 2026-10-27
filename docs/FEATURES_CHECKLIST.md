# Checklist Fitur Box AI

Dokumen ini adalah checklist implementasi dan penerimaan. Centang hanya setelah bukti tes tersedia. Status awal semua fitur native ditetapkan **BELUM DIBUAT / BELUM DIVERIFIKASI**, karena ZIP asal adalah paket UI.

## 1. UI dan navigasi
- [ ] Splash mempertahankan logo, teks, dan gaya asli.
- [ ] Tab Chat, Model, Pals, Pengaturan bekerja.
- [ ] Keyboard tidak menutupi composer; tab bar berperilaku sesuai UI.
- [ ] Tema gelap/AMOLED/terang dan enam aksen bekerja serta tersimpan.
- [ ] Bahasa Indonesia/English benar-benar diterapkan.
- [ ] Semua dialog, sheet, tombol tutup, kembali, dan konfirmasi berfungsi.
- [ ] Screenshot sebelum/sesudah dibandingkan; tidak ada perubahan desain tak disengaja.

## 2. Chat dan inferensi
- [ ] Model lokal bisa dimuat dan status model aktif akurat.
- [ ] Kirim pesan dan terima respons.
- [ ] Streaming token tidak merusak teks/Markdown.
- [ ] Stop generasi menghentikan proses native.
- [ ] Error runtime tampil jelas dan tidak membuat aplikasi crash.
- [ ] Chat baru, riwayat, buka ulang, dan hapus riwayat.
- [ ] Temperature, top-p, max tokens, context size diterapkan ke runtime.
- [ ] System prompt dan Pal aktif mengikuti aturan prioritas.
- [ ] Prompt template sesuai model.
- [ ] File teks dapat dilampirkan dengan batas ukuran.
- [ ] Gambar hanya dianalisis jika model/runtime vision didukung.
- [ ] Salin teks/blok kode bekerja.
- [ ] Mode offline diuji dengan jaringan dimatikan.

## 3. Model dan unduhan
- [ ] Daftar model lokal.
- [ ] Pemindaian model dalam lokasi yang diizinkan.
- [ ] Unduh dari sumber yang dikonfigurasi dan valid.
- [ ] Progress/kecepatan/ukuran sesuai data nyata.
- [ ] Pause, resume, cancel.
- [ ] Unduhan terputus dapat dipulihkan atau dimulai ulang dengan aman.
- [ ] File parsial tidak muncul sebagai model siap pakai.
- [ ] Validasi file rusak/tidak lengkap.
- [ ] Muat, unload, ganti, rename, delete model.
- [ ] Peringatan jika RAM/ruang/ukuran konteks tidak memadai.
- [ ] File mmproj dibedakan dari model utama.

## 4. Pals dan Talents
- [ ] Default Chat, Writer, Coder, Research.
- [ ] Buat, pilih, dan hapus Pal buatan sendiri.
- [ ] Prompt Pal tidak tertukar dengan prompt global.
- [ ] `calculate` menolak ekspresi di luar whitelist.
- [ ] `datetime` menggunakan waktu lokal perangkat.
- [ ] `render_html` memakai sandbox tanpa akses native.
- [ ] `web_search` hanya berjalan saat diaktifkan.
- [ ] Batas putaran tool, timeout, argumen, dan error diuji.
- [ ] Tool tidak bisa mengakses token atau menjalankan perintah shell.

## 5. Connector
- [ ] Status GitHub benar.
- [ ] Gist/issue/push hanya aktif bila endpoint dan izin token benar.
- [ ] Cloudflare connector teruji dengan akun/izin yang benar.
- [ ] Aksi eksternal meminta persetujuan pengguna.
- [ ] Token disimpan aman dan tidak terlihat di log/prompt.
- [ ] Kegagalan autentikasi, rate limit, dan jaringan ditangani.

## 6. Pengaturan, data, dan privasi
- [ ] Preferensi tersimpan setelah restart.
- [ ] Token tidak tersimpan di localStorage.
- [ ] Secure storage memakai penyimpanan yang sesuai.
- [ ] Hapus riwayat menghapus data sesuai konfirmasi.
- [ ] Hapus cache tidak menghapus model/chat tanpa izin.
- [ ] Mode on-device benar-benar memblokir trafik AI online yang tidak diminta.
- [ ] Izin penyimpanan/folder ditangani melalui API Android yang tepat.
- [ ] Data pengguna tidak tertimpa diam-diam.

## 7. File, editor, perawatan
- [ ] Penjelajah file menampilkan file yang diizinkan saja.
- [ ] Baca/tulis/simpan/cancel bekerja.
- [ ] JSON formatter menampilkan error untuk JSON invalid.
- [ ] Path traversal dan akses tanpa izin ditolak.
- [ ] Pembersih menghitung ukuran nyata dan menampilkan kategori.
- [ ] Benchmark mengukur proses nyata.
- [ ] CPU/RAM/termal/baterai berasal dari data perangkat yang tersedia.
- [ ] Pendingin/thermal tidak menjanjikan hasil yang tidak terukur.
- [ ] Pembaruan memverifikasi sumber dan meminta persetujuan pemasangan.

## 8. Build dan rilis
- [ ] Gradle wrapper dan toolchain dipatok.
- [ ] Pemeriksaan JavaScript lulus.
- [ ] Unit test lulus.
- [ ] Build debug APK lulus.
- [ ] APK artifact tersedia dari GitHub Actions.
- [ ] APK dapat diinstal pada perangkat target.
- [ ] Pengujian dasar berjalan setelah instalasi.
- [ ] Build release ditandatangani dengan secret GitHub, bukan file keystore/token yang dikomit.
- [ ] Lisensi aplikasi, runtime, dependency, dan model terdokumentasi.
