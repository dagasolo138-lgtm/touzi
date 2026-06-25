import { describe, expect, it } from 'vitest';
import { buildCashFlowSeries, calculateCategoryTwrSeries, calculatePeriodReturn, calculateTwrSeries, summarizeTwr } from '../twrEngine.js';

describe('twrEngine', () => {
  it('calculates simple period return with no cash flow', () => {
    expect(calculatePeriodReturn({ startValue: 10000, endValue: 11000, netExternalFlow: 0 }).returnRate).toBeCloseTo(0.1);
  });

  it('aggregates buy and sell cash flows by date', () => {
    const rows = buildCashFlowSeries([
      { type: 'buy', date: '2024-01-02', amountCents: 10000, feeCents: 100 },
      { type: 'sell', date: '2024-01-02', amountCents: 5000, feeCents: 50 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].buyFlowCents).toBe(10100);
    expect(rows[0].sellFlowCents).toBe(-4950);
    expect(rows[0].netExternalFlowCents).toBe(5150);
  });

  it('does not inflate TWR when new capital is added between snapshots', () => {
    const result = calculateTwrSeries({
      snapshots: [
        { date: '2024-01-01', totalValue: 10000 },
        { date: '2024-01-02', totalValue: 21000 },
      ],
      transactions: [{ type: 'buy', date: '2024-01-02', amountCents: 10000, feeCents: 0 }],
    });
    expect(result.status).toBe('ok');
    expect(result.cumulativeReturn).toBeCloseTo(0.1);
  });

  it('does not distort TWR when capital is withdrawn between snapshots', () => {
    const result = calculateTwrSeries({
      snapshots: [
        { date: '2024-01-01', totalValue: 10000 },
        { date: '2024-01-02', totalValue: 6000 },
      ],
      transactions: [{ type: 'sell', date: '2024-01-02', amountCents: 5000, feeCents: 0 }],
    });
    expect(result.cumulativeReturn).toBeCloseTo(0.1);
  });

  it('compounds multiple valid periods', () => {
    const result = calculateTwrSeries({ snapshots: [{ date: '2024-01-01', totalValue: 10000 }, { date: '2024-01-02', totalValue: 11000 }, { date: '2024-01-03', totalValue: 9900 }], transactions: [] });
    expect(result.cumulativeReturn).toBeCloseTo(-0.01);
  });

  it('marks insufficient data when there are fewer than two snapshots', () => {
    const summary = summarizeTwr(calculateTwrSeries({ snapshots: [{ date: '2024-01-01', totalValue: 10000 }], transactions: [] }));
    expect(summary.performanceMethod).toBe('insufficient_for_twr');
    expect(summary.reason).toBe('at_least_two_snapshots_required');
  });

  it('calculates category-level TWR using category values and fund categories', () => {
    const result = calculateCategoryTwrSeries({
      categories: ['A股', '债券'],
      funds: [{ code: '000001', category: 'A股' }, { code: '000002', category: '债券' }],
      snapshots: [
        { date: '2024-01-01', categoryBreakdown: { A股: { value: 10000 }, 债券: { value: 20000 } } },
        { date: '2024-01-02', categoryBreakdown: { A股: { value: 21000 }, 债券: { value: 21000 } } },
      ],
      transactions: [
        { fundCode: '000001', type: 'buy', date: '2024-01-02', amountCents: 10000, feeCents: 0 },
        { fundCode: '000002', type: 'buy', date: '2024-01-02', amountCents: 10000, feeCents: 0 },
      ],
    });
    expect(result['A股'].cumulativeReturn).toBeCloseTo(0.1);
    expect(result['债券'].cumulativeReturn).toBeCloseTo(-0.45);
  });

  it('uses transaction category snapshots before current fund category mapping', () => {
    const result = calculateCategoryTwrSeries({
      categories: ['A股', '债券'],
      funds: [{ code: '000001', category: '债券' }],
      snapshots: [
        { date: '2024-01-01', categoryBreakdown: { A股: { value: 10000 }, 债券: { value: 0 } } },
        { date: '2024-01-02', categoryBreakdown: { A股: { value: 21000 }, 债券: { value: 0 } } },
      ],
      transactions: [{ fundCode: '000001', category: 'A股', type: 'buy', date: '2024-01-02', amountCents: 10000, feeCents: 0 }],
    });
    expect(result['A股'].cumulativeReturn).toBeCloseTo(0.1);
    expect(result['债券'].status).toBe('insufficient_start_value');
  });

  it('skips zero-start periods but resumes once portfolio has value', () => {
    const result = calculateTwrSeries({
      snapshots: [
        { date: '2024-01-01', totalValue: 0 },
        { date: '2024-01-02', totalValue: 10000 },
        { date: '2024-01-03', totalValue: 11000 },
      ],
      transactions: [{ type: 'buy', date: '2024-01-02', amountCents: 10000, feeCents: 0 }],
    });
    expect(result.series[0].status).toBe('insufficient_start_value');
    expect(result.observationCount).toBe(1);
    expect(result.cumulativeReturn).toBeCloseTo(0.1);
  });
});
