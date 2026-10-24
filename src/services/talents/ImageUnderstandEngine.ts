import type {
  TalentEngine,
  TalentResult,
  ToolDefinition,
  TalentExecuteContext,
} from './types';

/**
 * Vision talent scaffold. When a multimodal model (e.g. Moondream2 / LLaVA Q4)
 * is loaded, the chat layer should pass image paths into the model directly.
 * This tool records intent and returns guidance until vision runtime is wired.
 */
export class ImageUnderstandEngine implements TalentEngine {
  readonly name = 'image_understand';
  readonly recommendedContextTokens = 4096;

  async execute(
    args: Record<string, any>,
    _ctx?: TalentExecuteContext,
  ): Promise<TalentResult> {
    const path = typeof args.path === 'string' ? args.path : '';
    const question =
      typeof args.question === 'string'
        ? args.question
        : 'Describe this image.';
    if (!path) {
      return {
        type: 'error',
        summary: 'image_understand: path to image required',
        errorMessage: 'missing path',
      };
    }
    return {
      type: 'text',
      summary: [
        `Vision request queued for local multimodal model.`,
        `Image: ${path}`,
        `Question: ${question}`,
        `Load a vision GGUF (e.g. Moondream2) in Models, then attach the image in chat.`,
      ].join('\n'),
    };
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'image_understand',
        description:
          'Understand a local image with an on-device vision model (Moondream/LLaVA). Pass absolute image path.',
        parameters: {
          type: 'object',
          properties: {
            path: {type: 'string'},
            question: {type: 'string'},
          },
          required: ['path'],
        },
      },
    };
  }
}
