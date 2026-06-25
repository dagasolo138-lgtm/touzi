import { describe, expect, it } from 'vitest';
import { calcCorrelationMatrix } from '../riskEngine.js';

describe('calcCorrelationMatrix', () => {
  it('aligns different length series by return date before calculating correlation', () => {
    const result = calcCorrelationMatrix({
      A股: [
        { date: '2024-01-01', value: 100 },
        { date: '2024-01-02', value: 101 },
        { date: '2024-01-03', value: 103 },
        { date: '2024-01-04', value: 106 },
        { date: '2024-01-05', value: 110 },
        { date: '2024-01-06', value: 115 },
      ],
      QDII: [
        { date: '2023-12-29', value: 100 },
        { date: '2024-01-02', value: 101 },
        { date: '2024-01-03', value: 103 },
        { date: '2024-01-04', value: 106 },
        { date: '2024-01-05', value: 110 },
        { date: '2024-01-06', value: 115 },
      ],
    });
    expect(result.matrix[0][0]).toBe(1);
    expect(result.matrix[0][1]).toBeGreaterThan(0.99);
  });

  it('returns null when fewer than five common return dates exist', () => {
    const result = calcCorrelationMatrix({
      A股: [{ date: '2024-01-01', value: 100 }, { date: '2024-01-02', value: 101 }],
      QDII: [{ date: '2024-01-01', value: 100 }, { date: '2024-01-02', value: 101 }],
    });
    expect(result.matrix[0][1]).toBeNull();
  });
});
