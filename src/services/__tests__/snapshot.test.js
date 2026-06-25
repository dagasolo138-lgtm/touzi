import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { backfillSnapshotsWithTwr, enrichSnapshotWithTwr } from '../snapshot.js';

describe('snapshot TWR metadata', () => {
  it('adds insufficient TWR metadata to the first snapshot', () => {
    const snapshot = enrichSnapshotWithTwr({ date: '2024-01-01', totalValue: 10000 }, [], []);
    expect(snapshot.performanceMethod).toBe('insufficient_for_twr');
    expect(snapshot.twrCumulativeReturn).toBeNull();
    expect(snapshot.twrPeriodReturn).toBeNull();
  });

  it('persists period and cumulative TWR fields when prior snapshots exist', () => {
    const snapshot = enrichSnapshotWithTwr(
      { date: '2024-01-02', totalValue: 21000 },
      [{ date: '2024-01-01', totalValue: 10000 }],
      [{ type: 'buy', date: '2024-01-02', amountCents: 10000, feeCents: 0 }],
    );
    expect(snapshot.performanceMethod).toBe('twr');
    expect(snapshot.twrPeriodReturn).toBeCloseTo(0.1);
    expect(snapshot.twrCumulativeReturn).toBeCloseTo(0.1);
    expect(snapshot.netExternalFlowCents).toBe(10000);
    expect(snapshot.twrObservationCount).toBe(1);
  });

  it('backfills TWR metadata across existing snapshots in date order', () => {
    const snapshots = backfillSnapshotsWithTwr(
      [{ date: '2024-01-02', totalValue: 21000 }, { date: '2024-01-01', totalValue: 10000 }],
      [{ type: 'buy', date: '2024-01-02', amountCents: 10000, feeCents: 0 }],
    );
    expect(snapshots.map((snapshot) => snapshot.date)).toEqual(['2024-01-01', '2024-01-02']);
    expect(snapshots[0].performanceMethod).toBe('insufficient_for_twr');
    expect(snapshots[1].twrCumulativeReturn).toBeCloseTo(0.1);
  });
});
