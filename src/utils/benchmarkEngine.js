export function alignAndNormalizeSeries(seriesMap) {
  const entries = Object.entries(seriesMap);
  const allStartDates = entries.map(([, series]) => (series.length > 0 ? series[0].date : null)).filter(Boolean);
  const commonStartDate = allStartDates.length === entries.length ? allStartDates.sort().pop() : null;
  if (!commonStartDate) return { commonStartDate: null, seriesMap: {} };

  const normalized = Object.fromEntries(entries.map(([key, series]) => {
    const aligned = series.filter((row) => row.date >= commonStartDate);
    if (aligned.length === 0) return [key, []];
    const startValue = aligned[0].value;
    return [key, aligned.map((row) => ({ ...row, normalized: (row.value / startValue) * 100 }))];
  }));
  return { commonStartDate, seriesMap: normalized };
}
