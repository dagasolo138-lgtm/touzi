import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getSnapshots } from '../db/index.js';
import {
  calcAnnualizedVolatility,
  calcCorrelationMatrix,
  calcDailyReturns,
  calcMaxDrawdown,
  calcRollingVolatility,
  calcSharpe,
} from '../utils/riskEngine.js';

const CATEGORIES = ['A股', 'QDII', '债券', '黄金'];
const RISK_FREE_ANNUAL = 0.02;

const fmtPct = (value) => (value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`);
const fmtSignedPct = (value) => (value == null || !Number.isFinite(value) ? '—' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`);
const fmtNumber = (value) => (value == null || !Number.isFinite(value) ? '—' : value.toFixed(2));

function riskLevel(volatility) {
  if (volatility == null) return { label: '数据不足', className: 'bg-[#374151] text-[#d1d5db]' };
  if (volatility < 0.05) return { label: '低风险', className: 'bg-emerald-500/20 text-emerald-200' };
  if (volatility <= 0.15) return { label: '中风险', className: 'bg-yellow-500/20 text-yellow-100' };
  return { label: '高风险', className: 'bg-red-500/20 text-red-200' };
}

function sharpeLevel(sharpe) {
  if (sharpe == null) return { label: '数据不足', className: 'bg-[#374151] text-[#d1d5db]' };
  if (sharpe < 0) return { label: '差', className: 'bg-red-500/20 text-red-200' };
  if (sharpe < 1) return { label: '一般', className: 'bg-yellow-500/20 text-yellow-100' };
  if (sharpe < 2) return { label: '良好', className: 'bg-emerald-500/20 text-emerald-200' };
  return { label: '优秀', className: 'bg-blue-500/20 text-blue-200' };
}

function findDrawdownPeriod(snapshots, drawdownSeries) {
  let peakIndex = 0;
  let runningPeakIndex = 0;
  let troughIndex = 0;
  let maxDrawdown = 0;
  snapshots.forEach((snapshot, index) => {
    if (snapshot.totalValue > snapshots[runningPeakIndex].totalValue) runningPeakIndex = index;
    if ((drawdownSeries[index] ?? 0) < maxDrawdown) {
      maxDrawdown = drawdownSeries[index];
      peakIndex = runningPeakIndex;
      troughIndex = index;
    }
  });
  if (maxDrawdown === 0) return '暂无明显回撤';
  return `${snapshots[peakIndex]?.date || '—'} → ${snapshots[troughIndex]?.date || '—'}`;
}

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function mix(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex({ r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t });
}

function correlationColor(value) {
  if (value == null || !Number.isFinite(value)) return '#374151';
  if (value < 0) return mix('#065f46', '#374151', value + 1);
  return mix('#374151', '#7f1d1d', value);
}

function MetricCard({ title, value, valueClassName = 'text-white', description, footer }) {
  return <div className="card p-5">
    <p className="metric-label">{title}</p>
    <p className={`mt-3 text-3xl font-bold ${valueClassName}`}>{value}</p>
    <p className="mt-2 text-sm text-[#888888]">{description}</p>
    <div className="mt-4 text-sm text-[#d4d4d4]">{footer}</div>
  </div>;
}

function ChartTooltip({ active, payload, label, name }) {
  if (!active || !payload?.length) return null;
  const value = payload.find((item) => Number.isFinite(item.value))?.value;
  return <div className="rounded-lg border border-[#333333] bg-[#111111]/95 p-3 text-sm shadow-xl">
    <div className="mb-1 font-semibold text-white">{label}</div>
    <div className="text-[#d4d4d4]">{name}：{fmtSignedPct(value)}</div>
  </div>;
}

export default function Risk() {
  const [snapshots, setSnapshots] = useState([]);
  const [showNotes, setShowNotes] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getSnapshots()
      .then((rows) => {
        if (alive) setSnapshots(rows.filter((row) => row.date && Number(row.totalValue) > 0).sort((a, b) => a.date.localeCompare(b.date)));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, []);

  const data = useMemo(() => {
    const values = snapshots.map((row) => Number(row.totalValue));
    const dailyReturns = calcDailyReturns(values);
    const volatility = calcAnnualizedVolatility(dailyReturns);
    const sharpe = calcSharpe(dailyReturns, RISK_FREE_ANNUAL);
    const { maxDrawdown, drawdownSeries } = calcMaxDrawdown(values);
    const drawdownData = snapshots.map((row, index) => ({ date: row.date, drawdown: drawdownSeries[index] ?? 0 }));
    const rollingVolatility = calcRollingVolatility(dailyReturns, 30);
    const rollingData = rollingVolatility.map((value, index) => ({ date: snapshots[index + 1]?.date, volatility: value })).filter((row) => row.date && row.volatility != null);
    const seriesMap = Object.fromEntries(CATEGORIES.map((category) => [
      category,
      snapshots.map((row) => Number(row.categoryBreakdown?.[category]?.value || 0)).filter((value) => value > 0),
    ]));
    const noData = Object.fromEntries(CATEGORIES.map((category) => [category, seriesMap[category].length < 2]));
    const correlation = calcCorrelationMatrix(seriesMap);
    return {
      dailyReturns,
      volatility,
      volatilityLevel: riskLevel(volatility),
      sharpe,
      sharpeLevel: sharpeLevel(sharpe),
      maxDrawdown,
      drawdownData,
      drawdownPeriod: findDrawdownPeriod(snapshots, drawdownSeries),
      rollingData,
      correlation,
      noData,
      minDrawdown: Math.min(0, ...drawdownSeries),
    };
  }, [snapshots]);

  if (loading) return <div className="space-y-6"><h2 className="text-2xl font-bold text-white">风险分析</h2><div className="card flex min-h-[280px] items-center justify-center p-8"><div className="h-10 w-10 animate-spin rounded-full border-2 border-[#333333] border-t-[#3b82f6]" aria-label="加载中" /></div></div>;

  if (snapshots.length < 10) return <div className="space-y-6">
    <div><h2 className="text-2xl font-bold text-white">风险分析</h2><p className="mt-2 text-sm text-[#888888]">基于 {snapshots.length} 天历史数据 · 无风险利率 2%（参考短期国债）</p></div>
    <div className="card p-8 text-center">
      <p className="text-[#d4d4d4]">风险指标需要至少10天的历史数据。每次刷新净值会自动生成快照，请持续使用后再查看。</p>
      <p className="mt-4 text-sm text-[#888888]">当前已有 {snapshots.length} / 10 天数据</p>
      <div className="mx-auto mt-3 h-2 max-w-md overflow-hidden rounded-full bg-[#222222]"><div className="h-full rounded-full bg-[#3b82f6]" style={{ width: `${Math.min(100, snapshots.length * 10)}%` }} /></div>
    </div>
  </div>;

  return <div className="space-y-6">
    <div><h2 className="text-2xl font-bold text-white">风险分析</h2><p className="mt-2 text-sm text-[#888888]">基于 {snapshots.length} 天历史数据 · 无风险利率 2%（参考短期国债）</p></div>

    <section className="grid gap-4 lg:grid-cols-3">
      <MetricCard title="最大回撤" value={fmtPct(data.maxDrawdown)} valueClassName="text-red-300" description="历史最大单次下跌幅度" footer={<span>回撤区间：{data.drawdownPeriod}</span>} />
      <MetricCard title="年化波动率" value={fmtPct(data.volatility)} description="收益率年化标准差" footer={<span className={`rounded-full px-2 py-1 text-xs ${data.volatilityLevel.className}`}>{data.volatilityLevel.label}</span>} />
      <MetricCard title="夏普比率" value={fmtNumber(data.sharpe)} description="每单位风险的超额收益（无风险利率2%）" footer={<span className={`rounded-full px-2 py-1 text-xs ${data.sharpeLevel.className}`}>{data.sharpeLevel.label}</span>} />
    </section>

    <section className="card p-4">
      <h3 className="mb-4 font-semibold text-white">回撤历史</h3>
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={data.drawdownData} margin={{ top: 8, right: 18, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#2a2a2a" />
          <XAxis dataKey="date" stroke="#888888" tick={{ fontSize: 12 }} minTickGap={28} />
          <YAxis stroke="#888888" tickFormatter={fmtPct} domain={[data.minDrawdown, 0]} />
          <Tooltip content={<ChartTooltip name="当日回撤" />} />
          <ReferenceLine y={0} stroke="#ffffff" strokeDasharray="5 5" />
          <Area type="monotone" dataKey="drawdown" stroke="#ef4444" fill="#ef444433" strokeWidth={2} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </section>

    <section className="card p-4">
      <h3 className="mb-4 font-semibold text-white">30日滚动波动率（年化）</h3>
      {snapshots.length < 35 ? <div className="flex min-h-[220px] items-center justify-center text-[#888888]">数据积累中，需30天以上数据</div> : <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data.rollingData} margin={{ top: 8, right: 18, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#2a2a2a" />
          <XAxis dataKey="date" stroke="#888888" tick={{ fontSize: 12 }} minTickGap={28} />
          <YAxis stroke="#888888" tickFormatter={fmtPct} />
          <Tooltip content={<ChartTooltip name="波动率" />} />
          <Line type="monotone" dataKey="volatility" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>}
    </section>

    <section className="card p-4">
      <h3 className="font-semibold text-white">类别相关性</h3>
      <p className="mt-2 text-sm text-[#888888]">相关系数越接近-1，分散化效果越好；接近+1说明同涨同跌</p>
      <div className="mt-4 overflow-x-auto">
        <div className="grid min-w-[560px] gap-2" style={{ gridTemplateColumns: `110px repeat(${CATEGORIES.length}, minmax(88px, 1fr))` }}>
          <div />
          {CATEGORIES.map((category) => <div key={category} className="py-2 text-center text-sm text-[#888888]">{category}</div>)}
          {CATEGORIES.map((rowCategory, rowIndex) => <div key={rowCategory} className="contents">
            <div className="flex items-center text-sm text-[#888888]">{rowCategory}{data.noData[rowCategory] && <span className="ml-2 text-xs text-[#555555]">暂无数据</span>}</div>
            {CATEGORIES.map((colCategory, colIndex) => {
              const value = data.noData[rowCategory] || data.noData[colCategory] ? null : data.correlation.matrix[rowIndex]?.[colIndex];
              const diagonal = rowIndex === colIndex;
              return <div key={`${rowCategory}-${colCategory}`} className="rounded-lg px-3 py-4 text-center text-sm font-semibold text-white" style={{ background: diagonal ? '#1f2937' : correlationColor(value) }}>
                {diagonal ? rowCategory : value == null || !Number.isFinite(value) ? '—' : value.toFixed(2)}
              </div>;
            })}
          </div>)}
        </div>
      </div>
    </section>

    <section className="card p-4">
      <button className="flex w-full items-center justify-between text-left font-semibold text-white" onClick={() => setShowNotes((value) => !value)}>
        <span>计算说明</span><span className="text-[#888888]">{showNotes ? '收起' : '展开'}</span>
      </button>
      {showNotes && <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[#d4d4d4]">
        <li>年化波动率：日收益率标准差 × √252</li>
        <li>最大回撤：观测期内从峰值到谷值的最大跌幅</li>
        <li>夏普比率：（年化收益率 - 2%）÷ 年化波动率</li>
        <li>相关系数：Pearson相关系数，基于各类别日收益率序列</li>
        <li>注意：组合市值包含新增投入，计算结果仅供参考</li>
      </ul>}
    </section>
  </div>;
}
