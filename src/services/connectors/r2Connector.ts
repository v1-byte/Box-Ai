import type {RemoteModel} from './types';

/**
 * List models from a public Cloudflare R2 (S3-compatible) bucket.
 * For private buckets, prefer a tunnel + manifest.json (cloudflaredConnector).
 */
export async function fetchR2Models(
  bucketPublicUrl: string,
): Promise<RemoteModel[]> {
  try {
    const res = await fetch(
      `${bucketPublicUrl.replace(/\/$/, '')}/manifest.json`,
    );
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        return list.map((m: any) => ({
          name: m.name,
          url: m.url || `${bucketPublicUrl.replace(/\/$/, '')}/${m.name}`,
          size: m.size ?? 0,
          sha256: m.sha256,
          source: 'r2' as const,
        }));
      }
    }
  } catch {
    // fall through
  }

  try {
    const res = await fetch(`${bucketPublicUrl}?list-type=2`);
    if (!res.ok) return [];
    const xml = await res.text();
    const models: RemoteModel[] = [];
    const keyRe = /<Key>([^<]+\.gguf)<\/Key>/gi;
    const sizeRe = /<Size>(\d+)<\/Size>/gi;
    const keys: string[] = [];
    const sizes: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = keyRe.exec(xml))) keys.push(m[1]);
    while ((m = sizeRe.exec(xml))) sizes.push(Number(m[1]));
    keys.forEach((name, i) => {
      models.push({
        name: name.split('/').pop() || name,
        url: `${bucketPublicUrl.replace(/\/$/, '')}/${name}`,
        size: sizes[i] ?? 0,
        source: 'r2',
      });
    });
    return models;
  } catch {
    return [];
  }
}
