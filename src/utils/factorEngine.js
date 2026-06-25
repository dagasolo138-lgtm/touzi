export const DEFAULT_FACTOR_SETTINGS = {
  version: 'v1',
  minObservations: 252,
  priceLookback: 252,
  trendFast: 60,
  trendSlow: 120,
  rsiPeriod: 14,
  allocationWeight: 0.65,
  priceWeight: 0.35,
  categoryWeights: {
    A股: { allocation: 0.65, price: 0.35, percentile: 0.45, drawdown: 0.45, rsi: 0.10 },
    QDII: { allocation: 0.70, price: 0.30, percentile: 0.50, drawdown: 0.40, rsi: 0.10 },
    债券: { allocation: 0.80, price: 0.20, percentile: 0.60, drawdown: 0.30, rsi: 0.10 },
    黄金: { allocation: 0.60, price: 0.40, percentile: 0.40, drawdown: 0.50, rsi: 0.10 },
  },
  categorySignalFunds: { A股: '', QDII: '', 债券: '', 黄金: '' },
  expectedNavLagDays: { A股: 3, QDII: 5, 债券: 3, 黄金: 5 },
  maxInternalGapDays: 14,
};

const DAY_MS = 86400000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const toDateOnly = (value) => String(value || '').slice(0, 10);
const validNav = (row) => Number.isFinite(Number(row?.nav)) && Number(row.nav) > 0;

export function mergeFactorSettings(settings = {}) {
  const mergedCategoryWeights = Object.fromEntries(
    Object.entries(DEFAULT_FACTOR_SETTINGS.categoryWeights).map(([category, weights]) => [
      category,
      { ...weights, ...(settings.categoryWeights?.[category] || {}) },
    ]),
  );
  Object.entries(settings.categoryWeights || {}).forEach(([category, weights]) => {
    if (!mergedCategoryWeights[category]) mergedCategoryWeights[category] = { ...weights };
  });
  return {
    ...DEFAULT_FACTOR_SETTINGS,
    ...settings,
    categoryWeights: mergedCategoryWeights,
    categorySignalFunds: { ...DEFAULT_FACTOR_SETTINGS.categorySignalFunds, ...(settings.categorySignalFunds || {}) },
    expectedNavLagDays: { ...DEFAULT_FACTOR_SETTINGS.expectedNavLagDays, ...(settings.expectedNavLagDays || {}) },
  };
}

export function normalizeNavHistory(rows = [], asOfDate = new Date().toISOString().slice(0, 10)) {
  const cutoff = toDateOnly(asOfDate);
  const byDate = new Map();
  rows.forEach((row) => {
    const date = toDateOnly(row.date || row.navDate);
    const nav = Number(row.nav ?? row.unitNetWorth ?? row.netValue);
    if (!date || date > cutoff || !Number.isFinite(nav) || nav <= 0) return;
    byDate.set(date, { ...row, date, nav });
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function windowRows(navRows, lookback) {
  const rows = normalizeNavHistory(navRows, '9999-12-31');
  return rows.slice(-lookback);
}

export function calcPricePercentile(navRows, lookback = 252) {
  const rows = windowRows(navRows, lookback);
  if (rows.length < 2) return null;
  const current = Number(rows.at(-1).nav);
  const values = rows.map((row) => Number(row.nav)).sort((a, b) => a - b);
  const lowerOrEqual = values.filter((value) => value <= current).length;
  return clamp((lowerOrEqual - 1) / Math.max(1, values.length - 1), 0, 1);
}

export function calcDrawdownFromPeak(navRows, lookback = 252) {
  const rows = windowRows(navRows, lookback);
  if (rows.length < 2) return null;
  const current = Number(rows.at(-1).nav);
  const peak = Math.max(...rows.map((row) => Number(row.nav)));
  return peak > 0 ? current / peak - 1 : null;
}

function movingAverage(rows, period) {
  if (rows.length < period) return null;
  const slice = rows.slice(-period);
  return slice.reduce((sum, row) => sum + Number(row.nav), 0) / period;
}

export function calcTrendState(navRows, fast = 60, slow = 120) {
  const rows = normalizeNavHistory(navRows, '9999-12-31');
  const maFast = movingAverage(rows, fast);
  const maSlow = movingAverage(rows, slow);
  if (maFast == null || maSlow == null) return { state: 'insufficient', maFast, maSlow, ma60: maFast, ma120: maSlow };
  const band = maSlow * 0.005;
  const state = maFast > maSlow + band ? 'bullish' : maFast < maSlow - band ? 'bearish' : 'neutral';
  return { state, maFast, maSlow, ma60: maFast, ma120: maSlow };
}

export function calcVolatilityState(navRows, window = 30) {
  const rows = normalizeNavHistory(navRows, '9999-12-31').slice(-(window + 1));
  if (rows.length < window + 1) return { state: 'insufficient', volatility: null };
  const returns = rows.slice(1).map((row, index) => Number(row.nav) / Number(rows[index].nav) - 1);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  const volatility = Math.sqrt(variance) * Math.sqrt(252);
  const state = volatility < 0.08 ? 'low' : volatility > 0.25 ? 'high' : 'normal';
  return { state, volatility };
}

export function calcRSIValue(navRows, period = 14) {
  const rows = normalizeNavHistory(navRows, '9999-12-31');
  if (rows.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = rows.length - period; i < rows.length; i += 1) {
    const diff = Number(rows[i].nav) - Number(rows[i - 1].nav);
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

export function calcDataConfidence({ navRows = [], asOfDate, category, signalFundCode, settings = {} } = {}) {
  const cfg = mergeFactorSettings(settings);
  const cutoff = toDateOnly(asOfDate);
  const rawRows = navRows.filter((row) => {
    const date = toDateOnly(row.date || row.navDate);
    return date && date <= cutoff;
  });
  const rows = normalizeNavHistory(rawRows, asOfDate);
  const flags = [];
  let score = 100;
  if (!signalFundCode) { flags.push('SIGNAL_FUND_MISSING'); score -= 60; }
  if (rows.length < cfg.minObservations) { flags.push('INSUFFICIENT_HISTORY'); score -= rows.length < 60 ? 45 : 30; }
  if (rows.length) {
    const latest = rows.at(-1).date;
    const lag = Math.floor((new Date(`${toDateOnly(asOfDate)}T00:00:00Z`) - new Date(`${latest}T00:00:00Z`)) / DAY_MS);
    if (lag > Number(cfg.expectedNavLagDays[category] ?? 3)) { flags.push('NAV_STALE'); score -= 35; }
    const invalidCount = rawRows.filter((row) => !validNav(row)).length;
    const seenDates = new Set();
    const duplicateCount = rawRows.filter((row) => {
      const date = toDateOnly(row.date || row.navDate);
      if (!date || !validNav(row)) return false;
      if (seenDates.has(date)) return true;
      seenDates.add(date);
      return false;
    }).length;
    let maxGapDays = 0;
    for (let i = 1; i < rows.length; i += 1) {
      const gap = Math.floor((new Date(`${rows[i].date}T00:00:00Z`) - new Date(`${rows[i - 1].date}T00:00:00Z`)) / DAY_MS);
      maxGapDays = Math.max(maxGapDays, gap);
    }
    if (invalidCount > 0 || duplicateCount > 0 || maxGapDays > Number(cfg.maxInternalGapDays ?? 14)) { flags.push('DATA_GAP'); score -= 15; }
  } else { flags.push('NO_NAV_DATA'); score -= 60; }
  return { score: clamp(Math.round(score), 0, 100), flags };
}

export function calcAllocationPriority(actualWeight = 0, targetWeight = 0) {
  const gap = Number(targetWeight) - Number(actualWeight);
  if (gap >= 0.10) return 95;
  if (gap >= 0.05) return 80;
  if (gap >= 0.02) return 65;
  if (gap > -0.02) return 50;
  if (gap > -0.05) return 35;
  if (gap > -0.10) return 20;
  return 5;
}

export function calcPriceCondition(navRows, settings = {}, category = null) {
  const cfg = mergeFactorSettings(settings);
  const rows = normalizeNavHistory(navRows, '9999-12-31');
  const reasons = [];
  if (rows.length < cfg.minObservations) reasons.push('INSUFFICIENT_HISTORY');
  const percentile = calcPricePercentile(rows, cfg.priceLookback);
  const drawdown = calcDrawdownFromPeak(rows, cfg.priceLookback);
  const rsi = calcRSIValue(rows, cfg.rsiPeriod);
  if (percentile == null) reasons.push('PRICE_PERCENTILE_UNAVAILABLE');
  if (drawdown == null) reasons.push('DRAWDOWN_UNAVAILABLE');
  if (rsi == null) reasons.push('RSI_UNAVAILABLE');
  if (reasons.length) return { score: null, details: null, raw: { percentile, drawdown, rsi }, insufficientReasons: [...new Set(reasons)] };
  const percentileScore = (1 - percentile) * 100;
  const drawdownScore = clamp(Math.abs(drawdown) / 0.3, 0, 1) * 100;
  const rsiScore = rsi <= 25 ? 80 : rsi >= 75 ? 20 : 50;
  const weights = cfg.categoryWeights[category] || { percentile: 0.45, drawdown: 0.45, rsi: 0.10 };
  const score = percentileScore * weights.percentile + drawdownScore * weights.drawdown + rsiScore * weights.rsi;
  return { score: Math.round(score), details: { percentileScore, drawdownScore, rsiScore }, raw: { percentile, drawdown, rsi }, insufficientReasons: [] };
}

export function buildFactorSnapshot({ category, signalFundCode, navRows = [], actualWeight = 0, targetWeight = 0, asOfDate = new Date().toISOString().slice(0, 10), settings = {} } = {}) {
  const cfg = mergeFactorSettings(settings);
  const rows = normalizeNavHistory(navRows, asOfDate);
  const allocationPriority = calcAllocationPriority(actualWeight, targetWeight);
  const dataConfidence = calcDataConfidence({ navRows, asOfDate, category, signalFundCode, settings: cfg });
  const priceCondition = signalFundCode ? calcPriceCondition(rows, cfg, category) : { score: null, details: null, raw: {}, insufficientReasons: ['SIGNAL_FUND_MISSING'] };
  const trendState = calcTrendState(rows, cfg.trendFast, cfg.trendSlow);
  const volatilityState = calcVolatilityState(rows, 30);
  const flags = [...new Set([...dataConfidence.flags, ...(priceCondition.insufficientReasons || [])])];
  if (trendState.state === 'bearish' && Number(priceCondition.raw?.drawdown) <= -0.15) flags.push('FALLING_KNIFE_RISK');
  const canScore = dataConfidence.score >= 70 && priceCondition.score != null;
  const catWeights = cfg.categoryWeights[category] || { allocation: cfg.allocationWeight, price: cfg.priceWeight, percentile: 0.45, drawdown: 0.45, rsi: 0.10 };
  const actionPriority = canScore ? Math.round(allocationPriority * catWeights.allocation + priceCondition.score * catWeights.price) : null;
  const noTactical = !canScore || flags.includes('NAV_STALE') || flags.includes('SIGNAL_FUND_MISSING') || flags.includes('FALLING_KNIFE_RISK');
  const actionText = !canScore ? '数据不足，暂不生成行动提示' : noTactical ? '暂不使用额外战术资金' : actionPriority >= 70 ? '优先补足配置' : '按计划执行';
  return { factorVersion: cfg.version, asOfDate, category, signalFundCode, allocationPriority, priceCondition, trendState, volatilityState, dataConfidence, actionPriority, appliedWeights: catWeights, flags, explanation: actionText };
}

export function suggestDcaMultiplier(actionPriority) {
  if (actionPriority == null) return { multiplier: 1.0, label: '按计划执行', reason: '数据不足，按计划100%执行' };
  if (actionPriority >= 80) return { multiplier: 0.50, label: '减半投入', reason: '配置已饱和或价格偏高，建议减半' };
  if (actionPriority >= 60) return { multiplier: 0.75, label: '减量投入', reason: '当前条件偏向谨慎' };
  if (actionPriority >= 40) return { multiplier: 1.00, label: '按计划执行', reason: '条件中性，正常执行' };
  if (actionPriority >= 20) return { multiplier: 1.50, label: '增量投入', reason: '配置偏离或价格偏低，建议加量' };
  return { multiplier: 2.00, label: '加倍投入', reason: '配置严重偏离或价格极低，建议加倍' };
}


export function evaluateHoldingWarning({ pnlPct, percentile, drawdown } = {}) {
  if (!Number.isFinite(pnlPct)) return null;

  if (pnlPct < -0.15 && percentile != null && percentile > 0.6) {
    return {
      type: 'loss_aversion',
      severity: 'warning',
      message: `当前已亏损 ${(pnlPct * 100).toFixed(1)}%，但价格仍处近一年 ${(percentile * 100).toFixed(0)}% 分位。损失厌恶可能让你继续持有，但下跌空间未必释放完毕。理性评估：是否仍符合配置目标？是否需要止损或追加？`,
    };
  }

  if (pnlPct > 0.30 && percentile != null && percentile > 0.8) {
    return {
      type: 'overconfidence',
      severity: 'caution',
      message: `当前已盈利 ${(pnlPct * 100).toFixed(1)}%，价格处近一年 ${(percentile * 100).toFixed(0)}% 分位的高位区间。注意过度自信偏差：考虑部分止盈再平衡，避免高位回撤吃掉收益。`,
    };
  }

  return null;
}
