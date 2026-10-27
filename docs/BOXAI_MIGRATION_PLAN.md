# Box-Ai UI on PocketPal System — Migration Plan

## Target

Use PocketPal AI as the React Native application/system base. Keep Box-Ai's attached WebView UI as the visual and interaction reference, and map every implemented Box-Ai UI control to PocketPal's stores/services rather than duplicating backend state. The repository target is `v1-byte/Box-Ai`.

## Source and licensing

- PocketPal AI: `https://github.com/a-ghorbani/pocketpal-ai`, MIT. Keep its upstream `LICENSE` and source notices.
- Box-Ai UI input: `Box-Ai-UI-v2_2_34-pro2(1).zip`, WebView UI only. The archive does not contain Kotlin/native/backend code. Preserve the Box-Ai MIT notice separately for the UI files.
- This port must not claim vision, voice, thermal cooling, model pause/resume, or other capability unless the selected PocketPal engine/device actually supports it.

## Integration rule

PocketPal remains the source of truth for model lifecycle, inference/completion, session persistence, Pals, talents, downloads, and voice. Box-Ai remains the source of truth for the target visual identity and requested UI affordances. Do not expose MobX objects or credentials directly to a WebView. Any cross-runtime bridge must be asynchronous, request-correlated, validated, and must keep secrets out of WebView/localStorage.

## Feature mapping and acceptance gates

| Box-Ai UI area | PocketPal system owner | Acceptance gate |
| --- | --- | --- |
| Chat, streaming, stop, new chat, history | `ChatSessionStore`, `useChatSession`, `AgentRunner`, `ModelStore` | Session persistence and chronological prompt order; cancellation and stale-stream tests; tool outcomes render without duplicates. |
| Model catalog, Hugging Face, downloads, load/use/delete | `ModelStore`, `HFStore`, `DownloadManager` | Stable model IDs/path mapping; safe gated-token handling; lifecycle/restart tests; do not show pause/resume unless truly supported. |
| Pals/personas | `PalStore`, Pal repository | Box-Ai persona CRUD/selection maps into PocketPal rich Pal model without losing prompt/settings or replacing user data. |
| Tools, web search, HTML | `TalentRegistry`, `AgentRunner`, `SearchProviderStore` | Allowlist + schema validation, consent gates, URL allowlist, HTML isolation and cancellation. |
| Voice | `ASRStore`, `TTSStore`, voice services | The supplied Box-Ai UI has no implemented voice controls. Keep voice as PocketPal capability until a Box-Ai affordance is explicitly added; no false “voice available” claim. |
| Settings, privacy, benchmark, files, thermal | `UIStore`, `BenchmarkStore`, `ModelStore`, native device/file services | Versioned import; no secret in WebView storage; measured cleanup; truthful diagnostics; offline policy enforced in request routing. |

## Phases

1. **Foundation:** preserve PocketPal source and license; add Box-Ai UI source assets and migration contract; leave upstream history available on a separate migration branch.
2. **UI host:** mount the Box-Ai presentation in the PocketPal application and establish an async, versioned bridge contract. The bridge must be a facade over PocketPal stores/services, not the previous Box-Ai native backend.
3. **Feature ports:** integrate chat/inference and model lifecycle, then Pals and tools/search, then settings/data/benchmark/file affordances.
4. **Validation:** unit tests for adapters and device tests for Android lifecycle, persistence, generation cancellation, offline privacy, storage, downloads, and supported engine/device capabilities.

## Current status

Phase 1 is underway. Box-Ai HTML/CSS/JS/logo assets are copied to `src/boxai-ui-reference/` for porting. They are not yet the active PocketPal UI, and no feature is marked migrated until a working adapter and tests exist. The integration should be reviewed and merged only after the relevant gates pass.
