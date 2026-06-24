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
  const portfolio = buildPortfolio(funds || [], transactions || [], latestMap);
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
