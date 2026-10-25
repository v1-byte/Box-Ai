import RNFS from '@dr.pogodin/react-native-fs';
import type {RemoteModel} from './types';

/** Placeholder endpoints — override via CLOUDFLARE_TUNNEL_URL / R2 public URL. */
export const CLOUDFLARE_ENDPOINTS: string[] = [
  // 'https://models.boxai.yourdomain.com',
  // 'https://<your-r2-bucket>.r2.dev',
];

/**
 * Expects manifest.json at tunnel root:
 * [{ "name": "x.gguf", "url": "https://...", "size": 123 }]
 */
export async function fetchCloudflaredModels(
  baseUrl: string,
): Promise<RemoteModel[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/manifest.json`);
  if (!res.ok) {
    throw new Error(`Cloudflared manifest ${res.status}`);
  }
  const list = await res.json();
  if (!Array.isArray(list)) return [];
  return list.map((m: any) => ({
    name: m.name,
    url: m.url || `${baseUrl.replace(/\/$/, '')}/${m.name}`,
    size: m.size ?? 0,
    sha256: m.sha256,
    source: 'cloudflared' as const,
  }));
}

export async function downloadViaCloudflared(
  url: string,
  destPath: string,
  onProgress: (p: number) => void,
) {
  return RNFS.downloadFile({
    fromUrl: url,
    toFile: destPath,
    background: true,
    discretionary: true,
    progressDivider: 5,
    progress: res => {
      if (res.contentLength > 0) {
        onProgress(res.bytesWritten / res.contentLength);
      }
    },
  }).promise;
}
