import { buildCategoryFactorSnapshots } from './factorContext.js';

const DAY_MS = 86400000;
const TWR_WARNING = '当前组合收益与风险统计尚未完成时间加权收益率校正；不得把现金流导致的市值变化解释为投资收益。';

function latestNavMap(navRows = []) {
  return navRows.reduce((map, row) => {
    if (!row?.fundCode || !row?.date) return map;
    if (!map[row.fundCode] || row.date > map[row.fundCode].date) map[row.fundCode] = row;
    return map;
  }, {});
}
function daysBetween(a, b) { if (!a || !b) return Infinity; return Math.floor((new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / DAY_MS); }
function centsToYuan(cents) { return Number(((Number(cents) || 0) / 100).toFixed(2)); }
function navValue(row) { return Number(row?.nav ?? row?.unitNetWorth ?? row?.netValue ?? row?.value ?? 0); }
function recentSummary(rows = []) {
  const cleaned = rows.filter((r) => r.date && navValue(r) > 0).sort((a, b) => a.date.localeCompare(b.date));
  const recent = cleaned.slice(-30);
  return { count: cleaned.length, firstDate: cleaned[0]?.date || null, latestDate: cleaned.at(-1)?.date || null, latestNav: navValue(cleaned.at(-1)), recent30: recent.map((r) => ({ date: r.date, nav: navValue(r) })) };
}

export function summarizeResearchPacket(packet) {
  return {
    asOfDate: packet.asOfDate,
    generatedAt: packet.generatedAt,
    dataQuality: packet.dataQuality,
    portfolio: { ...packet.portfolio, holdings: packet.portfolio.holdings.map((h) => ({ code: h.code, name: h.name, category: h.category, value: h.value, weight: h.weight, latestNavDate: h.latestNavDate, navHistoryCount: h.navHistoryCount, navStale: h.navStale })) },
    categoryBreakdown: packet.categoryBreakdown,
    factorSnapshots: packet.factorSnapshots,
    performanceLimitation: packet.performanceLimitation,
    knownLimitations: packet.knownLimitations,
  };
}

export function buildResearchPacket({ config = {}, funds = [], transactions = [], navRows = [], dcaPlans = [], snapshots = [], asOfDate = new Date().toISOString().slice(0, 10) } = {}) {
  const factorResult = buildCategoryFactorSnapshots({ config, funds, transactions, navRows, asOfDate });
  const latestMap = latestNavMap(navRows);
  const navByFund = navRows.reduce((map, row) => { if (!map[row.fundCode]) map[row.fundCode] = []; map[row.fundCode].push(row); return map; }, {});
  const staleThreshold = Number(config.factorSettings?.staleNavDays ?? 7);
  const holdings = factorResult.portfolio.holdings.map((h) => {
    const rows = navByFund[h.code] || [];
    const staleDays = daysBetween(asOfDate, latestMap[h.code]?.date);
    return { code: h.code, name: h.name, category: h.category, shares: h.shares, value: centsToYuan(h.value), cost: centsToYuan(h.totalCost), fee: centsToYuan(h.totalFee), pnl: centsToYuan(h.unrealizedPnl), realizedPnl: centsToYuan(h.realizedPnl), pnlPct: h.pnlPct, weight: h.weight, latestNav: h.nav, latestNavDate: h.navDate || null, navHistoryCount: rows.length, navStale: staleDays > staleThreshold, recentNavSummary: recentSummary(rows) };
  });
  const categoryBreakdown = Object.fromEntries((config.categories || []).map((category) => {
    const b = factorResult.breakdown[category] || {};
    const s = factorResult.snapshotsByCategory[category] || {};
    return [category, { targetWeight: b.targetWeight || 0, actualWeight: b.weight || 0, deviation: (b.weight || 0) - (b.targetWeight || 0), value: centsToYuan(b.value), allocationPriority: s.allocationPriority ?? null, priceState: s.priceCondition || null, trend: s.trendState || null, volatility: s.volatilityState || null, dataConfidence: s.dataConfidence || null, riskFlags: s.flags || [], signalFundCode: s.signalFundCode || null }];
  }));
  const txSummary = transactions.reduce((map, tx) => { const k = tx.fundCode; if (!map[k]) map[k] = { buyCount: 0, sellCount: 0, totalAmount: 0, totalFee: 0 }; map[k][tx.type === 'sell' ? 'sellCount' : 'buyCount'] += 1; map[k].totalAmount += Number(tx.amountCents || 0) / 100 || Number(tx.amount || 0); map[k].totalFee += Number(tx.feeCents || 0) / 100 || Number(tx.fee || 0); return map; }, {});
  const missingSignalFunds = (config.categories || []).filter((c) => !config.factorSettings?.categorySignalFunds?.[c]);
  return {
    asOfDate,
    generatedAt: new Date().toISOString(),
    dataQuality: { navCoverageByFund: Object.fromEntries(funds.map((f) => [f.code, (navByFund[f.code] || []).length])), latestNavDateByFund: Object.fromEntries(funds.map((f) => [f.code, latestMap[f.code]?.date || null])), staleFunds: holdings.filter((h) => h.navStale).map((h) => h.code), missingSignalFunds, factorSyncStatus: missingSignalFunds.length ? 'missing_signal_funds' : 'ready' },
    portfolio: { totalValue: centsToYuan(factorResult.portfolio.totalValue), totalCost: centsToYuan(factorResult.portfolio.totalCost), totalFee: centsToYuan(factorResult.portfolio.totalFee), totalPnl: centsToYuan(factorResult.portfolio.totalPnl), pnlPct: factorResult.portfolio.pnlPct, holdings },
    categoryBreakdown,
    factorSnapshots: factorResult.snapshots,
    dcaPlans: dcaPlans.map((p) => ({ ...p })),
    transactionSummaryByFund: txSummary,
    snapshotSummary: { count: snapshots.length, latestDate: snapshots.at?.(-1)?.date || null },
    performanceLimitation: { performanceMethod: 'non_twr', warning: TWR_WARNING },
    knownLimitations: [TWR_WARNING, '研究包仅包含近期净值摘要；完整原始净值历史仅在 Agent 明确调用工具时查询。'],
  };
}
