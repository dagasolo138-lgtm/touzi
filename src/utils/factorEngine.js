export const DEFAULT_FACTOR_SETTINGS = {
  version: 'v1',
  minObservations: 252,
  priceLookback: 252,
  trendFast: 60,
  trendSlow: 120,
  rsiPeriod: 14,
  allocationWeight: 0.65,
  priceWeight: 0.35,
  categorySignalFunds: { A股: '', QDII: '', 债券: '', 黄金: '' },
  expectedNavLagDays: { A股: 3, QDII: 5, 债券: 3, 黄金: 5 },
};

const DAY_MS = 86400000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const toDateOnly = (value) => String(value || '').slice(0, 10);
const validNav = (row) => Number.isFinite(Number(row?.nav)) && Number(row.nav) > 0;

export function mergeFactorSettings(settings = {}) {
  return {
    ...DEFAULT_FACTOR_SETTINGS,
    ...settings,
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
  const rows = normalizeNavHistory(navRows, asOfDate);
  const flags = [];
  let score = 100;
  if (!signalFundCode) { flags.push('SIGNAL_FUND_MISSING'); score -= 60; }
  if (rows.length < cfg.minObservations) { flags.push('INSUFFICIENT_HISTORY'); score -= rows.length < 60 ? 45 : 30; }
  if (rows.length) {
    const latest = rows.at(-1).date;
    const lag = Math.floor((new Date(`${toDateOnly(asOfDate)}T00:00:00Z`) - new Date(`${latest}T00:00:00Z`)) / DAY_MS);
    if (lag > Number(cfg.expectedNavLagDays[category] ?? 3)) { flags.push('NAV_STALE'); score -= 35; }
    const uniqueRatio = new Set(rows.map((row) => row.date)).size / rows.length;
    if (uniqueRatio < 0.98 || rows.some((row) => !validNav(row))) { flags.push('DATA_GAP'); score -= 15; }
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

export function calcPriceCondition(navRows, settings = {}) {
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
  const score = percentileScore * 0.45 + drawdownScore * 0.45 + rsiScore * 0.10;
  return { score: Math.round(score), details: { percentileScore, drawdownScore, rsiScore }, raw: { percentile, drawdown, rsi }, insufficientReasons: [] };
}

export function buildFactorSnapshot({ category, signalFundCode, navRows = [], actualWeight = 0, targetWeight = 0, asOfDate = new Date().toISOString().slice(0, 10), settings = {} } = {}) {
  const cfg = mergeFactorSettings(settings);
  const rows = normalizeNavHistory(navRows, asOfDate);
  const allocationPriority = calcAllocationPriority(actualWeight, targetWeight);
  const dataConfidence = calcDataConfidence({ navRows: rows, asOfDate, category, signalFundCode, settings: cfg });
  const priceCondition = signalFundCode ? calcPriceCondition(rows, cfg) : { score: null, details: null, raw: {}, insufficientReasons: ['SIGNAL_FUND_MISSING'] };
  const trendState = calcTrendState(rows, cfg.trendFast, cfg.trendSlow);
  const volatilityState = calcVolatilityState(rows, 30);
  const flags = [...new Set([...dataConfidence.flags, ...(priceCondition.insufficientReasons || [])])];
  if (trendState.state === 'bearish' && Number(priceCondition.raw?.drawdown) <= -0.15) flags.push('FALLING_KNIFE_RISK');
  const canScore = dataConfidence.score >= 70 && priceCondition.score != null;
  const actionPriority = canScore ? Math.round(allocationPriority * cfg.allocationWeight + priceCondition.score * cfg.priceWeight) : null;
  const noTactical = !canScore || flags.includes('NAV_STALE') || flags.includes('SIGNAL_FUND_MISSING') || flags.includes('FALLING_KNIFE_RISK');
  const actionText = !canScore ? '数据不足，暂不生成行动提示' : noTactical ? '暂不使用额外战术资金' : actionPriority >= 70 ? '优先补足配置' : '按计划执行';
  return { factorVersion: cfg.version, asOfDate, category, signalFundCode, allocationPriority, priceCondition, trendState, volatilityState, dataConfidence, actionPriority, flags, explanation: actionText };
}
