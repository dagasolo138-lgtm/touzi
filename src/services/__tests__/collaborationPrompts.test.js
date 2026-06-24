import { describe, expect, it } from 'vitest';
import { buildAgentSystemPrompt, DEFAULT_COLLABORATION_PROMPTS, mergeMode2Prompts } from '../collaborationPrompts.js';
import { createSearchLimiter } from '../collaborationEngine.js';

describe('collaboration prompts', () => {
  it('safely restores default mode2 prompts', () => {
    const merged = mergeMode2Prompts({ quantitativeAnalyst: 'custom' });
    expect(merged.quantitativeAnalyst).toBe('custom');
    expect(merged.factResearcher).toBe(DEFAULT_COLLABORATION_PROMPTS.factResearcher);
  });

  it('adds no-funding-action constraint when risk is insufficient', () => {
    const prompt = buildAgentSystemPrompt('chiefAnalyst', 'chief', { riskVerdict: 'insufficient_for_action' });
    expect(prompt).toContain('禁止给具体金额、比例、买卖动作');
  });

  it('blocks searches over factSearchLimit', async () => {
    const limiter = createSearchLimiter(1);
    await expect(limiter('a', 'news', '')).rejects.toThrow();
    await expect(limiter('b', 'news', '')).rejects.toThrow('FACT_SEARCH_LIMIT_EXCEEDED');
  });
});
