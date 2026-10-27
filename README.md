# Box AI

> Asisten AI privat yang berjalan di ponselmu. Chat, Pals, dan Model, berjalan offline sejak awal.

**Versi UI:** `2.2.37` · **Platform:** Android (WebView) · **Bahasa antarmuka:** Indonesia
**Basis:** [PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai) (MIT) · **Sumber:** `github.com/v1-byte/Box-Ai`

Repo ini berisi **lapisan UI WebView** Box AI (HTML + CSS + JavaScript murni) **dan proyek Android** (Kotlin + JNI llama.cpp + GitHub Actions) yang membungkusnya. Status tiap fitur ada di [`docs/STATUS.md`](docs/STATUS.md): kode belum pernah dibangun/diuji di perangkat.
Lihat [`docs/NATIVE_BRIDGE.md`](docs/NATIVE_BRIDGE.md) untuk kontrak antara UI dan sisi native.

---

## Daftar isi

1. [Struktur repo](#struktur-repo)
2. [Ringkasan fitur](#ringkasan-fitur)
3. [Layar dan fitur per layar](#layar-dan-fitur-per-layar)
   - [Splash](#splash)
   - [Chat](#1-chat)
   - [Model](#2-model)
   - [Pals](#3-pals)
   - [Pengaturan](#4-pengaturan)
   - [Penjelajah File](#penjelajah-file)
   - [Editor Teks](#editor-teks)
   - [Editor Model GGUF](#editor-model-gguf)
   - [Pembersih Penyimpanan](#pembersih-penyimpanan)
   - [Benchmark](#benchmark)
   - [Tentang](#tentang)
   - [Pembaruan in-app](#pembaruan-in-app)
4. [Talents (tools untuk model)](#talents-tools-untuk-model)
5. [Perintah chat dan Connector](#perintah-chat-dan-connector)
6. [Tema dan warna aksen](#tema-dan-warna-aksen)
7. [Pendingin perangkat (thermal)](#pendingin-perangkat-thermal)
8. [Privasi dan keamanan](#privasi-dan-keamanan)
9. [Penyimpanan data](#penyimpanan-data)
10. [Menjalankan dan mengembangkan](#menjalankan-dan-mengembangkan)
11. [Batasan yang perlu diketahui](#batasan-yang-perlu-diketahui)
12. [Lisensi dan atribusi](#lisensi-dan-atribusi)

---

## Struktur repo

```
Box-Ai/
├── README.md
├── LICENSE
├── .gitignore
├── docs/
│   ├── NATIVE_BRIDGE.md        # kontrak window.BoxNative (UI ⇄ Kotlin)
│   ├── SYSTEM_PROMPT.md        # susunan system prompt, preset, chat template
│   ├── MARKDOWN.md             # sintaks Markdown yang dirender di chat
│   └── README-UI.txt           # catatan asli dari paket UI
├── scripts/
│   ├── verify-ui.sh            # hash UI + node --check + pemeriksaan rahasia
│   └── ui.sha256               # baseline SHA-256 file UI
├── .github/workflows/android-build.yml
└── BoxAI-Android/
    ├── settings.gradle.kts · build.gradle.kts · gradle.properties
    └── app/
        ├── build.gradle.kts · src/main/AndroidManifest.xml
        ├── src/main/java/com/boxai/app/   # MainActivity, WebViewConfig, BoxNativeBridge, LlamaEngine, ...
        ├── src/main/cpp/                   # CMakeLists.txt + boxai_jni.cpp (llama.cpp)
        ├── src/test/                       # unit test JVM
        └── src/main/assets/www/
        ├── index.html          # markup semua layar + sprite ikon SVG
        ├── styles.css          # gaya (± 770 baris), tema, aksen, lapisan profesional
        ├── app.js              # seluruh logika UI (± 2.200 baris, satu IIFE)
        └── assets/
            ├── logo.webp
            ├── logo-128.webp
            └── logo-64.webp
```

Path `BoxAI-Android/app/src/main/assets/www/` sengaja dipertahankan agar folder ini bisa langsung ditimpa ke project Android Studio.

---

## Ringkasan fitur

| Area | Fitur |
| --- | --- |
| **Chat** | Percakapan dengan model lokal, render Markdown dasar, lampiran file/gambar, pencarian web (tombol globe), tombol chat baru, indikator model aktif |
| **Model** | Daftar model, unduh dengan jeda/lanjut/batal, sumber HF Hub, GitHub, Cloudflare, R2, pindai model di perangkat, urutkan |
| **Pals** | Asisten khusus dengan system prompt sendiri; 4 bawaan + buat sendiri |
| **Talents** | Tools yang bisa dipanggil model: hitung, tanggal-waktu, render HTML, cari web |
| **Connector** | Perintah `/gh` dan `/cf` dari chat (status, gist, push, issue) |
| **Pengaturan** | Tema, warna aksen, bahasa, getar, parameter generasi, token, privasi |
| **File** | Penjelajah file, editor teks (dengan rapikan JSON), editor metadata GGUF |
| **Perawatan** | Pembersih penyimpanan, benchmark perangkat, pendingin termal |
| **Update** | Cek rilis GitHub, unduh dan pasang APK dari dalam aplikasi |

---

## Layar dan fitur per layar

Navigasi utama memakai **tab bar** di bawah dengan empat tab: **Chat**, **Model**, **Pals**, **Pengaturan**.
Tab bar otomatis disembunyikan saat keyboard muncul.

### Splash

- Animasi kubus 3D dengan nama merek **Box AI**.
- Bilah progres boot dan teks status ("Menyiapkan mesin on-device").

### 1. Chat

**Top bar**

- Tombol menu (☰, membuka Pengaturan), logo, judul percakapan, dan sub-judul berisi **nama model aktif + mode** (mis. `Gemma 2 2B · On-device`).
- Tombol **Chat baru**.
- Tombol **Pendingin perangkat** (ikon kipas) dengan lencana persentase CPU. Lihat [Pendingin perangkat](#pendingin-perangkat-thermal).

**Composer (kolom pesan)**

- **`+` Lampirkan** membuka sheet: *Connector*, *Foto/galeri*, *Kamera*, *File* (PDF, TXT, dan lainnya).
- **Globe** menyalakan/mematikan **pencarian web** untuk pesan berikutnya.
- Kolom teks "Tulis pesan ke Box AI" dan tombol **Kirim**.
- Chip lampiran menampilkan file yang akan dikirim.

**Layar kosong:** menampilkan empat saran cepat — *Ringkas teks ini*, *Tulis email singkat*, *Jelaskan kode ini*, *Beri ide proyek*. Mengetuknya mengisi kolom pesan dengan awalan tersebut.

**Perilaku**

- Jawaban dirender dengan renderer Markdown **sederhana**: blok kode (dengan tombol Salin), kode inline, **tebal**, paragraf. Judul, daftar, tabel, dan tautan tidak dirender. Detail di [`docs/MARKDOWN.md`](docs/MARKDOWN.md).
- **Lampiran teks** (txt dan sejenisnya) disisipkan ke prompt sebagai konteks (dipotong hingga 50.000 karakter saat disimpan).
- **Lampiran gambar** ditampilkan di chat, tetapi model teks tidak melihat piksel; model hanya diberi tahu bahwa ada gambar.
- **Pencarian web**: kueri dikirim lewat native bridge, hasilnya disuntikkan ke system prompt dan sumbernya ditampilkan di bawah jawaban sebagai `[1] [2] …`.
- **Agen bertool**: model dapat memanggil Talent dengan format `<tool>{"name":"…","args":{…}}</tool>`; hasilnya diumpankan kembali (maksimal 3 putaran).
- Respons HTML dari Talent `render_html` ditampilkan di dalam `iframe` ber-sandbox.
- Jika Pal aktif, system prompt Pal dipakai menggantikan system prompt global. Urutan prioritas dan preset lengkap ada di [`docs/SYSTEM_PROMPT.md`](docs/SYSTEM_PROMPT.md).

### 2. Model

**Filter (chip):** `Semua` · `Terunduh` · `HF Hub` · `GitHub` · `Cloudflare` · `R2`

**Sumber model**

| Sumber | Cara kerja |
| --- | --- |
| **HF Hub** | Kolom cari repo Hugging Face (format `owner/model`, bukan nama file). Token HF dipakai untuk model *gated*. |
| **GitHub** | Memuat daftar model dari repo yang diatur di Pengaturan (default `v1-byte/Box-Ai`, path `boxai/`). |
| **Cloudflare** | URL tunnel Cloudflare (`…/` atau `…/manifest.json`). |
| **R2** | URL publik R2 (`…/` atau `…/manifest.json`). |
| **Perangkat** | Tombol **Pindai model di perangkat** memindai file `.gguf` yang sudah ada. |

**Kartu model**

- Nama, ukuran, sumber, dan status.
- Tombol unduh dengan **cincin progres**; kontrol **jeda**, **lanjut**, dan **batal**.
- Panel unduhan menempel (sticky) di atas dan selalu terlihat selama mengunduh, menampilkan ukuran dan kecepatan.
- File proyeksi vision `mmproj-*.gguf` dikenali dan diperlakukan terpisah dari model utama.

**Lanjut unduhan:** dilakukan dengan mengantre ulang unduhan di background (DownloadManager); bila URL model hilang, UI meminta unduh ulang dari Hub.

**Sheet model:** gunakan model ini, ubah/hapus dari perangkat, buka file GGUF.

**Menu opsi (⋮)**

- **Urutkan:** Bawaan · Ukuran terkecil dulu · Nama A–Z
- **Segarkan daftar**
- **Buka folder model** (`/pencari/models`)
- **Pembersih penyimpanan**

Layar ini memakai *skeleton loading* saat pertama dibuka.

### 3. Pals

Asisten khusus dengan system prompt sendiri.

| Pal bawaan | Fungsi |
| --- | --- |
| **Default Chat** | Asisten umum |
| **Writer** | Draf, tulis ulang, atur nada |
| **Coder** | Jelaskan dan refaktor kode offline |
| **Research** | Ringkas catatan dan PDF panjang |

- **`+` Pal baru:** nama (maks. 24 karakter) dan arahan/system prompt (maks. 240 karakter).
- Ketuk Pal → **Mulai chat dengan …** (memulai chat baru dengan Pal itu) atau **Hapus Pal** (hanya Pal buatan sendiri).
- Pal yang sedang dipakai ditandai **Dipakai**.

### 4. Pengaturan

Dua kartu pintasan di atas:

- **Pembersih penyimpanan** — pindai cache, file sementara, dan model.
- **Penjelajah file** — jelajahi file dan folder model.

**Aplikasi**

| Pengaturan | Pilihan |
| --- | --- |
| Tema | Ikuti sistem · Gelap · AMOLED (hitam pekat) · Terang |
| Warna aksen | Biru · Violet · Zamrud · Ambar · Mawar · Sian |
| Bahasa | Indonesia · English |
| Umpan balik getar | Saklar (getar ringan 8 ms saat ketuk) |

**Generasi**

| Pengaturan | Rentang |
| --- | --- |
| Model default | Dari model yang sudah diunduh |
| Temperature | 0 – 2 (langkah 0,1) |
| Top-p | 0 – 1 (langkah 0,05) |
| Max tokens | 256 – 4096 (langkah 128) |
| Ukuran konteks | 1024 – 8192 (langkah 1024), dibatasi rekomendasi perangkat |
| System prompt | Teks bebas (maks. 2000 karakter) + preset Umum, Penulis, Coder, Penerjemah |

**Alat**

- Token Hugging Face
- GitHub repo model, GitHub token (opsional)
- Cloudflare tunnel URL
- R2 / public URL
- **Talents** (nyalakan/matikan per tool)
- **Benchmark**

**Privasi**

- **Hanya on-device** (lencana ON/OFF; mematikan akan meminta konfirmasi karena model online bisa mengirim percakapan ke server)
- **Hapus riwayat chat**
- **Hapus cache model**

**Tentang**

- Tentang Box AI · **Lisensi** (sheet berisi lisensi Box AI, PocketPal AI, llama.cpp, dan model: Gemma Terms of Use, Llama Community License, Phi-3 MIT, Mistral Nemo & Qwen2.5 Apache 2.0)
- **Akses folder penyimpanan** (izin tree akses Android)
- **Pindai model di perangkat**
- **Versi / Cek update** (menampilkan `2.2.37`)

### Penjelajah File

Penjelajah file bergaya Finder untuk folder model dan catatan.

- Folder awal: `/pencari/models`, `/pencari/prompts`, `/pencari/catatan` (dengan contoh `default.txt`, `penulis.txt`, `catatan-model.md`).
- Kolom **cari file dan folder**, **breadcrumb**, dan penghitung item.
- Buat baru (`+`), **ganti nama**, **hapus**, dan menu per entri.
- Berkas teks dibuka di Editor Teks; berkas `.gguf` dibuka di Editor Model GGUF.

### Editor Teks

- Edit teks polos, nama dan path di header, indikator perubahan belum disimpan.
- Tombol **Rapikan JSON** muncul untuk file `.json`.
- Tombol **Simpan** aktif hanya saat ada perubahan; footer menampilkan info file.

### Editor Model GGUF

Bobot tensor hanya dibaca; metadata dan konfigurasi bisa diedit.

- **Informasi** file (ukuran, dll.).
- **Metadata yang bisa diedit:** nama model, panjang konteks (kelipatan 256, min. 256), **preset chat template** (Gemma · Llama 3 · ChatML · Mistral · Phi-3), chat template manual, dan system prompt bawaan.
- **Header file:** tampilan hex 128 byte pertama.
- **Buka file konfigurasi `.json`** pendamping model.
- **Hapus file model.**

### Pembersih Penyimpanan

- Pengukur melingkar (gauge) dengan animasi sapuan saat memindai.
- Memindai **KV cache, file sementara, thumbnail, dan log**, lalu menampilkan ukuran yang bisa dibebaskan.
- Tombol **Pindai sekarang** → **Bersihkan** → **Pindai ulang**.
- Menampilkan penggunaan penyimpanan nyata perangkat.

### Benchmark

Mengukur kemampuan perangkat langsung dari WebView:

- **CPU** (MFLOPS, 1 thread)
- **Memori** (MB/s salin)
- **GPU** (nama renderer WebGL)
- **RAM** perangkat

Jalankan dengan tombol **Jalankan benchmark**.

### Tentang

Logo animasi dengan cincin, deskripsi aplikasi, dan tiga poin: **Privat** (data tetap lokal), **Cepat** (tanpa jaringan), **Modular** (ganti model bebas).

### Pembaruan in-app

- Pengecekan senyap otomatis sekitar 2,8 detik setelah aplikasi dibuka, dan manual lewat **Versi / Cek update**.
- Membaca rilis terbaru dari `https://api.github.com/repos/v1-byte/Box-Ai/releases/latest` dan mencari aset `.apk`.
- Overlay pembaruan: judul, status, bilah progres, persen, tombol **Install sekarang** dan **Nanti saja**.
- Hanya berfungsi di aplikasi Android (butuh native bridge).

---

## Talents (tools untuk model)

Talents bisa dinyalakan/dimatikan di **Pengaturan → Alat → Talents**.

| Talent | Fungsi | Default |
| --- | --- | --- |
| `calculate` | Hitung ekspresi matematika (hanya karakter `0-9 + - * / % ^ ( ) . ,`) | Aktif |
| `datetime` | Tanggal dan waktu saat ini (locale `id-ID`) | Aktif |
| `render_html` | Tampilkan HTML di dalam chat (iframe `sandbox`) | Aktif |
| `web_search` | Cari via DuckDuckGo lewat native bridge; kueri dikirim ke internet | Mati (nyalakan lewat tombol globe) |

---

## Perintah chat dan Connector

Buka **`+` → Connector** atau ketik `/connect` untuk mengisi token dan URL.

| Perintah | Fungsi |
| --- | --- |
| `/connect` | Buka sheet Connector |
| `/gh` atau `/gh status` | Cek login GitHub, repo, dan path default |
| `/gh gist [nama.ext]` | Buat gist dari blok kode terakhir di chat |
| `/gh push path/file.ext` | Push blok kode terakhir ke repo (membuat/memperbarui file) |
| `/gh issue [judul]` | Buat issue di repo yang dipilih |
| `/cf` atau `/cf status` | Cek URL Cloudflare dan `manifest.json` |

Isian Connector: GitHub token, repo (`owner/name`), path default (`boxai/`), Cloudflare tunnel URL, Cloudflare API token (opsional), Meta/HF token (opsional), plus tombol **Uji GitHub**.

---

## Tema dan warna aksen

- **Tema:** Ikuti sistem · Gelap · **AMOLED** (hitam pekat `#000000`) · Terang.
- **Aksen:** Biru `#5b7cff` · Violet `#8b6cff` · Zamrud `#1fc58a` · Ambar `#f0a021` · Mawar `#f2547d` · Sian `#14b8d6` (varian lebih gelap otomatis untuk tema terang).
- Diterapkan lewat atribut `data-theme`, `data-amoled`, dan `data-accent` pada `<html>`; `theme-color` ikut menyesuaikan.

---

## Pendingin perangkat (thermal)

Tombol kipas di top bar chat memantau CPU, RAM, dan suhu baterai tiap 10 detik.

| Status | Perilaku |
| --- | --- |
| Normal | Perlindungan aktif memantau status termal Android |
| Warm | Thread CPU dan konteks dibatasi otomatis |
| Throttled | Thread dan ukuran konteks dikurangi pada pemuatan/generasi berikutnya |
| Paused | Permintaan baru ditunda sampai suhu turun |

*Cooling pulse* berjalan 5 detik di setiap siklus 10 detik. Ketuk tombol untuk melihat detail suhu, CPU, dan RAM bebas.

---

## Privasi dan keamanan

- Mode **Hanya on-device** aktif secara default.
- Token (HF, GitHub, Cloudflare, Meta) disimpan lewat **secure storage native** (`getSecret`/`setSecret`) dan **dikeluarkan dari salinan localStorage**.
- **Content-Security-Policy** ketat: `default-src 'none'`, `script-src 'self'`, `frame-src 'none'`, `object-src 'none'`, `form-action 'none'`; `connect-src` hanya `'self'` dan `https:`.
- Output HTML dari model dirender di `iframe sandbox=""` (tanpa skrip).
- Pencarian web hanya terjadi bila kamu menyalakannya, dan kueri memang dikirim ke internet.
- **Jangan pernah commit token** ke repo (lihat `.gitignore`).

---

## Penyimpanan data

| Data | Lokasi |
| --- | --- |
| Pengaturan, riwayat chat, Pals, file virtual | `localStorage` kunci `boxai.v3` |
| Token rahasia | Secure storage native |
| Gambar lampiran | Dibuang dari penyimpanan jika > ± 200 KB |
| Teks lampiran | Dipotong hingga 50.000 karakter |
| File model GGUF | Penyimpanan perangkat (dikelola native) |

---

## Menjalankan dan mengembangkan

**Preview cepat di browser** (tanpa native bridge, sebagian fitur tidak aktif):

```bash
cd BoxAI-Android/app/src/main/assets/www
python3 -m http.server 8080
# buka http://localhost:8080
```

**Di project Android:** salin isi `BoxAI-Android/app/src/main/assets/www/` ke `app/src/main/assets/www/`, lalu muat lewat `WebView` (`file:///android_asset/www/index.html`) dan daftarkan objek `BoxNative` dengan `addJavascriptInterface`. Rincian ada di [`docs/NATIVE_BRIDGE.md`](docs/NATIVE_BRIDGE.md).

Catatan pengembangan:

- Tanpa bundler, tanpa dependensi. Semua ikon berasal dari sprite SVG di `index.html` (`#i-…`).
- `app.js` adalah satu IIFE; state tunggal bernama `S`, disimpan lewat `save()`.
- Gaya akhir (lapisan profesional dan aksen) berada di bagian bawah `styles.css`.

---

## Batasan yang perlu diketahui

- Repo ini **hanya UI**. Tanpa native bridge, fitur berikut tidak jalan: inferensi, unduhan model, pencarian web, pembersih nyata, pendingin termal, update in-app, dan akses folder.
- Model teks tidak membaca piksel gambar; lampiran gambar hanya diteruskan sebagai keterangan.
- Pilihan **Bahasa** (Indonesia/English) tersedia di pengaturan, tetapi teks antarmuka saat ini ditulis dalam bahasa Indonesia.
- Pemanggilan tool dibatasi 3 putaran per pesan.

---

## Lisensi dan atribusi

- **Box AI**: MIT (sesuai layar Lisensi di aplikasi). Lihat [`LICENSE`](LICENSE).
- **PocketPal AI**: arsitektur dasar, MIT.
- **llama.cpp**: mesin inferensi, MIT.
- **Model** punya lisensi masing-masing: Gemma (Gemma Terms of Use), Llama 3.2 (Llama Community License), Phi-3 (MIT), Mistral Nemo dan Qwen2.5 (Apache 2.0).

Bila kamu mendistribusikan ulang, pertahankan pemberitahuan hak cipta dan teks lisensi MIT dari proyek asal.
---

## Dokumen pengembangan lengkap

Catatan pengembangan untuk mengubah paket UI ini menjadi aplikasi Android lokal yang berfungsi:

- [`docs/BOXAI_SPEC_LENGKAP.md`](docs/BOXAI_SPEC_LENGKAP.md) — spesifikasi sistem, fitur wajib, AI lokal GGUF, keamanan, dan syarat selesai.
- [`docs/FEATURES_CHECKLIST.md`](docs/FEATURES_CHECKLIST.md) — checklist penerimaan untuk setiap fitur.
- [`docs/IMPLEMENTASI_FILE_DEMI_FILE.md`](docs/IMPLEMENTASI_FILE_DEMI_FILE.md) — rencana milestone dan file target satu per satu.
- [`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md) — arsitektur UI, bridge, penyimpanan, runtime, dan aliran inferensi.
- [`docs/UI_PRESERVATION.md`](docs/UI_PRESERVATION.md) — aturan untuk mempertahankan UI asli.
- [`docs/TESTING_RELEASE.md`](docs/TESTING_RELEASE.md) — tes, matriks perangkat, dan gerbang rilis.
- [`docs/BUILD-APK.md`](docs/BUILD-APK.md) — rencana build APK melalui GitHub Actions.

**Penting:** dokumen ini adalah spesifikasi dan rencana kerja, bukan bukti bahwa fitur native sudah aktif. Status fitur harus diperbarui setelah implementasi dan tes nyata.
