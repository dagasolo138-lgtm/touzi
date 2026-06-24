import { describe, expect, it } from 'vitest';
import { buildPortfolio } from '../positionEngine.js';

const fund = { code: '000001', name: '测试基金', category: 'A股' };
const navMap = { '000001': { nav: 2, date: '2024-01-10' } };

describe('positionEngine fee accounting', () => {
  it('includes buy fee in average cost', () => {
    const portfolio = buildPortfolio([fund], [{ fundCode: '000001', type: 'buy', date: '2024-01-01', amountCents: 10000, feeCents: 100, shares: 100 }], navMap);
    expect(portfolio.holdings[0].totalCost).toBe(10100);
    expect(portfolio.holdings[0].avgCost).toBeCloseTo(1.01);
  });

  it('subtracts sell fee from realized pnl', () => {
    const txs = [
      { fundCode: '000001', type: 'buy', date: '2024-01-01', amountCents: 10000, feeCents: 100, shares: 100 },
      { fundCode: '000001', type: 'sell', date: '2024-01-02', amountCents: 6000, feeCents: 50, shares: 50 },
    ];
    const portfolio = buildPortfolio([fund], txs, navMap);
    expect(portfolio.holdings[0].realizedPnl).toBe(900);
  });

  it('keeps total pnl correct after full sale', () => {
    const txs = [
      { fundCode: '000001', type: 'buy', date: '2024-01-01', amountCents: 10000, feeCents: 100, shares: 100 },
      { fundCode: '000001', type: 'sell', date: '2024-01-02', amountCents: 12000, feeCents: 100, shares: 100 },
    ];
    const portfolio = buildPortfolio([fund], txs, navMap);
    expect(portfolio.totalRealizedPnl).toBe(1800);
    expect(portfolio.totalPnl).toBe(1800);
  });

  it('handles multiple buys and partial sell with different fees', () => {
    const txs = [
      { fundCode: '000001', type: 'buy', date: '2024-01-01', amountCents: 10000, feeCents: 100, shares: 100 },
      { fundCode: '000001', type: 'buy', date: '2024-01-02', amountCents: 22000, feeCents: 220, shares: 200 },
      { fundCode: '000001', type: 'sell', date: '2024-01-03', amountCents: 13000, feeCents: 80, shares: 100 },
    ];
    const portfolio = buildPortfolio([fund], txs, navMap);
    expect(portfolio.holdings[0].realizedPnl).toBe(2147);
    expect(portfolio.holdings[0].totalCost).toBe(21547);
  });
});
