import DeviceInfo from 'react-native-device-info';

export type ModelTier = 'tiny' | 'small' | 'medium' | 'large';

export type ModelRecommendation = {
  totalMemoryGB: number;
  tier: ModelTier;
  maxParamsLabel: string;
  examples: string[];
  warning?: string;
};

/**
 * Recommend a safe on-device model size from device RAM.
 * Prevents users with 3–4GB phones from loading 7B+ models that OOM.
 */
export async function recommendModelTier(): Promise<ModelRecommendation> {
  let bytes = 4 * 1024 ** 3;
  try {
    bytes = await DeviceInfo.getTotalMemory();
  } catch {
    // fallback 4GB assumption
  }
  const gb = bytes / 1024 ** 3;

  if (gb < 4) {
    return {
      totalMemoryGB: gb,
      tier: 'tiny',
      maxParamsLabel: '≤ 1–2B Q4',
      examples: ['Gemma 2 2B Q4', 'Qwen2.5 1.5B Q4', 'SmolLM 1.7B'],
      warning: 'RAM rendah — hindari model >2B. Tutup app lain sebelum load.',
    };
  }
  if (gb < 6) {
    return {
      totalMemoryGB: gb,
      tier: 'small',
      maxParamsLabel: '≤ 3–4B Q4',
      examples: ['Phi-3 Mini 3.8B Q4', 'Llama 3.2 3B Q4', 'Gemma 2 2B'],
    };
  }
  if (gb < 10) {
    return {
      totalMemoryGB: gb,
      tier: 'medium',
      maxParamsLabel: '≤ 7–8B Q4',
      examples: ['Llama 3.1 8B Q4', 'Qwen2.5 7B Q4', 'Mistral 7B Q4'],
    };
  }
  return {
    totalMemoryGB: gb,
    tier: 'large',
    maxParamsLabel: '≤ 12–14B Q4 (hati-hati panas)',
    examples: ['Mistral Nemo 12B Q4', 'Llama 3.1 8B Q5', 'Qwen2.5 14B Q3'],
  };
}

export function formatRecommendation(r: ModelRecommendation): string {
  const lines = [
    `RAM perangkat ≈ ${r.totalMemoryGB.toFixed(1)} GB`,
    `Rekomendasi: ${r.maxParamsLabel} (tier ${r.tier})`,
    `Contoh: ${r.examples.join(', ')}`,
  ];
  if (r.warning) lines.push(`Peringatan: ${r.warning}`);
  return lines.join('\n');
}
