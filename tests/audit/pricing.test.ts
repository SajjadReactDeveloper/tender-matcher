import { describe, expect, test } from 'vitest';
import { estimateCostUsd } from '@/audit/pricing';

describe('estimateCostUsd', () => {
  test('prices a known model per million tokens and returns null for unknown models or missing token counts', () => {
    expect(estimateCostUsd('openai', 'gpt-4.1-mini', 1_000_000, 0)).toBeCloseTo(0.4, 6);
    expect(estimateCostUsd('openai', 'gpt-4.1-mini', 0, 1_000_000)).toBeCloseTo(1.6, 6);
    expect(estimateCostUsd('groq', 'some-new-model', 10, 10)).toBeNull();
    expect(estimateCostUsd('openai', 'gpt-4.1-mini', null, 5)).toBeNull();
  });
});
