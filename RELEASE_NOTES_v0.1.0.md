# Box AI v0.1.0 — First public release

**Tanggal:** 2026-10-24  
**Repo:** https://github.com/v1-byte/Box-Ai  
**App utama:** `BoxAI-Android/` (package `com.boxai.app`)

## Yang di-release

### App Android (tampilan utama)
- Shell Kotlin + WebView fullscreen
- UI HTML: Chat, Models, Pals, Settings, Files
- Logo cube Box AI, dark AMOLED-style
- Persistence lokal (localStorage): chat, model aktif, pals, settings
- Attach file/gambar, model cards, download simulasi, system prompt, export catatan

### Fitur backend RN (masih di monorepo, untuk integrasi berikutnya)
- Talent: file_reader, rag_search, finance, prayer_times, weather, image_understand
- Privacy Dashboard, model RAM recommender
- Package rebrand `com.v1byte.boxai` (RN path)

## Cara dapat APK
1. GitHub → Actions → **Build Box AI APK** → Run workflow  
2. Download artifact `BoxAI-v0.1.0-apk`  
3. Atau lokal: `cd BoxAI-Android && gradle assembleDebug`

## Batasan v0.1.0
- Inferensi LLM on-device **belum** di-bind ke GGUF engine di WebView shell (UI + state siap)
- PDF RAG / Whisper full loop = tahap berikutnya (lihat ROADMAP_ID.md)

## Install
Aktifkan “sumber tidak dikenal”, install APK debug, buka **Box AI**.
