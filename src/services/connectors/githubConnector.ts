import type {RemoteModel} from './types';

/**
 * Fetch .gguf assets from GitHub Releases of a repo (default: v1-byte/Box-Ai).
 */
export async function fetchGithubModels(
  repo: string = 'v1-byte/Box-Ai',
  token?: string,
): Promise<RemoteModel[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'BoxAI-Connector',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${repo}/releases`, {
    headers,
  });
  if (!res.ok) {
    throw new Error(`GitHub releases ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const models: RemoteModel[] = [];
  for (const rel of data) {
    for (const asset of rel.assets || []) {
      if (typeof asset.name === 'string' && asset.name.endsWith('.gguf')) {
        models.push({
          name: asset.name,
          url: asset.browser_download_url,
          size: asset.size ?? 0,
          source: 'github',
        });
      }
    }
  }
  return models;
}
