# Box AI — Roadmap ungguli PocketPal (Indonesia)

Repo: https://github.com/v1-byte/Box-Ai

## Implemented in code

| Fitur | Status | Path |
|-------|--------|------|
| file_reader | ✅ text files | `talents/FileReaderEngine.ts` |
| rag_search + in-memory RAG | ✅ ingest/search/list | `talents/RagSearchEngine.ts`, `services/rag/` |
| pickAndIngestDocument | ✅ | `services/documents/pickAndIngest.ts` |
| finance (Rp) | ✅ | `talents/FinanceEngine.ts` |
| prayer_times | ✅ offline approx | `talents/PrayerTimeEngine.ts` |
| weather | ✅ | `talents/WeatherEngine.ts` |
| image_understand | ✅ scaffold | `talents/ImageUnderstandEngine.ts` |
| Model RAM recommender + UI banner | ✅ | `modelManager/recommend.ts`, `ModelRecommendBanner` |
| Voice loop controller | ✅ orchestration | `services/voiceLoop/` |
| Chat export TXT | ✅ | `services/chatExport/exportChat.ts` |
| SHA256 verify helper | ✅ | `downloads/verifyHash.ts` |
| Privacy Dashboard | ✅ drawer | `PrivacyDashboardScreen` |
| Theme accent + AMOLED bg | ✅ | `#00C2FF`, dark bg `#000` |
| Package com.v1byte.boxai | ✅ | Android + iOS |

## Still to deepen (native / product polish)

- [ ] PDF binary → text (native module or pdf.js bridge)
- [ ] Real embeddings (MiniLM GGUF) + sqlite vector
- [ ] Wire VoiceLoopController to ASR/TTS stores in Chat UI
- [ ] Multimodal GGUF load path for vision models
- [ ] Enforce airplane-style network block for inference
- [ ] adhan + compass kiblat
- [ ] Export PDF, pin chats, FTS search history

## Claim lines (marketing)

1. **Baca dokumen lokal** — file_reader + RAG (TXT sekarang; PDF menyusul extract)
2. **Keuangan & sholat offline** — talent Indonesia
3. **Rekomendasi model dari RAM** — cegah crash HP kentang
4. **Privacy Dashboard** — bukti data tidak keluar HP
