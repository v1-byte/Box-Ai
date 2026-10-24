# Box AI — System Connector (Full)

Box AI punya **System Connector** bawaan. User cukup:

1. Buka **Settings & Connectors**
2. **Paste token** di connector yang diinginkan
3. Tekan **Connect**

Status langsung berubah jadi **Connected** (hijau).

---

## Connector yang tersedia

### 1. OpenAI Connector (Wajib)
- **Untuk**: Chat bot, content generator, todos manager
- **Token**: OpenAI API Key (`sk-...`)
- **Cara dapat**: https://platform.openai.com/api-keys

### 2. GitHub Connector
- **Untuk**: Integrasi repo, automation, future features
- **Token**: Personal Access Token (`ghp_...` atau `github_pat_...`)
- **Cara dapat**: GitHub → Settings → Developer settings → Personal access tokens
- Permission yang disarankan: `repo`, `read:user`

### 3. Cloudflare Connector
- **Untuk**: Cloudflare Tunnel / cloudflared, future CDN features
- **Token**: Cloudflare API Token
- **Cara dapat**: Cloudflare Dashboard → My Profile → API Tokens

---

## Alur di App

```
Settings & Connectors
├── OpenAI        [Paste sk-...]     → Connect / Disconnect
├── GitHub        [Paste ghp_...]    → Connect / Disconnect
└── Cloudflare    [Paste token]      → Connect / Disconnect
```

Semua token disimpan **lokal** di device (SharedPreferences) dan **tidak** dikirim ke server Box AI.

---

## File terkait (Developer)

| File | Fungsi |
|------|--------|
| `lib/src/modules/settings/screens/settings_screen.dart` | UI System Connector |
| `lib/src/modules/settings/models/app_settings.dart` | Model (openAiApiKey, githubToken, cloudflareToken) |
| `lib/src/globals.dart` | State global |
| `lib/src/utils/common.dart` | Save / Load SharedPreferences |
| `lib/src/constants.dart` | SharedPrefsKeys |
| `cloudflared-config.example.yml` | Contoh config tunnel |
| `DEPLOY.md` | Panduan deploy + tunnel |

---

## Cara menambah Connector baru

1. Tambah field di `AppSettings`
2. Tambah key di `SharedPrefsKeys`
3. Update `saveAppSettingsToSharedPres` & `getAppSettingsFromSharedPrefs`
4. Tambah card di `settings_screen.dart` memakai `_buildConnectorCard`
