import { yuanToCents } from './formatters.js';

function txAmountCents(tx) {
  return Math.round(tx.amountCents ?? yuanToCents(tx.amount));
}

function txFeeCents(tx) {
  return Math.round(tx.feeCents ?? yuanToCents(tx.fee));
}

function compareTransactions(a, b) {
  const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
  if (dateCompare !== 0) return dateCompare;
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}

function groupTransactions(transactions) {
  return transactions.reduce((map, tx) => {
    if (!map[tx.fundCode]) map[tx.fundCode] = [];
    map[tx.fundCode].push(tx);
    return map;
  }, {});
}

export function buildPortfolio(funds = [], transactions = [], navMap = {}) {
  const byFund = groupTransactions([...transactions].sort(compareTransactions));
  const holdings = funds.map((fund) => {
    const txs = byFund[fund.code] || [];
    let shares = 0;
    let totalCost = 0;
    let totalFee = 0;
    let realizedPnl = 0;

    for (const tx of txs) {
      const txShares = Number(tx.shares) || 0;
      const amount = txAmountCents(tx);
      totalFee += txFeeCents(tx);

      if (tx.type === 'sell') {
        const avgCost = shares > 0 ? totalCost / shares : 0;
        const sellFee = txFeeCents(tx);
        const sellProceeds = amount - sellFee;
        const costBasis = avgCost * txShares;
        shares -= txShares;
        totalCost -= costBasis;
        realizedPnl += sellProceeds - costBasis;
      } else {
        shares += txShares;
        totalCost += amount + txFeeCents(tx);
      }

      if (Math.abs(shares) < 1e-8) shares = 0;
      if (Math.abs(totalCost) < 0.5) totalCost = 0;
    }

    const nav = Number(navMap[fund.code]?.nav || 0);
    const value = Math.round(shares * nav * 100);
    const roundedCost = Math.round(totalCost);
    const roundedRealizedPnl = Math.round(realizedPnl);
    const unrealizedPnl = value - roundedCost;

    return {
      code: fund.code,
      name: fund.name,
      category: fund.category,
      subCategory: fund.subCategory,
      shares,
      avgCost: shares ? roundedCost / 100 / shares : 0,
      totalCost: roundedCost,
      totalFee,
      realizedPnl: roundedRealizedPnl,
      unrealizedPnl,
      value,
      nav,
      navDate: navMap[fund.code]?.date,
      pnlPct: roundedCost ? unrealizedPnl / roundedCost : 0,
      weight: 0,
      // Backward-compatible aliases for existing UI/services.
      cost: roundedCost,
      fee: totalFee,
      pnl: unrealizedPnl,
    };
  }).filter((holding) => holding.shares !== 0 || holding.realizedPnl !== 0);

  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
  const totalCost = holdings.reduce((sum, h) => sum + h.totalCost, 0);
  const totalFee = holdings.reduce((sum, h) => sum + h.totalFee, 0);
  const totalUnrealizedPnl = holdings.reduce((sum, h) => sum + h.unrealizedPnl, 0);
  const totalRealizedPnl = holdings.reduce((sum, h) => sum + h.realizedPnl, 0);
  const totalPnl = totalUnrealizedPnl + totalRealizedPnl;

  return {
    holdings: holdings.map((holding) => ({ ...holding, weight: totalValue ? holding.value / totalValue : 0 })),
    totalValue,
    totalCost,
    totalFee,
    totalUnrealizedPnl,
    totalRealizedPnl,
    totalPnl,
    pnlPct: totalCost ? totalPnl / totalCost : 0,
  };
}

export function categoryBreakdown(holdings = [], categories = [], targetAllocation = {}) {
  const total = holdings.reduce((sum, holding) => sum + holding.value, 0);
  return categories.reduce((map, category) => {
    const rows = holdings.filter((holding) => holding.category === category);
    const value = rows.reduce((sum, holding) => sum + holding.value, 0);
    const cost = rows.reduce((sum, holding) => sum + holding.totalCost, 0);
    map[category] = { value, cost, weight: total ? value / total : 0, targetWeight: targetAllocation[category] || 0 };
    return map;
  }, {});
}
