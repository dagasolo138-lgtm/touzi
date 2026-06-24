import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getNavHistory, getSnapshots, saveNav } from '../db/index.js';
import { fetchNavHistory } from '../services/fundApi.js';

const BENCHMARKS = [
  { id: "csi300", name: "沪深300（代理）", code: "000051", color: "#f59e0b", desc: "华夏沪深300ETF联接A" },
  { id: "nasdaq", name: "纳指100（代理）", code: "040046", color: "#8b5cf6", desc: "华安纳斯达克100ETF联接A" },
  { id: "bond", name: "全债指数（代理）", code: "000012", color: "#10b981", desc: "国泰中证全债指数" },
  { id: "gold", name: "黄金（代理）", code: "004253", color: "#f97316", desc: "国泰黄金ETF联接C" },
];

const RANGES = [
  { id: '1m', label: '1月', days: 30 },
  { id: '3m', label: '3月', days: 90 },
  { id: '6m', label: '6月', days: 180 },
  { id: '1y', label: '1年', days: 365 },
  { id: 'all', label: '全部', days: null },
];

const fmtValue = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
const fmtReturn = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—');
const valueClass = (v) => (!Number.isFinite(v) ? 'text-[#888888]' : v >= 0 ? 'good' : 'danger');
const toDate = (date) => new Date(`${date}T00:00:00`);

function normalizeSeries(rows, valueKey) {
  const cleaned = rows
    .map((row) => ({ date: row.date, value: Number(row[valueKey]) }))
    .filter((row) => row.date && Number.isFinite(row.value) && row.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const start = cleaned[0]?.value;
  if (!start) return [];
  return cleaned.map((row) => ({ date: row.date, value: (row.value / start) * 100 }));
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-lg border border-[#333333] bg-[#111111]/95 p-3 text-sm shadow-xl">
    <div className="mb-2 font-semibold text-white">{label}</div>
    <div className="space-y-1">
      {payload.filter((item) => Number.isFinite(item.value)).map((item) => {
        const pct = item.value - 100;
        return <div key={item.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: item.color }}>{item.name}</span>
          <span className="text-white">{fmtValue(item.value)} <span className={valueClass(pct)}>({fmtReturn(pct)})</span></span>
        </div>;
      })}
    </div>
  </div>;
}

export default function Benchmark() {
  const [snapshots, setSnapshots] = useState([]);
  const [benchmarkRows, setBenchmarkRows] = useState({});
  const [failed, setFailed] = useState({});
  const [enabled, setEnabled] = useState(() => Object.fromEntries(BENCHMARKS.map((b) => [b.id, true])));
  const [hidden, setHidden] = useState({});
  const [range, setRange] = useState('1y');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [snapshotRows, navRows] = await Promise.all([getSnapshots(), getNavHistory()]);
        const byCode = navRows.reduce((acc, row) => {
          if (!acc[row.fundCode]) acc[row.fundCode] = [];
          acc[row.fundCode].push(row);
          return acc;
        }, {});
        const nextRows = {};
        const nextFailed = {};
        await Promise.all(BENCHMARKS.map(async (benchmark) => {
          const cached = (byCode[benchmark.code] || []).filter((row) => row.date && Number(row.nav) > 0);
          if (cached.length) {
            nextRows[benchmark.id] = cached.sort((a, b) => a.date.localeCompare(b.date));
            return;
          }
          try {
            const rows = await fetchNavHistory(benchmark.code, 365);
            const normalized = rows
              .filter((row) => row.date)
              .map((row) => ({ fundCode: benchmark.code, date: row.date, nav: Number(row.nav ?? row.unitNetWorth ?? row.netValue ?? 0), source: 'benchmark-api' }))
              .filter((row) => row.nav > 0);
            await Promise.all(normalized.map(saveNav));
            nextRows[benchmark.id] = normalized.sort((a, b) => a.date.localeCompare(b.date));
          } catch (err) {
            nextFailed[benchmark.id] = err.message || '数据获取失败';
            nextRows[benchmark.id] = [];
          }
        }));
        if (!alive) return;
        setSnapshots(snapshotRows.sort((a, b) => a.date.localeCompare(b.date)));
        setBenchmarkRows(nextRows);
        setFailed(nextFailed);
      } catch (err) {
        if (alive) setError(err.message || '加载基准数据失败');
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => { alive = false; };
  }, []);

  const { chartData, stats } = useMemo(() => {
    if (snapshots.length < 2) return { chartData: [], stats: {} };
    const selected = RANGES.find((item) => item.id === range) || RANGES[3];
    const maxDate = snapshots.at(-1)?.date;
    const cutoff = selected.days && maxDate ? new Date(toDate(maxDate).getTime() - selected.days * 86400000).toISOString().slice(0, 10) : null;
    const portfolio = snapshots.filter((row) => !cutoff || row.date >= cutoff);
    const portfolioSeries = normalizeSeries(portfolio, 'totalValue');
    const seriesMap = { portfolio: portfolioSeries };
    BENCHMARKS.forEach((benchmark) => {
      seriesMap[benchmark.id] = normalizeSeries((benchmarkRows[benchmark.id] || []).filter((row) => !cutoff || row.date >= cutoff), 'nav');
    });
    const dates = [...new Set(Object.values(seriesMap).flatMap((rows) => rows.map((row) => row.date)))].sort();
    const cursors = Object.fromEntries(Object.keys(seriesMap).map((key) => [key, { index: 0, value: null }]));
    const data = dates.map((date) => {
      const row = { date };
      Object.entries(seriesMap).forEach(([key, rows]) => {
        const cursor = cursors[key];
        while (cursor.index < rows.length && rows[cursor.index].date <= date) {
          cursor.value = rows[cursor.index].value;
          cursor.index += 1;
        }
        if (cursor.value != null) row[key] = cursor.value;
      });
      return row;
    }).filter((row) => Number.isFinite(row.portfolio));
    const last = data.at(-1) || {};
    const nextStats = { portfolio: Number.isFinite(last.portfolio) ? last.portfolio - 100 : null };
    BENCHMARKS.forEach((benchmark) => {
      nextStats[benchmark.id] = Number.isFinite(last[benchmark.id]) ? last[benchmark.id] - 100 : null;
    });
    return { chartData: data, stats: nextStats };
  }, [benchmarkRows, range, snapshots]);

  if (loading) return <div className="space-y-6"><h2 className="text-2xl font-bold text-white">基准对比</h2><div className="card flex min-h-[360px] items-center justify-center p-8"><div className="h-10 w-10 animate-spin rounded-full border-2 border-[#333333] border-t-[#3b82f6]" aria-label="加载中" /></div></div>;

  if (snapshots.length < 2) return <div className="space-y-6"><h2 className="text-2xl font-bold text-white">基准对比</h2><div className="card p-8 text-center text-[#888888]">暂无足够快照数据，刷新净值后自动生成快照，多次刷新后可查看对比图</div></div>;

  return <div className="space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><h2 className="text-2xl font-bold text-white">基准对比</h2><p className="mt-2 text-sm text-[#888888]">基准数据使用基金净值代替指数，存在跟踪误差；组合曲线为资产市值变化，包含新增投入，不代表投资收益率。</p></div>
      <div className="flex rounded-lg border border-[#333333] bg-[#111111] p-1">{RANGES.map((item) => <button key={item.id} className={`rounded-md px-3 py-1.5 text-sm ${range === item.id ? 'bg-[#3b82f6] text-white' : 'text-[#888888] hover:text-white'}`} onClick={() => setRange(item.id)}>{item.label}</button>)}</div>
    </header>
    {error && <div className="card border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}
    <section className="card p-4">
      <div className="mb-4 flex flex-wrap gap-2">{BENCHMARKS.map((benchmark) => {
        const isFailed = Boolean(failed[benchmark.id]);
        return <button key={benchmark.id} title={isFailed ? '数据获取失败' : benchmark.desc} disabled={isFailed} onClick={() => setEnabled((prev) => ({ ...prev, [benchmark.id]: !prev[benchmark.id] }))} className={`rounded-full border px-3 py-1.5 text-sm transition ${isFailed ? 'cursor-not-allowed border-[#333333] bg-[#1a1a1a] text-[#555555]' : enabled[benchmark.id] ? 'text-white' : 'border-[#333333] text-[#888888]'}`} style={!isFailed && enabled[benchmark.id] ? { borderColor: benchmark.color, background: `${benchmark.color}22` } : undefined}>{benchmark.name}</button>;
      })}</div>
      <ResponsiveContainer width="100%" height={380}>
        <LineChart data={chartData} margin={{ top: 8, right: 18, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#2a2a2a" />
          <XAxis dataKey="date" stroke="#888888" tick={{ fontSize: 12 }} />
          <YAxis stroke="#888888" tickFormatter={fmtValue} domain={["dataMin - 2", "dataMax + 2"]} label={{ value: '归一化值（起始=100）', angle: -90, position: 'insideLeft', fill: '#888888' }} />
          <Tooltip content={<CustomTooltip />} />
          <Legend onClick={(item) => setHidden((prev) => ({ ...prev, [item.dataKey]: !prev[item.dataKey] }))} />
          <Line name="我的组合" dataKey="portfolio" stroke="#ffffff" strokeWidth={2} dot={false} hide={hidden.portfolio} connectNulls />
          {BENCHMARKS.map((benchmark) => enabled[benchmark.id] && !failed[benchmark.id] ? <Line key={benchmark.id} name={benchmark.name} dataKey={benchmark.id} stroke={benchmark.color} strokeWidth={1.5} strokeDasharray="6 4" dot={false} hide={hidden[benchmark.id]} connectNulls /> : null)}
        </LineChart>
      </ResponsiveContainer>
    </section>
    <section className="card overflow-x-auto p-4">
      <h3 className="mb-3 font-semibold text-white">区间统计</h3>
      <table className="min-w-full text-sm"><thead><tr className="table-head"><th className="px-3 py-2 text-left"></th><th className="px-3 py-2 text-right">我的组合</th>{BENCHMARKS.filter((b) => enabled[b.id] && !failed[b.id]).map((b) => <th key={b.id} className="px-3 py-2 text-right">{b.name}</th>)}</tr></thead><tbody><tr className="zebra-row"><td className="px-3 py-2 text-[#888888]">区间收益</td><td className={`px-3 py-2 text-right font-semibold ${valueClass(stats.portfolio)}`}>{fmtReturn(stats.portfolio)}</td>{BENCHMARKS.filter((b) => enabled[b.id] && !failed[b.id]).map((b) => <td key={b.id} className={`px-3 py-2 text-right font-semibold ${valueClass(stats[b.id])}`}>{fmtReturn(stats[b.id])}</td>)}</tr><tr className="zebra-row"><td className="px-3 py-2 text-[#888888]">超额收益</td><td className="px-3 py-2 text-right text-[#888888]">—</td>{BENCHMARKS.filter((b) => enabled[b.id] && !failed[b.id]).map((b) => { const excess = Number.isFinite(stats.portfolio) && Number.isFinite(stats[b.id]) ? stats.portfolio - stats[b.id] : null; return <td key={b.id} className={`px-3 py-2 text-right font-semibold ${valueClass(excess)}`}>{fmtReturn(excess)}</td>; })}</tr></tbody></table>
    </section>
  </div>;
}
