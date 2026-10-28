# Box AI Rebrand Status

Executed against checklist: PocketPal AI → Box AI

## Done

### Phase 1 — Identity
- [x] `app.json` — name BoxAI, displayName Box AI, slug box-ai, iOS/Android package `com.v1byte.boxai`
- [x] `package.json` — name `box-ai`, version `0.1.0`, description, repository URL
- [x] Android `applicationId` + `namespace` → `com.v1byte.boxai`
- [x] iOS `PRODUCT_BUNDLE_IDENTIFIER` → `com.v1byte.boxai`
- [x] Deep link scheme → `boxai://`
- [x] App display name → Box AI (Android strings + iOS)
- [x] Launcher icons / in-app logos (cube logo)
- [x] `.env.example` cleaned; PalsHub off by default; `HUGGINGFACE_TOKEN` optional

### Phase 2 — Code cleanup
- [x] `src/config/urls.ts` → repo URL Box-Ai
- [x] `src/constants/app.ts` — BOX_AI_NAME / package / scheme
- [x] User-facing PocketPal strings in `src/` (npm `@pocketpalai/*` packages left intact)
- [x] DB name → `boxai`
- [x] README clone URL + badges pointed to this repo
- [x] PalsHub feature flags default `false` in `.env.example`

### Phase 3 — Differentiation
- [x] Theme accent secondary → cyan `#00C2FF` (Box identity)
- [x] New talent: **weather** (Open-Meteo, no API key)

### Phase 4 — Build notes (manual by you)
- [ ] Generate new Android keystore (`keytool`) — do not reuse pocketpal keystore
- [ ] New `google-services.json` if using Firebase
- [ ] Apple Developer: register `com.v1byte.boxai`, new provisioning
- [ ] Store listing copy + screenshots from your own Box AI build

### Phase 5 — Legal
- [x] MIT attribution to PocketPal AI in README

## Not fully automated (safe defaults)
- Native folder still named `ios/PocketPal` (renaming Xcode project is high-risk; display name & bundle id are Box AI)
- Upstream device-rules CDN URLs still point at a-ghorbani CDN (shared data; optional later)
- E2E / fastlane metadata may still mention upstream paths — update when you ship store builds
- Full disable of PalsHub code paths: flag is off; full code removal is optional

## Quick verify
```bash
yarn install
yarn lint
yarn typecheck
# Android
yarn android
```
