import { getFund, getTransactions } from '../db/index.js';

export async function validateTransactionSave(candidateTx, originalTxId = null) {
  const allTransactions = await getTransactions();
  const otherTxs = allTransactions.filter((tx) => tx.id !== originalTxId);
  const simulatedTxs = [...otherTxs, candidateTx].sort((a, b) => {
    if (a.date !== b.date) return String(a.date || '').localeCompare(String(b.date || ''));
    return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
  });

  const sharesByFund = {};
  for (const tx of simulatedTxs) {
    const code = tx.fundCode;
    if (!sharesByFund[code]) sharesByFund[code] = 0;
    const shares = Number(tx.shares) || 0;
    if (tx.type === 'buy' || tx.type === 'reinvest') {
      sharesByFund[code] += shares;
    } else if (tx.type === 'sell') {
      sharesByFund[code] -= shares;
      if (sharesByFund[code] < -0.0001) {
        const fund = await getFund(code);
        return {
          valid: false,
          error: `保存后会导致 ${fund?.name || code} 在 ${tx.date} 之后份额为负（${sharesByFund[code].toFixed(2)}份）`,
        };
      }
    }
  }
  return { valid: true };
}
