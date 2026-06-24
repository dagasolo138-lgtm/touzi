import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { mergeAgentSettings } from '../index.js';
import { DEFAULT_COLLABORATION_PROMPTS } from '../../services/collaborationPrompts.js';

describe('config merge', () => {
  it('safely merges old config without agentSettings', () => {
    const merged = mergeAgentSettings(undefined);
    expect(merged.mode2.factSearchLimit).toBe(6);
    expect(merged.mode2.prompts.chiefAnalyst).toBe(DEFAULT_COLLABORATION_PROMPTS.chiefAnalyst);
  });
});
