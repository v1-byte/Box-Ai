/**
 * Universal on-device GGUF scanner — Pocket AI, Box AI, Download, /model ai/, other apps.
 * Used by Models "Terunduh" so multi-model files are listed without re-download.
 */
import RNFS from '@dr.pogodin/react-native-fs';

export type ExternalModelSource =
  | 'pocketai'
  | 'boxai'
  | 'download'
  | 'external'
  | 'other_app'
  | 'local';

export type FoundExternalModel = {
  id: string;
  name: string;
  path: string;
  size: number;
  source: ExternalModelSource;
  family: string;
};

/** Folders to scan (Android). Requires storage / all-files permission for Android/data. */
export function getScanRoots(): string[] {
  const base = RNFS.ExternalStorageDirectoryPath || '/storage/emulated/0';
  const doc = RNFS.DocumentDirectoryPath;
  return [
    `${doc}/models`,
    doc,
    `${base}/Android/data/com.pocketai/files/models`,
    `${base}/Android/data/com.pocketai/files`,
    `${base}/Android/data/com.pocketai.app/files/models`,
    `${base}/Android/data/com.pocketai.app/files`,
    `${base}/Android/data/com.pocketpal/files/models`,
    `${base}/Android/data/com.pocketpalai/files/models`,
    `${base}/Android/data/ai.pocketpal/files/models`,
    `${base}/Android/data/com.lokalai/files`,
    `${base}/Android/data/ai.mlc.mlc-llm/files`,
    `${base}/Android/data/com.boxai.app/files/models`,
    `${base}/model ai`,
    `${base}/model ai/qwen`,
    `${base}/model ai/gemma`,
    `${base}/model ai/llama`,
    `${base}/model ai/phi`,
    `${base}/model ai/mistral`,
    `${base}/Models`,
    `${base}/Models/qwen`,
    `${base}/Models/gemma`,
    `${base}/Models/llama`,
    `${base}/Download/BoxAI-Models`,
    `${base}/Download/Models-AI`,
    `${base}/Download`,
    `${base}/Downloads`,
    `${base}/Documents`,
    `${base}/GGUF`,
    `${base}/BoxAI`,
  ];
}

const QUANT_TAIL =
  /(?:q[2-8](?:_[kKsSmM]+)?(?:_[mMsS])?|iq[1-4]_[a-z0-9]+|f16|f32|bf16)\.?$/i;

/** Fix truncated names like `...q4_k_m.` → `...q4_k_m.gguf` */
export function normalizeGgufName(name: string): string {
  let n = name.trim();
  if (/\.gguf$/i.test(n)) return n;
  // ends with quant and missing/truncated extension
  if (QUANT_TAIL.test(n) || /\.$/.test(n)) {
    n = n.replace(/\.$/, '');
    if (!/\.gguf$/i.test(n)) n = `${n}.gguf`;
  }
  return n;
}

export function detectFamily(name: string): string {
  const l = name.toLowerCase();
  if (l.includes('qwen')) return 'qwen';
  if (l.includes('gemma')) return 'gemma';
  if (l.includes('llama') || l.includes('llava')) return 'llama';
  if (l.includes('phi')) return 'phi';
  if (l.includes('mistral') || l.includes('mixtral')) return 'mistral';
  if (l.includes('deepseek')) return 'deepseek';
  if (l.includes('yi-') || l.startsWith('yi_')) return 'yi';
  return (l.split(/[-_.]/)[0] || 'other').replace(/[^a-z0-9]/g, '') || 'other';
}

export function detectSource(path: string): ExternalModelSource {
  const p = path.toLowerCase();
  if (p.includes('pocketai') || p.includes('pocketpal')) return 'pocketai';
  if (p.includes('android/data')) return 'other_app';
  if (p.includes('/download')) return 'download';
  if (p.includes('model ai') || p.includes('/models')) return 'external';
  if (p.includes('boxai')) return 'boxai';
  return 'local';
}

const MIN_BYTES = 50 * 1024 * 1024; // 50MB

async function tryRenameTruncated(filePath: string, name: string): Promise<{path: string; name: string}> {
  const fixed = normalizeGgufName(name);
  if (fixed === name) return {path: filePath, name};
  if (!/\.gguf$/i.test(fixed)) return {path: filePath, name};
  const dir = filePath.slice(0, filePath.lastIndexOf('/') + 1);
  const dest = dir + fixed;
  try {
    if (!(await RNFS.exists(dest))) {
      await RNFS.moveFile(filePath, dest);
      return {path: dest, name: fixed};
    }
  } catch {
    // no write permission — still report with logical name
  }
  return {path: filePath, name: fixed};
}

function looksLikeModelFile(name: string, size: number): boolean {
  if (size < MIN_BYTES) return false;
  if (/\.gguf$/i.test(name)) return true;
  // truncated: ends with quant code or trailing dot
  if (QUANT_TAIL.test(name) || /\.$/.test(name)) return true;
  return false;
}

async function scanDir(
  dir: string,
  depth: number,
  out: FoundExternalModel[],
  seenPath: Set<string>,
): Promise<void> {
  if (depth < 0) return;
  try {
    if (!(await RNFS.exists(dir))) return;
    const entries = await RNFS.readDir(dir);
    for (const e of entries) {
      try {
        if (e.isFile() && looksLikeModelFile(e.name, e.size)) {
          const key = e.path;
          if (seenPath.has(key)) continue;
          seenPath.add(key);
          const {path, name} = await tryRenameTruncated(e.path, e.name);
          const id = `${name.toLowerCase()}-${e.size}`;
          out.push({
            id,
            name,
            path,
            size: e.size,
            source: detectSource(path),
            family: detectFamily(name),
          });
        } else if (e.isDirectory() && !e.name.startsWith('.')) {
          if (e.name.toLowerCase() === 'cache' && depth < 2) continue;
          await scanDir(e.path, depth - 1, out, seenPath);
        }
      } catch {
        /* skip entry */
      }
    }
  } catch {
    /* no permission / missing */
  }
}

/** Scan all roots; dedupe by filename keep largest. */
export async function scanAllAiModels(): Promise<FoundExternalModel[]> {
  const roots = getScanRoots();
  const raw: FoundExternalModel[] = [];
  const seenPath = new Set<string>();

  for (const root of roots) {
    const depth =
      root.includes('Android/data') ? 3 : root.toLowerCase().includes('download') ? 2 : 3;
    await scanDir(root, depth, raw, seenPath);
  }

  const best = new Map<string, FoundExternalModel>();
  for (const m of raw) {
    const k = m.name.toLowerCase();
    const prev = best.get(k);
    if (!prev || m.size > prev.size) best.set(k, m);
  }

  return Array.from(best.values()).sort((a, b) => {
    const fa = a.family.localeCompare(b.family);
    return fa !== 0 ? fa : a.name.localeCompare(b.name);
  });
}

export function groupModelsByFamily(
  models: FoundExternalModel[],
): Record<string, FoundExternalModel[]> {
  const g: Record<string, FoundExternalModel[]> = {};
  for (const m of models) {
    if (!g[m.family]) g[m.family] = [];
    g[m.family].push(m);
  }
  return g;
}
