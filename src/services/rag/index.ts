/**
 * Local RAG pipeline scaffold for Box AI (PDF/TXT chat).
 *
 * Planned stages:
 * 1. Ingest — document picker + text extract (PDF later)
 * 2. Chunk — fixed-size overlapping windows
 * 3. Embed — all-MiniLM-L6-v2 Q4 (or similar) on-device
 * 4. Store — sqlite / vector table local
 * 5. Retrieve — top-k cosine similarity → inject into LLM context
 *
 * See ROADMAP_ID.md. FileReaderEngine is the first LLM tool hook.
 */

export type RagChunk = {
  id: string;
  sourcePath: string;
  text: string;
  index: number;
};

export function chunkText(
  text: string,
  size = 800,
  overlap = 120,
): string[] {
  const chunks: string[] = [];
  if (!text) return chunks;
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += Math.max(size - overlap, 1);
  }
  return chunks;
}
