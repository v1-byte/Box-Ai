import {fetchGithubModels} from './githubConnector';
import {fetchCloudflaredModels} from './cloudflaredConnector';
import {fetchR2Models} from './r2Connector';
import {fetchHFModels} from './huggingfaceConnector';
import type {ConnectorMode, RemoteModel} from './types';

export type {ConnectorMode, RemoteModel};

function dedupeByNameSize(models: RemoteModel[]): RemoteModel[] {
  const map = new Map<string, RemoteModel>();
  for (const m of models) {
    const k = `${m.name.toLowerCase()}-${m.size}`;
    if (!map.has(k)) map.set(k, m);
  }
  return Array.from(map.values());
}

export async function getAllRemoteModels(options?: {
  githubRepo?: string;
  cloudflaredUrl?: string;
  r2Url?: string;
  hfRepo?: string;
  githubToken?: string;
  hfToken?: string;
}): Promise<RemoteModel[]> {
  const tasks = await Promise.allSettled([
    fetchGithubModels(
      options?.githubRepo ?? 'v1-byte/Box-Ai',
      options?.githubToken,
    ),
    options?.cloudflaredUrl
      ? fetchCloudflaredModels(options.cloudflaredUrl)
      : Promise.resolve([] as RemoteModel[]),
    options?.r2Url
      ? fetchR2Models(options.r2Url)
      : Promise.resolve([] as RemoteModel[]),
    options?.hfRepo
      ? fetchHFModels(options.hfRepo, options?.hfToken)
      : Promise.resolve([] as RemoteModel[]),
  ]);

  const all: RemoteModel[] = [];
  for (const t of tasks) {
    if (t.status === 'fulfilled') all.push(...t.value);
  }
  return dedupeByNameSize(all);
}

export async function fetchByMode(
  mode: ConnectorMode,
  options?: {
    githubRepo?: string;
    cloudflaredUrl?: string;
    r2Url?: string;
    hfRepo?: string;
    githubToken?: string;
    hfToken?: string;
  },
): Promise<RemoteModel[]> {
  switch (mode) {
    case 'github':
      return fetchGithubModels(
        options?.githubRepo ?? 'v1-byte/Box-Ai',
        options?.githubToken,
      );
    case 'cloudflared':
      if (!options?.cloudflaredUrl) return [];
      return fetchCloudflaredModels(options.cloudflaredUrl);
    case 'r2':
      if (!options?.r2Url) return [];
      return fetchR2Models(options.r2Url);
    case 'huggingface':
      return fetchHFModels(
        options?.hfRepo ?? 'Qwen/Qwen2-0.5B-Instruct-GGUF',
        options?.hfToken,
      );
    default:
      return [];
  }
}

export {
  fetchGithubModels,
  fetchCloudflaredModels,
  fetchR2Models,
  fetchHFModels,
};
