import { describe, expect, it } from 'vitest';
import { formatFactorContextForLLM } from '../factorContext.js';

describe('formatFactorContextForLLM', () => {
  it('returns empty text for missing factor result', () => {
    expect(formatFactorContextForLLM(null)).toBe('');
  });

  it('renders a snapshot with insufficient data', () => {
    const text = formatFactorContextForLLM({ snapshots: [{ category: 'A股', allocationPriority: 50, priceCondition: { score: null }, trendState: { state: 'insufficient' }, actionPriority: null, flags: ['INSUFFICIENT_HISTORY'] }] });
    expect(text).toContain('【量化因子状态】');
    expect(text).toContain('A股: 配置优先级 50 | 价格状态 数据不足 | 趋势数据不足 | 综合 数据不足 [标记: INSUFFICIENT_HISTORY]');
  });

  it('renders a normal snapshot compactly', () => {
    const text = formatFactorContextForLLM({ snapshots: [{ category: 'QDII', allocationPriority: 80, priceCondition: { score: 35 }, trendState: { state: 'bullish' }, actionPriority: 64, flags: [] }] });
    expect(text).toContain('QDII: 配置优先级 80 | 价格状态 35 | 趋势偏强 | 综合 64');
    expect(text).toContain('60+建议谨慎追入，40-建议适度加量');
  });
});
