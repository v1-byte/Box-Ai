# Changelog

## 2.2.38 — 2026-10-27

- Saat timeout tanpa token, minta engine native menghentikan inferensi yang ditinggalkan agar tidak terus memakai CPU/RAM di latar belakang.
- Tampilkan progres evaluasi prompt per chunk di chat, sehingga proses prefill yang lambat dapat dibedakan dari model yang tidak bergerak.
- Sertakan progres prompt terakhir pada pesan timeout untuk membantu diagnosis di perangkat.
- Naikkan Android `versionCode` ke 2238 dan `versionName` ke 2.2.38.

## 2.2.37 — 2026-10-27

- Mengantrikan pesan chat satu per satu agar tiap prompt hanya memuat pesan-pesan sebelumnya dan tidak mendahului jawaban yang masih diproses.
- Menampilkan pesan yang sedang menunggu giliran dengan indikator antrean.
- Mengubah timeout generasi menjadi batas tanpa-progres 3 menit yang diperbarui setiap token diterima, serta membersihkan callback pada penyelesaian/error.
- Menaikkan versi Android ke `versionCode` 2237 dan `versionName` 2.2.37.

## 2.2.36

- Rilis sebelumnya; lihat GitHub Releases untuk catatan lengkap.
***
