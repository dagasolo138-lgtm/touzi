import { describe, expect, it } from 'vitest';
import { alignAndNormalizeSeries } from '../benchmarkEngine.js';

describe('alignAndNormalizeSeries', () => {
  it('returns null common start date when any selected series has no data', () => {
    const result = alignAndNormalizeSeries({ portfolio: [{ date: '2024-01-01', value: 100 }], csi300: [] });
    expect(result.commonStartDate).toBeNull();
  });

  it('uses the latest start date as the common starting point and normalizes to 100', () => {
    const result = alignAndNormalizeSeries({
      portfolio: [{ date: '2024-01-01', value: 90 }, { date: '2024-01-03', value: 100 }, { date: '2024-01-04', value: 110 }],
      csi300: [{ date: '2024-01-03', value: 200 }, { date: '2024-01-04', value: 220 }],
    });
    expect(result.commonStartDate).toBe('2024-01-03');
    expect(result.seriesMap.portfolio[0].normalized).toBe(100);
    expect(result.seriesMap.csi300[1].normalized).toBeCloseTo(110);
  });
});
