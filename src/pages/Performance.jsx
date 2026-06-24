import { useEffect, useState } from 'react';
import PerformanceChart from '../components/PerformanceChart.jsx';
import { getSnapshots } from '../db/index.js';
import { formatMoney, formatPct } from '../utils/formatters.js';
export default function Performance(){ const [snapshots,setSnapshots]=useState([]); useEffect(()=>{getSnapshots().then(setSnapshots).catch(()=>setSnapshots([]));},[]); const last=snapshots.at(-1); const pnl=(last?.totalValue||0)-(last?.totalCost||0); return <div className="space-y-6"><h2 className="text-2xl font-bold text-white">收益追踪</h2><div className="grid gap-4 md:grid-cols-3"><div className="card p-4">累计收益 <b className={pnl>=0?'good':'danger'}>{formatMoney(pnl)} {formatPct(last?.totalCost?pnl/last.totalCost:0)}</b></div><div className="card p-4">累计投入 <b>{formatMoney(last?.totalCost||0)}</b></div><div className="card p-4">当前市值 <b>{formatMoney(last?.totalValue||0)}</b></div></div><PerformanceChart snapshots={snapshots}/></div> }
