import { beforeEach, describe, expect, it, vi } from 'vitest';

const txs = vi.hoisted(() => []);
vi.mock('../../db/index.js', () => ({
  getTransactions: vi.fn(async () => txs),
  getFund: vi.fn(async (code) => ({ code, name: '测试基金' })),
}));

const { validateTransactionSave } = await import('../transactionValidation.js');

describe('validateTransactionSave', () => {
  beforeEach(() => { txs.length = 0; });

  it('rejects editing a buy into a later sell oversold ledger', async () => {
    txs.push(
      { id: 'old-buy', date: '2024-01-01', fundCode: '000001', type: 'buy', shares: 100, createdAt: 1 },
      { id: 'sell', date: '2024-01-02', fundCode: '000001', type: 'sell', shares: 80, createdAt: 2 },
    );
    const result = await validateTransactionSave({ id: 'old-buy', date: '2024-01-01', fundCode: '000001', type: 'buy', shares: 50, createdAt: 1 }, 'old-buy');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('份额为负');
  });
});
