import { describe, expect, it, vi } from 'vitest';

vi.mock('../deepseek.js', () => ({
  estimateCost: () => 0.01,
  chatCompletion: vi.fn(async ({ systemPrompt }) => {
    if (systemPrompt.includes('riskReviewer')) return { content: JSON.stringify({ agent: 'riskReviewer', verdict: 'insufficient_for_action', summary: 'risk', blockingRisks: [], requiredCaveats: [], conflicts: [], invalidInferences: [], permittedConclusionScope: 'research_priority_only' }), usage: { prompt_tokens: 1, completion_tokens: 1 } };
    return { content: JSON.stringify({ agent: 'quantitativeAnalyst', summary: 'q', confirmedFacts: [], quantitativeFindings: [], risks: [], uncertainties: [], researchPriorities: [], dataGaps: [] }), usage: { prompt_tokens: 1, completion_tokens: 1 } };
  }),
  streamWithTools: vi.fn(async ({ onChunk }) => { onChunk?.({ type: 'text', content: JSON.stringify({ agent: 'factResearcher', summary: 'f', externalFacts: [], conflictingEvidence: [], unavailableData: [], sources: [] }) }); return { prompt_tokens: 1, completion_tokens: 1 }; }),
  streamChatCompletion: vi.fn(async ({ onChunk }) => { onChunk?.({ type: 'text', content: '# 已确认事实\n降级报告' }); return { usage: { prompt_tokens: 1, completion_tokens: 1 } }; }),
}));

import { runCollaboration } from '../collaborationEngine.js';

const packet = { asOfDate: '2024-01-01', generatedAt: 'x', dataQuality: {}, portfolio: { holdings: [] }, categoryBreakdown: {}, factorSnapshots: [], performanceLimitation: { performanceMethod: 'non_twr' }, knownLimitations: [] };

describe('runCollaboration scheduling', () => {
  it('starts quantitative and fact before risk, and chief after risk', async () => {
    const events = [];
    const result = await runCollaboration({ question: 'q', researchPacket: packet, onEvent: (e) => events.push(e) });
    const start = (id) => events.findIndex((e) => e.type === 'agent_start' && e.agentId === id);
    const done = (id) => events.findIndex((e) => e.type === 'agent_done' && e.agentId === id);
    expect(start('quantitativeAnalyst')).toBeGreaterThan(-1);
    expect(start('factResearcher')).toBeGreaterThan(-1);
    expect(start('riskReviewer')).toBeGreaterThan(done('quantitativeAnalyst'));
    expect(start('riskReviewer')).toBeGreaterThan(done('factResearcher'));
    expect(start('chiefAnalyst')).toBeGreaterThan(done('riskReviewer'));
    expect(result.finalContent).toContain('降级报告');
  });
});
