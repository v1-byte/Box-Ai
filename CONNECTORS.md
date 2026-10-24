# Box AI — System Connector

Box AI menggunakan sistem **Connector** sederhana agar user bisa menghubungkan layanan eksternal dengan cara:

1. **Klik** di Settings
2. **Paste Token** (API Key)
3. Tekan **Connect**

## OpenAI Connector (saat ini)

| Langkah | Aksi |
|---------|------|
| 1 | Buka menu **Settings & Connectors** |
| 2 | Paste OpenAI API Key (`sk-...`) di kolom yang tersedia |
| 3 | Tekan tombol **Connect** |
| 4 | Status berubah menjadi **Connected** (hijau) |

Token disimpan secara lokal di device (SharedPreferences) dan **tidak** dikirim ke server Box AI.

### Cara mendapatkan OpenAI API Key
1. Buka https://platform.openai.com/api-keys
2. Buat key baru
3. Copy → Paste di app

## Connector lain (rencana)
- Cloudflare / cloudflared
- GitHub
- Lainnya bisa ditambahkan di masa depan

## Untuk Developer
Lihat file:
- `lib/src/modules/settings/screens/settings_screen.dart` → UI Connector
- `lib/src/globals.dart` → penyimpanan state
- `DEPLOY.md` → cara deploy + tunnel
