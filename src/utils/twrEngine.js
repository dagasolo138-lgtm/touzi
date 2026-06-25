import { yuanToCents } from './formatters.js';

function toDate(value) { return String(value || '').slice(0, 10); }
function cents(value) { return Math.round(value ?? 0); }
function amountCents(tx) { return Math.round(tx.amountCents ?? yuanToCents(tx.amount)); }
function feeCents(tx) { return Math.round(tx.feeCents ?? yuanToCents(tx.fee)); }
function snapshotValue(snapshot) { return cents(snapshot?.totalValueCents ?? snapshot?.totalValue ?? snapshot?.valueCents ?? snapshot?.value); }
function inRange(date, startExclusive, endInclusive) { return date && (!startExclusive || date > startExclusive) && (!endInclusive || date <= endInclusive); }

export function buildCashFlowSeries(transactions = []) {
  const byDate = new Map();
  for (const tx of transactions) {
    const date = toDate(tx.date);
    if (!date) continue;
    const amount = amountCents(tx);
    const fee = feeCents(tx);
    const row = byDate.get(date) || { date, buyFlowCents: 0, sellFlowCents: 0, feeCents: 0, netExternalFlowCents: 0, transactionCount: 0 };
    if (tx.type === 'sell') {
      const proceeds = Math.max(0, amount - fee);
      row.sellFlowCents -= proceeds;
      row.netExternalFlowCents -= proceeds;
    } else {
      row.buyFlowCents += amount + fee;
      row.netExternalFlowCents += amount + fee;
    }
    row.feeCents += fee;
    row.transactionCount += 1;
    byDate.set(date, row);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function calculatePeriodReturn({ startValue, endValue, netExternalFlow = 0 } = {}) {
  const start = Number(startValue) || 0;
  const end = Number(endValue) || 0;
  const flow = Number(netExternalFlow) || 0;
  if (start <= 0) return { returnRate: null, status: 'insufficient_start_value', reason: 'start_value_must_be_positive' };
  return { returnRate: (end - flow) / start - 1, status: 'ok' };
}

export function calculateTwrSeries({ snapshots = [], transactions = [] } = {}) {
  const orderedSnapshots = [...snapshots]
    .filter((snapshot) => toDate(snapshot.date))
    .sort((a, b) => toDate(a.date).localeCompare(toDate(b.date)));
  const cashFlows = buildCashFlowSeries(transactions);
  if (orderedSnapshots.length < 2) {
    return { status: 'insufficient_snapshots', reason: 'at_least_two_snapshots_required', series: [], cashFlows, cumulativeReturn: null, observationCount: orderedSnapshots.length };
  }

  let cumulativeFactor = 1;
  const series = [];
  for (let i = 1; i < orderedSnapshots.length; i += 1) {
    const start = orderedSnapshots[i - 1];
    const end = orderedSnapshots[i];
    const startDate = toDate(start.date);
    const endDate = toDate(end.date);
    const periodFlows = cashFlows.filter((flow) => inRange(flow.date, startDate, endDate));
    const netExternalFlowCents = periodFlows.reduce((sum, flow) => sum + flow.netExternalFlowCents, 0);
    const result = calculatePeriodReturn({ startValue: snapshotValue(start), endValue: snapshotValue(end), netExternalFlow: netExternalFlowCents });
    const periodReturn = result.returnRate;
    if (periodReturn == null) {
      series.push({ startDate, endDate, startValueCents: snapshotValue(start), endValueCents: snapshotValue(end), netExternalFlowCents, periodReturn: null, cumulativeReturn: null, status: result.status, cashFlows: periodFlows });
      continue;
    }
    cumulativeFactor *= 1 + periodReturn;
    series.push({ startDate, endDate, startValueCents: snapshotValue(start), endValueCents: snapshotValue(end), netExternalFlowCents, periodReturn, cumulativeReturn: cumulativeFactor - 1, status: 'ok', cashFlows: periodFlows });
  }

  const validSeries = series.filter((row) => row.status === 'ok');
  return {
    status: validSeries.length ? 'ok' : 'insufficient_start_value',
    reason: validSeries.length ? null : 'no_period_with_positive_start_value',
    series,
    cashFlows,
    cumulativeReturn: validSeries.at(-1)?.cumulativeReturn ?? null,
    latestPeriodReturn: validSeries.at(-1)?.periodReturn ?? null,
    observationCount: validSeries.length,
    startDate: orderedSnapshots[0]?.date || null,
    endDate: orderedSnapshots.at(-1)?.date || null,
  };
}

function fundCategoryMap(funds = []) {
  return funds.reduce((map, fund) => {
    if (fund?.code) map[fund.code] = fund.category || '未分类';
    return map;
  }, {});
}

function categoryValue(snapshot, category) {
  return cents(snapshot?.categoryBreakdown?.[category]?.value ?? snapshot?.categoryBreakdown?.[category]?.totalValue ?? 0);
}

export function calculateCategoryTwrSeries({ categories = [], funds = [], snapshots = [], transactions = [] } = {}) {
  const categoryByFund = fundCategoryMap(funds);
  return categories.reduce((map, category) => {
    const categorySnapshots = snapshots.map((snapshot) => ({ date: snapshot.date, totalValue: categoryValue(snapshot, category) }));
    const categoryTransactions = transactions.filter((tx) => (tx.category || categoryByFund[tx.fundCode]) === category);
    map[category] = calculateTwrSeries({ snapshots: categorySnapshots, transactions: categoryTransactions });
    return map;
  }, {});
}

export function summarizeTwr(result) {
  if (!result || result.status !== 'ok') {
    return { performanceMethod: 'insufficient_for_twr', status: result?.status || 'insufficient_snapshots', reason: result?.reason || 'at_least_two_snapshots_required', cumulativeReturn: null, latestPeriodReturn: null, observationCount: result?.observationCount || 0, startDate: result?.startDate || null, endDate: result?.endDate || null };
  }
  return { performanceMethod: 'twr', status: 'ok', cumulativeReturn: result.cumulativeReturn, latestPeriodReturn: result.latestPeriodReturn, observationCount: result.observationCount, startDate: result.startDate, endDate: result.endDate };
}
