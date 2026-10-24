/**
 * Local RAG pipeline for Box AI — chunk, store, retrieve (in-memory v1).
 * Persist to SQLite/vector in a later pass; API stays stable.
 */

export type RagChunk = {
  id: string;
  sourcePath: string;
  sourceName: string;
  text: string;
  index: number;
};

export type RagDocument = {
  id: string;
  path: string;
  name: string;
  chunkIds: string[];
  addedAt: string;
};

const docs = new Map<string, RagDocument>();
const chunks = new Map<string, RagChunk>();

export function chunkText(
  text: string,
  size = 800,
  overlap = 120,
): string[] {
  const out: string[] = [];
  if (!text) return out;
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + size));
    i += Math.max(size - overlap, 1);
  }
  return out;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Simple lexical score (no embedding model required yet). */
export function scoreChunk(query: string, text: string): number {
  const q = new Set(tokenize(query));
  if (!q.size) return 0;
  const t = tokenize(text);
  let hit = 0;
  for (const w of t) if (q.has(w)) hit++;
  return hit / q.size;
}

export function ingestText(path: string, name: string, text: string): RagDocument {
  const id = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const parts = chunkText(text);
  const chunkIds: string[] = [];
  parts.forEach((part, index) => {
    const cid = `${id}-${index}`;
    chunks.set(cid, {
      id: cid,
      sourcePath: path,
      sourceName: name,
      text: part,
      index,
    });
    chunkIds.push(cid);
  });
  const doc: RagDocument = {
    id,
    path,
    name,
    chunkIds,
    addedAt: new Date().toISOString(),
  };
  docs.set(id, doc);
  return doc;
}

export function retrieve(query: string, topK = 4): RagChunk[] {
  const scored = Array.from(chunks.values())
    .map(c => ({c, s: scoreChunk(query, c.text)}))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, topK)
    .map(x => x.c);
  return scored;
}

export function listDocuments(): RagDocument[] {
  return Array.from(docs.values());
}

export function clearRag(): void {
  docs.clear();
  chunks.clear();
}

export function buildContextBlock(query: string, topK = 4): string {
  const hits = retrieve(query, topK);
  if (!hits.length) return '';
  return hits
    .map(
      (h, i) =>
        `[${i + 1}] (${h.sourceName} #${h.index})\n${h.text}`,
    )
    .join('\n\n');
}
