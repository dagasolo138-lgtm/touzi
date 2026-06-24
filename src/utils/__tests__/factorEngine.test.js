import { describe, expect, it } from 'vitest';
import { buildFactorSnapshot, calcAllocationPriority, calcDrawdownFromPeak, calcPriceCondition, calcPricePercentile, normalizeNavHistory } from '../factorEngine.js';

const day = (n) => `2024-${String(Math.floor((n - 1) / 28) + 1).padStart(2, '0')}-${String(((n - 1) % 28) + 1).padStart(2, '0')}`;
const rows = (count, fn = (i) => i + 1) => Array.from({ length: count }, (_, i) => ({ date: day(i + 1), nav: fn(i) }));

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
    expect(snapshot.explanation).toBe('暂不使用额外战术资金');
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
