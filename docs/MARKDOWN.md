# Dukungan Markdown di chat Box AI

Jawaban model dirender oleh fungsi `md()` di `app.js`. Renderer ini **sengaja sederhana** dan hanya
mengenali sebagian kecil sintaks. Semua teks di-*escape* dulu (HTML mentah dari model tidak dijalankan).

## Yang didukung

| Sintaks | Hasil |
| --- | --- |
| `` ```bahasa … ``` `` | Blok kode dengan tombol **Salin** (menyalin ke clipboard, toast "Kode disalin") |
| `` ```html … ``` `` | Dirender di `iframe sandbox=""` (tinggi 220 px) bila Talent `render_html` aktif; bila mati, tampil sebagai blok kode |
| `` `kode` `` | Kode inline |
| `**tebal**` | Teks tebal |
| Baris kosong | Paragraf baru |
| Satu baris baru | `<br>` |

## Yang TIDAK didukung

Judul (`#`), daftar (`-`, `1.`), *miring* (`*teks*`), tabel, kutipan (`>`), garis pemisah, dan tautan
Markdown `[teks](url)` ditampilkan sebagai **teks biasa**. Satu-satunya tautan yang dirender adalah
daftar **Sumber** hasil pencarian web di bawah jawaban.

## Catatan

- Blok `html` di dalam `iframe` tidak bisa menjalankan skrip (sandbox kosong) dan tidak bisa mengakses data aplikasi.
- Bahasa pada blok kode hanya dibaca untuk mendeteksi `html`; tidak ada penyorotan sintaks.
- Jawaban disimpan dua versi: HTML hasil render dan teks mentah (`raw`). Teks mentahlah yang dikirim kembali ke model pada giliran berikutnya.
- Ingin tabel/daftar? Perlu mengganti `md()` dengan parser Markdown penuh (mis. lewat berkas lokal, karena CSP hanya mengizinkan `script-src 'self'`).
