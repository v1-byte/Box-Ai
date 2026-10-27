# Perlindungan UI Asli Box AI

## File yang harus dipertahankan
- `BoxAI-Android/app/src/main/assets/www/index.html`
- `BoxAI-Android/app/src/main/assets/www/styles.css`
- `BoxAI-Android/app/src/main/assets/www/app.js`
- `BoxAI-Android/app/src/main/assets/www/assets/logo.webp`
- `BoxAI-Android/app/src/main/assets/www/assets/logo-128.webp`
- `BoxAI-Android/app/src/main/assets/www/assets/logo-64.webp`

## Aturan perubahan
1. Jangan redesign atau mengganti framework.
2. Jangan mengganti logo, font, warna, ikon, teks, urutan layar, atau tab tanpa persetujuan.
3. Sebelum mengubah file UI, tuliskan bug yang dapat direproduksi dan langkah reproduksinya.
4. Simpan hash SHA-256 baseline agar perubahan tak sengaja terdeteksi.
5. Perubahan hanya boleh sekecil mungkin untuk memperbaiki masalah yang terbukti.
6. Jika native bridge belum ada, implementasikan sisi native sesuai kontrak UI sebelum mengubah UI untuk menyembunyikan error.
7. Setelah perubahan, bandingkan screenshot dan jalankan regresi fitur.

## Perintah verifikasi contoh
Dari root repo, gunakan alat yang tersedia untuk menghitung hash file UI, misalnya:

```bash
sha256sum \
  BoxAI-Android/app/src/main/assets/www/index.html \
  BoxAI-Android/app/src/main/assets/www/styles.css \
  BoxAI-Android/app/src/main/assets/www/app.js \
  BoxAI-Android/app/src/main/assets/www/assets/logo.webp \
  BoxAI-Android/app/src/main/assets/www/assets/logo-128.webp \
  BoxAI-Android/app/src/main/assets/www/assets/logo-64.webp
```

Hash hasil awal disimpan di catatan milestone M0. Jangan menulis hash contoh atau menebaknya; ambil dari file asli.

## Tes visual
- Splash.
- Chat kosong dan chat berisi jawaban.
- Composer, sheet lampiran, keyboard terbuka.
- Model: loading, kosong, terunduh, mengunduh, error.
- Pals: daftar, Pal aktif, buat Pal.
- Pengaturan dan semua sheet.
- Penjelajah file, editor teks, editor GGUF.
- Pembersih, benchmark, thermal, tentang, update.
- Ukuran layar kecil dan rotasi/lifecycle yang didukung.

**Kriteria lulus:** fungsi native boleh bertambah, tetapi UI tetap setara dengan baseline kecuali ada perubahan yang secara eksplisit disetujui.
