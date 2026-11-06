// USD per 1M tokens [input, output]. Estimates only: shown as "n/a" for models not listed here.
const PRICES: Record<string, [number, number]> = {
  'openai:gpt-4.1-mini': [0.4, 1.6],
  'openai:gpt-4.1': [2, 8],
  'openai:gpt-4o-mini': [0.15, 0.6],
  'openai:gpt-4o': [2.5, 10],
  'anthropic:claude-haiku-4-5': [1, 5],
  'anthropic:claude-sonnet-4-5': [3, 15],
  'groq:openai/gpt-oss-120b': [0.15, 0.75],
  'groq:openai/gpt-oss-20b': [0.1, 0.5],
};

export function estimateCostUsd(provider: string, model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  const p = PRICES[`${provider}:${model}`];
  if (!p || inputTokens == null || outputTokens == null) return null;
  return (inputTokens * p[0] + outputTokens * p[1]) / 1_000_000;
}
