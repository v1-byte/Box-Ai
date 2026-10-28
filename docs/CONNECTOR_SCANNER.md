# Box-AI Full Scanner & Connector Pack

Anti-duplicate local model scan + remote connectors (GitHub / Cloudflared / R2 / Hugging Face).

## Local scanner

```ts
import {scanAllModels, isModelAlreadyLocal, linkModelToBoxAI} from '../services/modelScanner';

const local = await scanAllModels();
// Dedupes by name+size across Download, PocketPal, BoxAI, Documents, …

const hit = await isModelAlreadyLocal('qwen2-0.5b.gguf');
if (hit) {
  // Use hit.path — do not download again
}
```

## Connectors

```ts
import {getAllRemoteModels, fetchByMode} from '../services/connectors';

const remote = await getAllRemoteModels({
  githubRepo: 'v1-byte/Box-Ai',
  cloudflaredUrl: process.env.CLOUDFLARE_TUNNEL_URL,
  r2Url: 'https://<bucket>.r2.dev',
  hfRepo: 'Qwen/Qwen2-0.5B-Instruct-GGUF',
});
```

Before download, always call `isModelAlreadyLocal(name, size)`.

## Android permissions

RN app and BoxAI-Android request `MANAGE_EXTERNAL_STORAGE` / media read so the scanner can see shared folders. User is prompted once for “All files access” on Android 11+.

## R2 upload helper

```bash
node scripts/upload-model-to-r2.js ./qwen2-0.5b.gguf
```

Serve a `manifest.json` from the tunnel or public R2 URL listing `{name, url, size}`.

## Flow

1. Open Models → `scanAllModels()`
2. Same file in PocketPal + BoxAI → one entry, `isDuplicate`
3. GitHub/HF download blocked if name+size already local
4. Saves multi-GB storage
