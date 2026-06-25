import { describe, expect, it } from 'vitest';
import { buildFactorSnapshot, calcAllocationPriority, calcDrawdownFromPeak, calcPriceCondition, calcPricePercentile, mergeFactorSettings, normalizeNavHistory, suggestDcaMultiplier, evaluateHoldingWarning } from '../factorEngine.js';

const day = (n) => `2024-${String(Math.floor((n - 1) / 28) + 1).padStart(2, '0')}-${String(((n - 1) % 28) + 1).padStart(2, '0')}`;
const rows = (count, fn = (i) => i + 1) => Array.from({ length: count }, (_, i) => ({ date: day(i + 1), nav: fn(i) }));

describe('evaluateHoldingWarning', () => {
  it('returns observation when losing at a high percentile', () => {
    expect(evaluateHoldingWarning({ pnlPct: -0.2, percentile: 0.7, drawdown: -0.05 })).toMatchObject({ type: 'loss_high_percentile', severity: 'observation' });
  });

  it('returns observation when gains are large at a high percentile', () => {
    expect(evaluateHoldingWarning({ pnlPct: 0.35, percentile: 0.85, drawdown: 0 })).toMatchObject({ type: 'gain_high_percentile', severity: 'observation' });
  });

  it('returns null when pnl is invalid or thresholds are not met', () => {
    expect(evaluateHoldingWarning({ pnlPct: Number.NaN, percentile: 0.9, drawdown: 0 })).toBeNull();
    expect(evaluateHoldingWarning({ pnlPct: -0.1, percentile: 0.9, drawdown: -0.1 })).toBeNull();
  });
});

describe('factorEngine', () => {
  it('normalizes nav history by sorting, deduping invalid rows, and truncating asOfDate', () => {
    const out = normalizeNavHistory([{ date: '2024-01-03', nav: 3 }, { date: '2024-01-01', nav: 1 }, { date: '2024-01-02', nav: 0 }, { date: '2024-01-03', nav: 4 }, { date: '2024-01-04', nav: 5 }], '2024-01-03');
    expect(out).toEqual([{ date: '2024-01-01', nav: 1 }, { date: '2024-01-03', nav: 4 }]);
  });

  it('calculates price percentile boundaries', () => {
    expect(calcPricePercentile(rows(5), 5)).toBe(1);
    expect(calcPricePercentile(rows(5, (i) => 5 - i), 5)).toBe(0);
  });

  it('calculates drawdown boundaries', () => {
    expect(calcDrawdownFromPeak(rows(3, (i) => [1, 2, 1][i]), 3)).toBe(-0.5);
    expect(calcDrawdownFromPeak(rows(3), 3)).toBe(0);
  });

  it('scores RSI extreme and neutral values inside price condition', () => {
    const oversold = calcPriceCondition(rows(260, (i) => 300 - i));
    const overbought = calcPriceCondition(rows(260, (i) => i + 1));
    const neutral = calcPriceCondition(rows(260, (i) => 100 + (i % 2 === 0 ? 1 : -1)));
    expect(oversold.raw.rsi).toBeLessThanOrEqual(25);
    expect(overbought.raw.rsi).toBeGreaterThanOrEqual(75);
    expect(neutral.raw.rsi).toBeGreaterThan(25);
    expect(neutral.raw.rsi).toBeLessThan(75);
  });

  it('keeps allocation priority boundary semantics', () => {
    expect(calcAllocationPriority(0, 0.1)).toBe(95);
    expect(calcAllocationPriority(0.05, 0.1)).toBe(80);
    expect(calcAllocationPriority(0.08, 0.1)).toBe(65);
    expect(calcAllocationPriority(0.1, 0.1)).toBe(50);
    expect(calcAllocationPriority(0.13, 0.1)).toBe(35);
    expect(calcAllocationPriority(0.16, 0.1)).toBe(20);
    expect(calcAllocationPriority(0.22, 0.1)).toBe(5);
  });



  it('applies different category weights to the same inputs', () => {
    const navRows = rows(260, (i) => (i < 220 ? i + 100 : 360 - i * 0.6));
    const base = { signalFundCode: '000001', navRows, actualWeight: 0.05, targetWeight: 0.25, asOfDate: day(260) };
    const aShare = buildFactorSnapshot({ ...base, category: 'A股' });
    const bond = buildFactorSnapshot({ ...base, category: '债券' });
    expect(aShare.allocationPriority).toBe(bond.allocationPriority);
    expect(aShare.priceCondition.score).not.toBe(bond.priceCondition.score);
    expect(aShare.actionPriority).not.toBe(bond.actionPriority);
  });

  it('falls back to default weights for unknown categories', () => {
    const snapshot = buildFactorSnapshot({ category: '未知', signalFundCode: '000001', navRows: rows(260), actualWeight: 0, targetWeight: 0.25, asOfDate: day(260) });
    expect(snapshot.actionPriority).not.toBeNull();
    expect(snapshot.appliedWeights).toMatchObject({ allocation: 0.65, price: 0.35, percentile: 0.45, drawdown: 0.45, rsi: 0.10 });
  });

  it('keeps default category weights when settings only override one category', () => {
    const merged = mergeFactorSettings({ categoryWeights: { A股: { allocation: 0.5 } } });
    expect(merged.categoryWeights.A股).toMatchObject({ allocation: 0.5, price: 0.35, percentile: 0.45 });
    expect(merged.categoryWeights.QDII).toMatchObject({ allocation: 0.70, price: 0.30, percentile: 0.50 });
    expect(merged.categoryWeights.债券).toBeDefined();
    expect(merged.categoryWeights.黄金).toBeDefined();
  });

  it('maps DCA multipliers for all action priority ranges', () => {
    expect(suggestDcaMultiplier(80).multiplier).toBe(1.5);
    expect(suggestDcaMultiplier(60).multiplier).toBe(1.2);
    expect(suggestDcaMultiplier(40).multiplier).toBe(1);
    expect(suggestDcaMultiplier(20).multiplier).toBe(0.8);
    expect(suggestDcaMultiplier(19).multiplier).toBe(0.5);
  });

  it('uses planned DCA amount when action priority is null', () => {
    expect(suggestDcaMultiplier(null)).toMatchObject({ multiplier: 1.0, label: '按计划执行' });
  });

  it('does not generate fake high scores when data is insufficient', () => {
    const snapshot = buildFactorSnapshot({ category: 'A股', signalFundCode: '000001', navRows: rows(20), actualWeight: 0, targetWeight: 0.25, asOfDate: day(20) });
    expect(snapshot.priceCondition.score).toBeNull();
    expect(snapshot.actionPriority).toBeNull();
    expect(snapshot.explanation).toBe('数据不足，暂不生成行动提示');
  });

  it('uses high actionPriority to mean new money is more attractive', () => {
    const snapshot = buildFactorSnapshot({ category: 'A股', signalFundCode: '000001', navRows: rows(260, (i) => (i < 220 ? i + 100 : 360 - i * 0.6)), actualWeight: 0.05, targetWeight: 0.25, asOfDate: day(260) });
    expect(snapshot.allocationPriority).toBe(95);
    expect(snapshot.actionPriority).toBeGreaterThan(60);
  });

  it('flags falling knife risk for bearish trend plus deep drawdown', () => {
    const snapshot = buildFactorSnapshot({ category: 'A股', signalFundCode: '000001', navRows: rows(260, (i) => 300 - i), actualWeight: 0, targetWeight: 0.25, asOfDate: day(260) });
    expect(snapshot.trendState.state).toBe('bearish');
    expect(snapshot.flags).toContain('FALLING_KNIFE_RISK');
    expect(snapshot.explanation).toBe('优先补足配置');
  });

  it('does not output category price state when signal fund is missing', () => {
    const snapshot = buildFactorSnapshot({ category: 'A股', signalFundCode: '', navRows: rows(260), actualWeight: 0, targetWeight: 0.25, asOfDate: day(260) });
    expect(snapshot.priceCondition.score).toBeNull();
    expect(snapshot.flags).toContain('SIGNAL_FUND_MISSING');
  });

  it('does not mutate DCA amount or transaction records inputs', () => {
    const plan = Object.freeze({ amount: 1000 });
    const tx = Object.freeze({ amount: 1000, shares: 100 });
    buildFactorSnapshot({ category: 'A股', signalFundCode: '000001', navRows: rows(260), actualWeight: 0, targetWeight: 0.25, asOfDate: day(260) });
    expect(plan.amount).toBe(1000);
    expect(tx.amount).toBe(1000);
  });
});

describe('DATA_GAP detection', () => {
  it('flags invalid nav rows', () => {
    const snapshot = buildFactorSnapshot({ category: 'A股', signalFundCode: '000001', navRows: [...rows(260), { date: '2024-10-01', nav: 0 }], asOfDate: '2024-10-01' });
    expect(snapshot.flags).toContain('DATA_GAP');
  });

  it('flags duplicate valid dates', () => {
    const navRows = [...rows(260), { date: day(260), nav: 999 }];
    const snapshot = buildFactorSnapshot({ category: 'A股', signalFundCode: '000001', navRows, asOfDate: day(260) });
    expect(snapshot.flags).toContain('DATA_GAP');
  });

  it('flags internal gaps over 14 days', () => {
    const navRows = [...rows(100)];
    const start = new Date('2025-01-16T00:00:00Z');
    for (let i = 0; i < 160; i += 1) {
      const d = new Date(start.getTime() + i * 86400000);
      navRows.push({ date: d.toISOString().slice(0, 10), nav: 200 + i });
    }
    const snapshot = buildFactorSnapshot({ category: 'A股', signalFundCode: '000001', navRows, asOfDate: '2025-06-24' });
    expect(snapshot.flags).toContain('DATA_GAP');
  });

  it('does not flag normal weekend gaps', () => {
    const navRows = [];
    const start = new Date('2024-01-01T00:00:00Z');
    for (let i = 0; navRows.length < 260; i += 1) {
      const d = new Date(start.getTime() + i * 86400000);
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) navRows.push({ date: d.toISOString().slice(0, 10), nav: 100 + navRows.length });
    }
    const snapshot = buildFactorSnapshot({ category: 'A股', signalFundCode: '000001', navRows, asOfDate: navRows.at(-1).date });
    expect(snapshot.flags).not.toContain('DATA_GAP');
  });
});
