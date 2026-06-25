import { getFunds, getTransactions, getLatestNavMap, saveSnapshot, getConfig, getSnapshots } from '../db/index.js';
import { buildPortfolio, categoryBreakdown } from '../utils/positionEngine.js';
import { today } from '../utils/formatters.js';
import { calculateTwrSeries, summarizeTwr } from '../utils/twrEngine.js';

function mergeSnapshotsForTwr(existingSnapshots = [], snapshot) {
  return [...existingSnapshots.filter((row) => row.date !== snapshot.date), snapshot].sort((a, b) => a.date.localeCompare(b.date));
}

export function enrichSnapshotWithTwr(snapshot, existingSnapshots = [], transactions = []) {
  const twrResult = calculateTwrSeries({ snapshots: mergeSnapshotsForTwr(existingSnapshots, snapshot), transactions });
  const twrSummary = summarizeTwr(twrResult);
  const period = (twrResult.series || []).find((row) => row.endDate === snapshot.date && row.status === 'ok') || null;
  return {
    ...snapshot,
    performanceMethod: twrSummary.performanceMethod,
    twrCumulativeReturn: twrSummary.cumulativeReturn,
    twrPeriodReturn: period?.periodReturn ?? null,
    twrObservationCount: twrSummary.observationCount,
    twrStartDate: twrSummary.startDate,
    twrEndDate: twrSummary.endDate,
    netExternalFlowCents: period?.netExternalFlowCents ?? 0,
  };
}

export function backfillSnapshotsWithTwr(snapshots = [], transactions = []) {
  const ordered = [...snapshots].filter((snapshot) => snapshot.date).sort((a, b) => a.date.localeCompare(b.date));
  return ordered.map((snapshot, index) => enrichSnapshotWithTwr(snapshot, ordered.slice(0, index), transactions));
}

export async function backfillSnapshotTwrMetadata() {
  const [snapshots, transactions] = await Promise.all([getSnapshots(), getTransactions()]);
  const enriched = backfillSnapshotsWithTwr(snapshots, transactions);
  await Promise.all(enriched.map(saveSnapshot));
  return { updatedCount: enriched.length, snapshots: enriched };
}

export async function generateSnapshot() {
  try {
    const [funds, txs, navMap, cfg, existingSnapshots] = await Promise.all([getFunds(), getTransactions(), getLatestNavMap(), getConfig(), getSnapshots()]);
    const summary = buildPortfolio(funds, txs, navMap);
    const snapshot = {
      date: today(),
      totalValue: summary.totalValue,
      totalCost: summary.totalCost,
      totalFee: summary.totalFee,
      categoryBreakdown: categoryBreakdown(summary.holdings, cfg.categories, cfg.targetAllocation || {}),
      holdings: summary.holdings.map(({ code, name, shares, nav, value, cost, pnl, pnlPct }) => ({ code, name, shares, nav, value, cost, pnl, pnlPct })),
    };
    const enrichedSnapshot = enrichSnapshotWithTwr(snapshot, existingSnapshots, txs);
    await saveSnapshot(enrichedSnapshot);
    return enrichedSnapshot;
  } catch (error) {
    throw new Error(error.message || '生成快照失败');
  }
}
