import type {RemoteModel} from './types';

/**
 * List .gguf siblings for a Hugging Face model repo id.
 * Example: Qwen/Qwen2-0.5B-Instruct-GGUF
 */
export async function fetchHFModels(
  repoId: string = 'Qwen/Qwen2-0.5B-Instruct-GGUF',
  token?: string,
): Promise<RemoteModel[]> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'BoxAI-Connector',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://huggingface.co/api/models/${repoId}`, {
    headers,
  });
  if (!res.ok) {
    throw new Error(`HF model ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const siblings: any[] = data.siblings || [];
  return siblings
    .filter(
      (s: any) =>
        typeof s.rfilename === 'string' &&
        s.rfilename.toLowerCase().endsWith('.gguf'),
    )
    .map((s: any) => ({
      name: s.rfilename.split('/').pop() || s.rfilename,
      url: `https://huggingface.co/${repoId}/resolve/main/${s.rfilename}`,
      size: s.size ?? 0,
      source: 'huggingface' as const,
    }));
}
