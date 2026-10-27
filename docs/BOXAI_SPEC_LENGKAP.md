# Box AI — Catatan Spesifikasi Lengkap

**Tujuan dokumen:** menjadi sumber rujukan utama untuk mengembangkan Box AI dari paket UI WebView menjadi aplikasi Android yang benar-benar berfungsi, menggunakan model AI lokal berformat GGUF, tanpa merombak tampilan asli.

## 1. Status paket saat ini

ZIP asal berisi lapisan UI WebView Box AI versi 2.2.36: `index.html`, `styles.css`, `app.js`, dan aset logo. Dokumen UI dan kontrak bridge juga tersedia. Paket ini **belum merupakan proyek Android yang dapat langsung dibangun**: belum ada konfigurasi Gradle, `AndroidManifest.xml`, kode Kotlin, JNI/C++, atau runtime inferensi di paket ini.

Karena itu:
- Tampilan asli adalah acuan dan harus dipertahankan.
- Fitur yang terlihat di UI belum otomatis berarti fitur tersebut bekerja.
- Setiap fitur dinyatakan **AKTIF** hanya setelah implementasi dan pengujian lulus.
- Jangan menampilkan status palsu seperti “model aktif”, “offline”, “unduhan selesai”, atau “pendingin aktif” bila kondisi sebenarnya tidak mendukungnya.

## 2. Prinsip wajib proyek

1. **Pertahankan UI asli.** Jangan mengganti desain, susunan layar, logo, warna, ikon, atau alur navigasi tanpa persetujuan.
2. **Satu milestone setiap kali.** Selesaikan, build, dan uji satu milestone sebelum melanjutkan.
3. **Jangan menghapus fitur yang sudah ada.** Jika fitur belum dapat diimplementasikan, tandai sebagai belum aktif dan jelaskan alasannya; jangan menyamarkan sebagai fitur aktif.
4. **AI lokal di HP.** Inferensi utama harus berjalan di perangkat melalui runtime Android yang kompatibel dengan GGUF. Fitur online seperti pencarian web, unduh model, GitHub, Cloudflare, atau pembaruan hanya berjalan saat pengguna mengaktifkannya.
5. **Build melalui GitHub Actions.** Build harus dapat diulang, menggunakan versi toolchain yang dipatok, dan menghasilkan APK sebagai artifact.
6. **Aman secara default.** Jangan membuka akses native ke halaman web sembarang, jangan menjalankan perintah shell dari chat, dan jangan menyimpan token rahasia di source code atau log.
7. **Jujur soal privasi.** Mode “Hanya on-device” harus memblokir jaringan yang tidak diperlukan oleh fitur lokal, bukan hanya mengubah label.
8. **Tidak mengubah file UI tanpa alasan terbukti.** Perubahan pada `index.html`, `styles.css`, `app.js`, atau logo memerlukan kasus uji yang menunjukkan masalah nyata.
9. **Kompatibilitas perangkat diperiksa.** Periksa ABI, RAM tersedia, penyimpanan, suhu, ukuran model, konteks, dan batas kemampuan model sebelum memulai inferensi.
10. **Dokumentasi mengikuti implementasi.** Perbarui status fitur setelah setiap tes; jangan menulis “semua aktif” sebelum bukti tes tersedia.

## 3. Layar dan fitur yang harus dipertahankan

### A. Splash / boot
- Menampilkan logo dan identitas Box AI.
- Status boot harus mengikuti pemeriksaan nyata: memuat UI, mendeteksi native bridge, memeriksa runtime, lalu memeriksa model.
- Jika runtime belum tersedia, tampilkan status yang jelas dan jangan berpura-pura mesin sudah siap.

### B. Chat
- Membuat chat baru dan mempertahankan riwayat percakapan.
- Mengirim prompt ke model lokal yang benar-benar sedang dimuat.
- Menampilkan respons streaming token, status berpikir/generasi, selesai, dibatalkan, dan error.
- Menghentikan generasi dengan aman.
- Render Markdown sesuai dukungan yang ditetapkan pada `docs/MARKDOWN.md`.
- Tombol salin untuk blok kode dan teks yang relevan.
- Lampiran file teks dibaca dengan batas ukuran dan batas karakter; file besar harus dipotong dengan pemberitahuan.
- Lampiran gambar: model teks biasa tidak memahami piksel. Analisis gambar hanya boleh diaktifkan bila runtime/model vision yang sesuai benar-benar terpasang.
- Tombol pencarian web hanya menjalankan pencarian saat diaktifkan; hasil dan sumber harus ditampilkan dengan benar.
- Saran cepat harus mengisi composer, bukan mengirim pesan tanpa persetujuan pengguna.
- Riwayat chat harus dapat dibuat, dibuka, dan dihapus sesuai desain UI.

### C. Model GGUF
- Daftar model lokal, ukuran, sumber, dan status yang benar.
- Pindai model yang ada melalui penyimpanan aplikasi atau folder yang diizinkan pengguna.
- Unduh model dari sumber yang didukung, dengan progres, jeda, lanjut, batal, dan error yang nyata.
- Verifikasi file selesai diunduh dan ukuran/berkas tidak kosong sebelum menandai selesai.
- Pilih model aktif, muat ke runtime, bongkar model, dan ganti model.
- Tangani kegagalan memori, file rusak, format tidak didukung, ABI/runtime tidak sesuai, serta model terlalu besar.
- Bedakan model utama `.gguf` dan proyektor vision `mmproj-*.gguf`.
- Editor metadata hanya menampilkan atau mengubah metadata yang memang didukung; jangan mengklaim dapat mengubah bobot model.
- Hapus atau ganti nama model dengan konfirmasi dan validasi path.

### D. Pals / asisten khusus
- Pal bawaan: Default Chat, Writer, Coder, Research.
- Pengguna dapat membuat Pal dengan nama dan instruksi sendiri, lalu mengedit/menghapus Pal buatan sendiri sesuai kemampuan UI.
- Pal aktif menentukan prompt sesuai aturan prioritas `docs/SYSTEM_PROMPT.md`.
- Pal tidak boleh mengubah atau melewati kebijakan keamanan aplikasi.

### E. Talents / tools model
- `calculate`: perhitungan matematika dengan parser terbatas dan aman.
- `datetime`: tanggal dan waktu lokal.
- `render_html`: render hasil dalam iframe sandbox; tidak boleh diberi akses native.
- `web_search`: hanya jika diaktifkan pengguna; harus mengembalikan hasil yang bisa ditelusuri sumbernya.
- Validasi nama tool, bentuk argumen, panjang input, batas putaran, timeout, dan hasil error.
- Tool tidak boleh mengeksekusi shell, memasang APK, mengakses token rahasia, atau membaca file bebas tanpa izin.

### F. Connector
- Perintah `/gh` dan `/cf` sesuai dokumentasi UI.
- GitHub: status, gist, push, issue hanya jika endpoint dan izin token yang sesuai tersedia.
- Cloudflare: hanya fungsi yang benar-benar diimplementasikan dengan endpoint/izin yang valid.
- Token disimpan di secure storage Android; tidak dimasukkan ke prompt model, riwayat chat, URL, atau log.
- Sebelum aksi yang mengubah data eksternal (push, membuat issue, mengubah resource), tampilkan ringkasan dan minta persetujuan pengguna.

### G. Pengaturan
- Tema: mengikuti sistem, gelap, AMOLED, terang.
- Warna aksen: biru, violet, zamrud, ambar, mawar, sian.
- Bahasa: Indonesia dan English jika kedua terjemahan tersedia.
- Umpan balik getar jika perangkat mendukungnya.
- Parameter generasi: model default, temperature, top-p, max tokens, context size.
- System prompt global dan preset: Umum, Penulis, Coder, Penerjemah.
- Token HF, GitHub, URL Cloudflare/R2 bila fitur terkait tersedia.
- Sakelar Talents.
- Benchmark.
- Privasi: mode on-device, hapus riwayat, hapus cache/model sesuai pilihan.
- Pengaturan harus tersimpan dan tetap ada setelah aplikasi ditutup/dibuka kembali.

### H. Penjelajah file dan editor teks
- Tampilkan hanya file/folder yang diizinkan aplikasi atau dipilih pengguna.
- Baca, edit, simpan, dan batalkan perubahan dengan status yang jelas.
- Rapikan JSON hanya setelah validasi; tampilkan kesalahan jika JSON rusak.
- Cegah path traversal, akses file di luar izin, dan overwrite tanpa konfirmasi bila berisiko.
- Model GGUF tidak boleh dibuka sebagai teks penuh karena ukurannya sangat besar.

### I. Pembersih penyimpanan
- Hitung cache dan file sementara secara nyata.
- Tampilkan kategori, ukuran, dan dampak penghapusan.
- Jangan menghapus model, chat, token, atau file pengguna tanpa pilihan eksplisit.
- Tampilkan hasil setelah operasi selesai.

### J. Benchmark dan perangkat
- Ukur performa melalui operasi nyata, bukan angka tiruan.
- Laporkan durasi, token/detik bila bisa dihitung, memori, status termal, dan model yang diuji.
- Informasi CPU/RAM/baterai/suhu harus berasal dari sumber Android yang valid.
- Jika nilai tidak tersedia, tampilkan “tidak tersedia”, bukan angka buatan.

### K. Pendingin perangkat / thermal
- Pantau status termal yang tersedia dari Android.
- Hentikan atau jeda generasi jika perangkat mencapai kondisi yang ditetapkan runtime.
- “Cooling pulse” tidak dapat secara ajaib mendinginkan perangkat; fitur hanya boleh melakukan tindakan software yang aman dan terukur.
- Jangan mematikan proses sistem, memaksa CPU, atau menjanjikan penurunan suhu yang tidak terukur.

### L. Pembaruan aplikasi
- Periksa rilis dari sumber yang ditetapkan.
- Verifikasi versi, ukuran, sumber, dan integritas file.
- Tampilkan izin Android yang diperlukan sebelum pemasangan.
- Batalkan unduhan bila diminta.
- Jangan melewati perlindungan instalasi Android atau memasang APK diam-diam.

## 4. Sistem AI lokal yang diwajibkan

### Alur inferensi
1. Pengguna memilih file GGUF.
2. `ModelManager` memvalidasi lokasi, ukuran, dan dukungan file.
3. `LlamaEngine` meminta runtime native/JNI untuk memuat model.
4. Runtime menyiapkan konteks dengan batas aman untuk perangkat.
5. Pesan disusun menjadi format yang sesuai model/chat template.
6. Generasi dijalankan di thread latar belakang.
7. Token dikirim bertahap ke UI melalui callback yang terdokumentasi.
8. Selesai, batal, atau error mengakhiri sesi dan membersihkan sumber daya.
9. Saat model diganti atau aplikasi ditutup, model dibongkar dengan aman.

### Persyaratan runtime
- Pilih satu runtime GGUF/llama.cpp atau binding Android yang kompatibel, lalu pin versi/commit yang diketahui bekerja.
- Build native sesuai ABI target Android; jangan mengasumsikan semua perangkat punya ABI yang sama.
- Gunakan CMake/NDK dan JNI hanya bila diperlukan oleh runtime yang dipilih.
- Jalankan inferensi di background thread/coroutine; jangan mengunci main thread.
- Sediakan pembatalan generasi, unload model, penanganan OOM, dan pelepasan native memory.
- Periksa lisensi runtime dan lisensi masing-masing model.
- Model harus diunduh secara terpisah bila tidak disertakan dalam APK. Jangan memasukkan model besar ke APK tanpa alasan dan izin distribusi yang jelas.

### Format prompt
- Peran pesan: `system`, `user`, `assistant`.
- Gunakan chat template yang cocok dengan model yang dipilih.
- Jangan menganggap satu template cocok untuk semua model.
- Uji setiap template dengan prompt sederhana dan pastikan respons tidak memunculkan token template mentah secara berlebihan.

## 5. Arsitektur aplikasi

- **WebView/UI:** file HTML/CSS/JS asli.
- **Kotlin app shell:** Activity, lifecycle, permission, WebView, dan koordinasi fitur Android.
- **Native bridge:** kontrak yang terdokumentasi di `NATIVE_BRIDGE.md`; validasi semua argumen.
- **Model manager:** katalog, lokasi, metadata, unduhan, pemindaian, dan penghapusan model.
- **Inference engine:** runtime GGUF/JNI dan pengelolaan generasi.
- **Storage layer:** preferensi, riwayat, Pal, workspace, cache, dan secret storage dengan batas akses.
- **Network layer:** hanya untuk fitur online yang disetujui pengguna.
- **CI:** GitHub Actions untuk pemeriksaan UI, unit test, build APK, dan penyimpanan artifact.

## 6. Keamanan dan privasi wajib

- Batasi navigasi WebView ke aset lokal dan domain yang diizinkan secara eksplisit.
- Jangan mengaktifkan akses file universal atau akses konten yang tidak diperlukan.
- `addJavascriptInterface` hanya diekspos ke UI lokal tepercaya; validasi input setiap metode.
- Jangan menyediakan metode generik seperti `exec(command)` atau akses shell.
- Jangan pernah mencatat token, isi rahasia, atau seluruh percakapan ke log debug.
- Simpan token menggunakan Android Keystore-backed storage atau mekanisme secure storage yang sesuai.
- Pisahkan penyimpanan rahasia dari preferensi biasa.
- Permintaan jaringan harus memiliki timeout, validasi HTTPS, batas ukuran, dan pesan error.
- Mode on-device harus benar-benar menghindari pengiriman prompt ke server, kecuali pengguna mengaktifkan fitur online yang dijelaskan.
- Lampiran dan hasil tool dianggap input tak tepercaya.
- Jangan menjalankan HTML hasil model dengan akses native; gunakan sandbox.
- Tampilkan persetujuan sebelum tindakan eksternal yang mengubah data.
- Sediakan cara menghapus riwayat dan data lokal.

## 7. Status fitur yang diperbolehkan

Gunakan hanya status berikut dalam dokumen proyek:
- **BELUM DIBUAT** — belum ada implementasi.
- **DIBUAT, BELUM LULUS TES** — kode ada, belum terbukti bekerja.
- **AKTIF / LULUS TES** — implementasi dan tes penerimaan lulus.
- **TERBATAS** — hanya sebagian skenario bekerja; batasannya harus disebut.
- **TIDAK DIDUKUNG** — sengaja tidak didukung, dengan alasan dan alternatif.

Jangan menggunakan status “100% aktif” tanpa matriks tes yang seluruhnya lulus pada perangkat target.

## 8. Syarat selesai proyek

Box AI dianggap siap rilis hanya bila:
- UI asli tetap utuh dan seluruh tab dapat digunakan.
- APK dapat dibangun ulang dari GitHub Actions dan artifact dapat diunduh.
- APK terpasang dan dibuka pada perangkat Android target.
- Minimal satu model GGUF kompatibel berhasil dimuat dan menjawab tanpa internet.
- Streaming, stop, unload, ganti model, dan error ditangani.
- Unduhan model dan kontrolnya lulus tes.
- Penyimpanan, pengaturan, Pal, file, dan privasi berfungsi sesuai status yang diumumkan.
- Mode offline diuji dengan jaringan dimatikan.
- Tidak ada token rahasia di source, log, atau APK.
- Semua fitur yang belum lulus tes diberi status jelas.
