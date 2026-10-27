import type {
  TalentEngine,
  TalentResult,
  ToolDefinition,
  TalentExecuteContext,
} from './types';

/**
 * Local file reader talent for Box AI.
 *
 * Reads text content from a local file path (TXT, MD, CSV, JSON, and
 * plain-text extracts). PDF binary extraction can be plugged in later
 * via a native module; for now PDF paths return a clear error guiding
 * the user to export text or use a pre-extracted .txt.
 *
 * Full RAG (chunk + embed + retrieve) is scaffolded in
 * `src/services/rag/` — this engine is the LLM-facing tool entrypoint.
 */
export class FileReaderEngine implements TalentEngine {
  readonly name = 'file_reader';
  readonly recommendedContextTokens = 4096;

  async execute(
    args: Record<string, any>,
    _ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const path = typeof args.path === 'string' ? args.path.trim() : '';
    const maxChars =
      typeof args.max_chars === 'number' && args.max_chars > 0
        ? Math.min(args.max_chars, 50000)
        : 12000;

    if (!path) {
      return {
        type: 'error',
        summary: 'file_reader: missing "path"',
        errorMessage: 'path argument is required (local file path)',
      };
    }

    const lower = path.toLowerCase();
    if (lower.endsWith('.pdf')) {
      return {
        type: 'error',
        summary:
          'file_reader: PDF binary extract not enabled yet. Export the PDF to TXT/MD or use the in-app RAG pipeline when available.',
        errorMessage: 'PDF extract pending',
      };
    }

    try {
      // Dynamic require so tests without native FS still load the module.

      const RNFS = require('@dr.pogodin/react-native-fs');
      const exists = await RNFS.exists(path);
      if (!exists) {
        return {
          type: 'error',
          summary: `file_reader: file not found (${path})`,
          errorMessage: 'file not found',
        };
      }
      let text: string = await RNFS.readFile(path, 'utf8');
      if (text.length > maxChars) {
        text =
          text.slice(0, maxChars) +
          `\n\n…[truncated to ${maxChars} chars; file longer]`;
      }
      const summary = `File: ${path}\n\n${text}`;
      return {type: 'text', summary};
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: `file_reader: ${errMsg}`,
        errorMessage: errMsg,
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'file_reader',
        description:
          'Read a local text file (TXT, MD, CSV, JSON, LOG) from the device and return its contents for answering questions. Prefer this over guessing about documents the user attached.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Absolute local file path on the device',
            },
            max_chars: {
              type: 'number',
              description: 'Max characters to return (default 12000)',
            },
          },
          required: ['path'],
        },
      },
    };
  }
}
