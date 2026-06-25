import { useEffect, useMemo, useState } from 'react';
import PerformanceChart from '../components/PerformanceChart.jsx';
import { getSnapshots, getTransactions } from '../db/index.js';
import { calculateTwrSeries, summarizeTwr } from '../utils/twrEngine.js';
import { formatMoney, formatPct } from '../utils/formatters.js';

export default function Performance() {
  const [snapshots, setSnapshots] = useState([]);
  const [transactions, setTransactions] = useState([]);
  useEffect(() => { Promise.all([getSnapshots(), getTransactions()]).then(([s, t]) => { setSnapshots(s); setTransactions(t); }).catch(() => { setSnapshots([]); setTransactions([]); }); }, []);
  const twrResult = useMemo(() => calculateTwrSeries({ snapshots, transactions }), [snapshots, transactions]);
  const twrSummary = useMemo(() => summarizeTwr(twrResult), [twrResult]);
  const last = snapshots.at(-1);
  const pnl = (last?.totalValue || 0) - (last?.totalCost || 0);
  return <div className="space-y-6"><h2 className="text-2xl font-bold text-white">收益追踪</h2><div className="grid gap-4 md:grid-cols-4"><div className="card p-4">累计 TWR <b className={(twrSummary.cumulativeReturn || 0) >= 0 ? 'good' : 'danger'}>{twrSummary.performanceMethod === 'twr' ? formatPct(twrSummary.cumulativeReturn) : '数据不足'}</b><p className="mt-1 text-xs text-[#888888]">剔除买入/卖出现金流影响的组合表现</p></div><div className="card p-4">账面盈亏 <b className={pnl >= 0 ? 'good' : 'danger'}>{formatMoney(pnl)} {formatPct(last?.totalCost ? pnl / last.totalCost : 0)}</b><p className="mt-1 text-xs text-[#888888]">市值 - 成本，非 TWR</p></div><div className="card p-4">累计投入 <b>{formatMoney(last?.totalCost || 0)}</b></div><div className="card p-4">当前市值 <b>{formatMoney(last?.totalValue || 0)}</b></div></div>{twrSummary.performanceMethod !== 'twr' && <p className="rounded-lg border border-vscode-border bg-[#181818] p-3 text-sm text-[#888888]">至少需要两个组合快照才能计算时间加权收益率（TWR）；在此之前，账面盈亏不能代表组合真实投资表现。</p>}<PerformanceChart snapshots={snapshots} twrSeries={twrResult.series} /></div>;
}
