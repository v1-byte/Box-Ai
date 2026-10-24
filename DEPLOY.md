# Deploy & Tunnel Guide - Box AI

## 1. GitHub Actions (CI)
Workflow sudah ada di `.github/workflows/ci.yml`.  
Setiap push ke `main` akan otomatis:
- Install Flutter
- Analyze code
- Run tests
- Build debug APK

## 2. Cloudflare Tunnel (cloudflared)
Agar bisa akses app dari internet tanpa buka port:

```bash
# Install cloudflared
# https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/

cloudflared tunnel login
cloudflared tunnel create box-ai
# Edit cloudflared-config.example.yml → config.yml
cloudflared tunnel run box-ai
```

## 3. Connect Token di Aplikasi (OpenAI API Key)
Di dalam app Box AI:
1. Buka **Settings**
2. Paste OpenAI API Key kamu
3. Tekan **Save / Connect**

API Key disimpan di SharedPreferences (lokal di device).

## 4. Build Release
```bash
flutter build apk --release
# atau
flutter build appbundle --release
```
