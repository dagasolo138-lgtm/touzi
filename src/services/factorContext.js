import { buildFactorSnapshot } from '../utils/factorEngine.js';
import { buildPortfolio, categoryBreakdown } from '../utils/positionEngine.js';

function latestNavMap(navRows = []) {
  return navRows.reduce((map, row) => {
    if (!row?.fundCode || !row?.date) return map;
    if (!map[row.fundCode] || row.date > map[row.fundCode].date) return { ...map, [row.fundCode]: row };
    return map;
  }, {});
}

export function buildCategoryFactorSnapshots({ config, funds, transactions, navRows, asOfDate } = {}) {
  const cfg = config || {};
  const categories = cfg.categories || [];
  const latestMap = latestNavMap(navRows || []);
  const inputRows = funds || [];
  const hasPrecomputedHoldings = inputRows.some((row) => Number.isFinite(Number(row?.value)) && Number(row.value) > 0 && row?.category);
  const portfolio = hasPrecomputedHoldings && !(transactions || []).length
    ? {
      holdings: inputRows,
      totalValue: inputRows.reduce((sum, row) => sum + Number(row.value || 0), 0),
    }
    : buildPortfolio(inputRows, transactions || [], latestMap);
  const breakdown = categoryBreakdown(portfolio.holdings, categories, cfg.targetAllocation || {});
  const snapshotsByCategory = categories.reduce((map, category) => {
    const signalFundCode = cfg.factorSettings?.categorySignalFunds?.[category] || '';
    const categoryNavRows = (navRows || []).filter((row) => row.fundCode === signalFundCode);
    map[category] = buildFactorSnapshot({
      category,
      signalFundCode,
      navRows: categoryNavRows,
      actualWeight: breakdown[category]?.weight || 0,
      targetWeight: breakdown[category]?.targetWeight || 0,
      asOfDate,
      settings: cfg.factorSettings || {},
    });
    return map;
  }, {});
  return { portfolio, breakdown, snapshotsByCategory, snapshots: categories.map((category) => snapshotsByCategory[category]) };
}


export function formatFactorContextForLLM(factorResult) {
  if (!factorResult || !factorResult.snapshots) return '';
  const lines = ['【量化因子状态】'];
  factorResult.snapshots.forEach((snap) => {
    const allocationStr = `配置优先级 ${snap.allocationPriority}`;
    const priceStr = snap.priceCondition.score != null ? `价格状态 ${snap.priceCondition.score}` : '价格状态 数据不足';
    const trendLabel = { bullish: '偏强', bearish: '偏弱', neutral: '中性', insufficient: '数据不足' }[snap.trendState.state];
    const actionStr = snap.actionPriority != null ? `综合 ${snap.actionPriority}` : '综合 数据不足';
    const flagStr = snap.flags.length ? `[标记: ${snap.flags.join(', ')}]` : '';
    lines.push(`  ${snap.category}: ${allocationStr} | ${priceStr} | 趋势${trendLabel} | ${actionStr} ${flagStr}`);
  });
  lines.push('');
  lines.push('说明：综合分数为配置纪律和价格状态的加权结果，60+建议谨慎追入，40-建议适度加量，数据不足时不作为决策依据。');
  return lines.join('\n');
}
