# System prompt di Box AI

Dokumen ini menjelaskan bagaimana UI Box AI v2.2.38 menyusun *system prompt* yang dikirim ke model
(`sysPrompt()` di `app.js`).

## Urutan prioritas

Teks dasar dipilih dengan urutan berikut (yang pertama tersedia dipakai):

1. **Prompt Pal aktif** (bila kamu memulai chat dari sebuah Pal selain *Default Chat*)
2. **System prompt global** dari *Pengaturan → Generasi → System prompt*
3. **System prompt bawaan model** (dari editor GGUF → "System prompt bawaan"; awalnya `Kamu asisten yang membantu dan jujur.`)

Jika ada Talent aktif, UI menambahkan satu baris di akhir:

```
Tools: calculate (Hitung ekspresi matematika), datetime (Tanggal dan waktu saat ini). Panggil dengan <tool>{"name":"...","args":{...}}</tool>.
```

- `render_html` **tidak** disebutkan di daftar tools (ia bekerja lewat blok kode ```` ```html ````).
- `web_search` hanya disebut bila tombol globe menyala.

Saat pencarian web menyala, pada putaran pertama UI juga menambahkan ke system prompt:

```
Hasil pencarian web terbaru (gunakan bila relevan dan sebutkan sumbernya):
[1] judul — cuplikan (url)
[2] …
```

## Pesan yang dikirim ke model

```
[ {role: "system",    content: <system prompt di atas>},
  {role: "user"|"assistant", content: …},   // seluruh riwayat chat
  … ]
```

- Pesan pengguna dengan **lampiran teks** diberi tambahan `--- Lampiran: <nama file> ---` diikuti isi file.
- Pesan dengan **gambar** diberi keterangan bahwa pengguna melampirkan gambar dan model teks tidak melihat piksel.
- Hasil tool dikembalikan ke model sebagai `[hasil tool: …]` atau `[tool error]`, maksimal 3 putaran.

## Pengaturan system prompt (UI)

*Pengaturan → Generasi → System prompt*:

- Teks bebas, maksimal **2000 karakter** (penghitung "n / 2000").
- Preset cepat:

| Preset | Isi |
| --- | --- |
| Umum | Kamu asisten yang membantu, ringkas, dan jujur. Jawab dalam bahasa yang dipakai pengguna. |
| Penulis | Kamu penulis profesional. Perbaiki tata bahasa, jaga nada asli, dan jelaskan perubahan penting secara singkat. |
| Coder | Kamu insinyur perangkat lunak senior. Jawab dengan kode yang rapi dan penjelasan singkat. |
| Penerjemah | Kamu penerjemah Indonesia dan Inggris yang akurat. Terjemahkan tanpa menambah komentar. |

- **Kembalikan bawaan** mengisi ulang preset *Umum*. Mengosongkan teks lalu menyimpan menampilkan "Kosong" dan kembali memakai prompt bawaan model.
- Prompt global **tidak dipakai** selama Pal (selain Default Chat) aktif.

## Prompt Pals bawaan

| Pal | Prompt |
| --- | --- |
| Default Chat | Kamu asisten yang membantu, ringkas, dan jujur. |
| Writer | Kamu penulis profesional. Bantu menyusun dan memperbaiki tulisan. |
| Coder | Kamu insinyur perangkat lunak senior. Jawab dengan kode yang rapi. |
| Research | Kamu asisten riset. Ringkas dan tarik poin penting dari dokumen. |

Pal buatan sendiri: nama maks. 24 karakter, arahan maks. 240 karakter; bila arahan kosong dipakai
`Asisten khusus buatanmu.`

## Chat template model (editor GGUF)

Preset template yang tersedia di layar Model GGUF (`{{prompt}}` diganti isi pesan):

| Preset | Template |
| --- | --- |
| Gemma | `<start_of_turn>user\n{{prompt}}<end_of_turn>\n<start_of_turn>model\n` |
| Llama 3 | `<\|start_header_id\|>user<\|end_header_id\|>\n\n{{prompt}}<\|eot_id\|><\|start_header_id\|>assistant<\|end_header_id\|>\n\n` |
| ChatML | `<\|im_start\|>user\n{{prompt}}<\|im_end\|>\n<\|im_start\|>assistant\n` |
| Mistral | `[INST] {{prompt}} [/INST]` |
| Phi-3 | `<\|user\|>\n{{prompt}}<\|end\|>\n<\|assistant\|>\n` |

## File prompt di Penjelajah File

Folder `/pencari/prompts` berisi contoh `default.txt` dan `penulis.txt`. Ini hanya file teks yang bisa
diedit di Editor Teks; UI **tidak** memuatnya otomatis sebagai system prompt (salin isinya ke
pengaturan System prompt bila ingin dipakai).
