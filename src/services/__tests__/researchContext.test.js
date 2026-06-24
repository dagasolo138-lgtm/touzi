import { describe, expect, it } from 'vitest';
import { buildResearchPacket } from '../researchContext.js';

const config = { categories: ['A股', 'QDII'], targetAllocation: { A股: 0.6, QDII: 0.4 }, factorSettings: { categorySignalFunds: { A股: '000001', QDII: '000002' }, minEffectiveNavDays: 3, staleNavDays: 3 } };
const funds = [{ code: '000001', name: 'A基金', category: 'A股' }, { code: '000002', name: 'Q基金', category: 'QDII' }];
const navRows = [
  ...Array.from({ length: 260 }, (_, i) => ({ fundCode: '000001', date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`, nav: 1 + i / 1000 })),
  { fundCode: '000001', date: '2024-12-20', nav: 2 },
  { fundCode: '000002', date: '2024-12-10', nav: 3 },
];
const transactions = [
  { fundCode: '000001', type: 'buy', date: '2024-01-01', amountCents: 10000, feeCents: 10, shares: 50 },
  { fundCode: '000002', type: 'buy', date: '2024-01-01', amountCents: 30000, feeCents: 20, shares: 100 },
];

describe('buildResearchPacket', () => {
  it('uses full portfolio and real category snapshots', () => {
    const packet = buildResearchPacket({ config, funds, transactions, navRows, dcaPlans: [{ id: 'p1' }], snapshots: [], asOfDate: '2024-12-24' });
    expect(packet.portfolio.holdings).toHaveLength(2);
    expect(packet.portfolio.totalValue).toBe(400);
    expect(packet.categoryBreakdown['A股'].signalFundCode).toBe('000001');
    expect(packet.factorSnapshots.find((s) => s.category === 'A股').signalFundCode).toBe('000001');
    expect(packet.dataQuality.latestNavDateByFund['000002']).toBe('2024-12-10');
    expect(packet.dataQuality.staleFunds).toContain('000002');
  });

  it('explicitly marks the non_twr performance limitation', () => {
    const packet = buildResearchPacket({ config, funds, transactions, navRows, asOfDate: '2024-12-24' });
    expect(packet.performanceLimitation.performanceMethod).toBe('non_twr');
    expect(packet.performanceLimitation.warning).toContain('时间加权收益率');
    expect(packet.knownLimitations.join('\n')).toContain('不得把现金流');
  });
});
