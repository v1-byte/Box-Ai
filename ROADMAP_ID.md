# Box AI — Roadmap ungguli PocketPal (pasar Indonesia)

Repo: https://github.com/v1-byte/Box-Ai

## Sudah di-landasan (kode di repo)

| Fitur | Status | Lokasi |
|-------|--------|--------|
| Talent `weather` | ✅ | `src/services/talents/WeatherEngine.ts` |
| Talent `file_reader` | ✅ scaffold (TXT/MD/CSV/JSON) | `src/services/talents/FileReaderEngine.ts` |
| Talent `finance` (catat Rp) | ✅ on-device AsyncStorage | `src/services/talents/FinanceEngine.ts` |
| Talent `prayer_times` | ✅ offline approx | `src/services/talents/PrayerTimeEngine.ts` |
| RAG scaffold (chunk) | ✅ | `src/services/rag/` |
| Model RAM recommender | ✅ | `src/services/modelManager/recommend.ts` |
| Privacy Dashboard screen | ✅ | `src/screens/PrivacyDashboardScreen/` |
| Theme accent Box | ✅ | `#00C2FF` |
| Package `com.v1byte.boxai` | ✅ | Android + iOS |

## Minggu 1 (lanjutan)

- [ ] PDF text extract native / modul
- [ ] Embeddings MiniLM + sqlite vector retrieve
- [ ] UI attach file di ChatInput → path ke file_reader / RAG
- [ ] Tampilkan `recommendModelTier()` di ModelsScreen sebelum download

## Minggu 2

- [ ] Whisper STT loop (whisper.rn sudah di deps)
- [ ] Voice-to-voice: VAD → STT → LLM stream → TTS auto
- [ ] Vision: Moondream / Llava Q4 + attach image

## Minggu 3

- [ ] Jadwal sholat lib `adhan` + kiblat kompas
- [ ] Export chat PDF/TXT, search history, pin
- [ ] Privacy: enforce block network flag
- [ ] UI AMOLED + bubble polish

## Positioning Play Store

- Keyword: AI offline baca PDF, AI tanpa internet Indonesia, chat PDF offline
- Klaim minggu 1: **PocketPal tidak baca PDF lokal — Box AI punya file_reader + RAG pipeline**
