// 日收益率序列
export function calcDailyReturns(values) {
  // values: 按日期升序的市值数组
  // 返回: 日收益率数组，长度比values少1
  return values.slice(1).map((v, i) => (v - values[i]) / values[i]);
}

// 年化波动率
export function calcAnnualizedVolatility(dailyReturns) {
  // 标准差 * sqrt(252)
  if (dailyReturns.length < 5) return null;
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length;
  return Math.sqrt(variance) * Math.sqrt(252);
}

// 最大回撤 + 回撤序列
export function calcMaxDrawdown(values) {
  // 返回 { maxDrawdown, drawdownSeries }
  // drawdownSeries: 每个时间点相对历史最高点的跌幅（负数或0）
  if (values.length < 2) return { maxDrawdown: 0, drawdownSeries: [] };
  let peak = values[0];
  let maxDrawdown = 0;
  const drawdownSeries = values.map(v => {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
    return dd;
  });
  return { maxDrawdown, drawdownSeries };
}

// 夏普比率（年化）
export function calcSharpe(dailyReturns, riskFreeAnnual = 0.02) {
  // 无风险利率默认2%（参考中国短期国债），年化
  if (dailyReturns.length < 20) return null;
  const riskFreeDaily = riskFreeAnnual / 252;
  const excessReturns = dailyReturns.map(r => r - riskFreeDaily);
  const mean = excessReturns.reduce((s, r) => s + r, 0) / excessReturns.length;
  const std = Math.sqrt(excessReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / excessReturns.length);
  if (std === 0) return null;
  return (mean / std) * Math.sqrt(252);
}

// 相关性矩阵（Pearson）
export function calcCorrelationMatrix(seriesMap) {
  // seriesMap: { "A股": [v1,v2,...], "QDII": [...], ... }
  // 返回: { categories, matrix }
  // matrix[i][j] = 类别i和类别j的相关系数
  const categories = Object.keys(seriesMap);
  const returns = {};
  categories.forEach(cat => {
    const vals = seriesMap[cat];
    returns[cat] = vals.slice(1).map((v, i) => (v - vals[i]) / vals[i]);
  });

  function pearson(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 5) return null;
    const ax = a.slice(0, n), bx = b.slice(0, n);
    const ma = ax.reduce((s,v)=>s+v,0)/n;
    const mb = bx.reduce((s,v)=>s+v,0)/n;
    const num = ax.reduce((s,v,i)=>s+(v-ma)*(bx[i]-mb),0);
    const da = Math.sqrt(ax.reduce((s,v)=>s+(v-ma)**2,0));
    const db = Math.sqrt(bx.reduce((s,v)=>s+(v-mb)**2,0));
    if (da===0||db===0) return null;
    return num/(da*db);
  }

  const matrix = categories.map(() => categories.map(() => null));
  categories.forEach((a, i) => {
    categories.forEach((b, j) => {
      if (i === j) {
        matrix[i][j] = 1;
      } else if (j > i) {
        const value = pearson(returns[a], returns[b]);
        matrix[i][j] = value;
        matrix[j][i] = value;
      }
    });
  });
  return { categories, matrix };
}

// 30日滚动波动率
export function calcRollingVolatility(dailyReturns, window = 30) {
  return dailyReturns.map((_, i) => {
    if (i < window - 1) return null;
    const slice = dailyReturns.slice(i - window + 1, i + 1);
    const mean = slice.reduce((s,r)=>s+r,0)/window;
    const variance = slice.reduce((s,r)=>s+(r-mean)**2,0)/window;
    return Math.sqrt(variance) * Math.sqrt(252);
  });
}
