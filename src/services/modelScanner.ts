import * as RNFS from '@dr.pogodin/react-native-fs';

/**
 * Full-device model scanner — finds .gguf/.bin/.onnx across common
 * app and public folders so the same model is never downloaded twice.
 */
export const SCAN_DIRS = [
  `${RNFS.DocumentDirectoryPath}/models`,
  RNFS.DocumentDirectoryPath,
  RNFS.DownloadDirectoryPath,
  `${RNFS.ExternalStorageDirectoryPath}/Download`,
  `${RNFS.ExternalStorageDirectoryPath}/Documents`,
  `${RNFS.ExternalStorageDirectoryPath}/Documents/PocketPalModels`,
  `${RNFS.ExternalStorageDirectoryPath}/PocketPal`,
  `${RNFS.ExternalStorageDirectoryPath}/BoxAI`,
  `${RNFS.ExternalStorageDirectoryPath}/Qwen`,
  '/storage/emulated/0/Download',
  '/storage/emulated/0/Documents',
];

export type FoundModel = {
  id: string;
  name: string;
  path: string;
  size: number;
  source: 'boxai' | 'pocketpal' | 'download' | 'github' | 'r2' | 'hf' | 'local';
  isDuplicate: boolean;
};

function detectSource(dir: string): FoundModel['source'] {
  const d = dir.toLowerCase();
  if (d.includes('pocketpal')) return 'pocketpal';
  if (d.includes('download')) return 'download';
  if (d.includes('boxai') || d.includes('models')) return 'boxai';
  return 'local';
}

export async function scanAllModels(): Promise<FoundModel[]> {
  const seenSizeName = new Map<string, FoundModel>();
  const results: FoundModel[] = [];

  for (const dir of SCAN_DIRS) {
    try {
      if (!(await RNFS.exists(dir))) continue;
      const list = await RNFS.readDir(dir);
      for (const f of list) {
        if (!f.isFile() || !f.name.match(/\.(gguf|bin|onnx)$/i)) continue;
        const key = `${f.name.toLowerCase()}-${f.size}`;
        if (seenSizeName.has(key)) {
          const existing = seenSizeName.get(key)!;
          existing.isDuplicate = true;
          continue;
        }
        const item: FoundModel = {
          id: key,
          name: f.name,
          path: f.path,
          size: f.size,
          source: detectSource(dir),
          isDuplicate: false,
        };
        seenSizeName.set(key, item);
        results.push(item);
      }
    } catch {
      // permission / missing path — skip quietly
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/** Prefer existing path; avoid physical copy when model already on device. */
export async function linkModelToBoxAI(found: FoundModel): Promise<string> {
  const dest = `${RNFS.DocumentDirectoryPath}/models/${found.name}`;
  if (await RNFS.exists(dest)) return dest;
  // Reference only — no duplicate file on disk
  return found.path;
}

/** True if a remote model name+size already exists locally. */
export async function isModelAlreadyLocal(
  name: string,
  size?: number,
): Promise<FoundModel | undefined> {
  const existing = await scanAllModels();
  return existing.find(
    e =>
      e.name.toLowerCase() === name.toLowerCase() &&
      (size == null || e.size === size),
  );
}
