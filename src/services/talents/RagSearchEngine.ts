import type {
  TalentEngine,
  TalentResult,
  ToolDefinition,
  TalentExecuteContext,
} from './types';
import {buildContextBlock, ingestText, listDocuments} from '../rag';

export class RagSearchEngine implements TalentEngine {
  readonly name = 'rag_search';
  readonly recommendedContextTokens = 4096;

  async execute(
    args: Record<string, any>,
    _ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const action = typeof args.action === 'string' ? args.action : 'search';

    if (action === 'ingest') {
      const path = typeof args.path === 'string' ? args.path : '';
      const name =
        typeof args.name === 'string'
          ? args.name
          : path.split('/').pop() || 'document';
      const text = typeof args.text === 'string' ? args.text : '';
      if (!text.trim()) {
        return {
          type: 'error',
          summary: 'rag_search: text required for ingest',
          errorMessage: 'missing text',
        };
      }
      const doc = ingestText(path || name, name, text);
      return {
        type: 'text',
        summary: `Ingested "${doc.name}" → ${doc.chunkIds.length} chunks (local RAG).`,
      };
    }

    if (action === 'list') {
      const docs = listDocuments();
      if (!docs.length) {
        return {
          type: 'text',
          summary: 'RAG store empty. Ingest a document first.',
        };
      }
      return {
        type: 'text',
        summary: docs
          .map(d => `• ${d.name} (${d.chunkIds.length} chunks) @ ${d.addedAt}`)
          .join('\n'),
      };
    }

    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      return {
        type: 'error',
        summary: 'rag_search: query required',
        errorMessage: 'missing query',
      };
    }
    const block = buildContextBlock(query, 4);
    if (!block) {
      return {
        type: 'text',
        summary: 'No relevant chunks found in local RAG store.',
      };
    }
    return {
      type: 'text',
      summary: `Relevant excerpts for "${query}":\n\n${block}`,
    };
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'rag_search',
        description:
          'Local document RAG: ingest text, list docs, or search chunks on-device (no cloud).',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['search', 'ingest', 'list'],
            },
            query: {type: 'string'},
            text: {type: 'string', description: 'Full text to ingest'},
            path: {type: 'string'},
            name: {type: 'string'},
          },
          required: ['action'],
        },
      },
    };
  }
}
