import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatPct } from '../utils/formatters.js';

export default function PerformanceChart({ snapshots = [], twrSeries = [] }) {
  const valueData = snapshots.map((s) => ({ date: s.date, 市值: s.totalValue, 成本: s.totalCost }));
  const twrData = twrSeries.filter((row) => row.status === 'ok').map((row) => ({ date: row.endDate, 累计TWR: row.cumulativeReturn, 单期TWR: row.periodReturn }));
  return <div className="space-y-4">
    <div className="card p-4"><h3 className="mb-3 font-semibold">组合市值曲线</h3><ResponsiveContainer width="100%" height={300}><LineChart data={valueData}><CartesianGrid stroke="#3e3e42" /><XAxis dataKey="date" /><YAxis tickFormatter={(v) => formatMoney(v)} /><Tooltip formatter={(v) => formatMoney(v)} /><Legend /><Line dataKey="市值" stroke="#4ade80" /><Line dataKey="成本" stroke="#007acc" /></LineChart></ResponsiveContainer></div>
    <div className="card p-4"><h3 className="mb-3 font-semibold">时间加权收益率（TWR）</h3>{twrData.length ? <ResponsiveContainer width="100%" height={300}><LineChart data={twrData}><CartesianGrid stroke="#3e3e42" /><XAxis dataKey="date" /><YAxis tickFormatter={(v) => formatPct(v)} /><Tooltip formatter={(v) => formatPct(v)} /><Legend /><Line dataKey="累计TWR" stroke="#facc15" /><Line dataKey="单期TWR" stroke="#60a5fa" /></LineChart></ResponsiveContainer> : <p className="text-sm text-[#888888]">至少需要两个组合快照才能计算 TWR。</p>}</div>
  </div>;
}
