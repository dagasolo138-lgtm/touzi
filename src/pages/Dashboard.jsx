import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AllocationChart from '../components/AllocationChart.jsx';
import { getDcaPlans } from '../db/index.js';
import { useStore } from '../store/useStore.js';
import { formatMoney, formatPct, today } from '../utils/formatters.js';
import { isDueToday } from './DCA.jsx';

export default function Dashboard(){
  const {summary,config,loadAll,getBreakdown}=useStore();
  const [duePlans,setDuePlans]=useState([]);
  useEffect(()=>{loadAll(); getDcaPlans().then((plans)=>setDuePlans(plans.filter((plan)=>isDueToday(plan,today()))));},[loadAll]);
  const updated=Object.values(useStore.getState().navMap||{}).sort((a,b)=>b.fetchedAt-a.fetchedAt)[0]?.fetchedAt;
  const cards=[['总市值',formatMoney(summary.totalValue),''],['总盈亏',`${formatMoney(summary.totalPnl)} (${formatPct(summary.pnlPct)})`,summary.totalPnl>=0?'good':'danger'],['今日收益','请刷新后由快照对比',''],['组合更新时间',updated?new Date(updated).toLocaleString('zh-CN'):'暂无','']];
  return <div className="space-y-6"><div><p className="metric-label">Portfolio Overview</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">持仓总览</h2></div>{duePlans.length>0&&<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#1d4ed8] bg-[#1d4ed8]/30 p-4 text-white"><div className="flex items-center gap-3"><span className="text-2xl">📅</span><p>今日有 {duePlans.length} 笔定投待执行：{duePlans.map((plan)=>`${plan.fundName} ¥${Number(plan.amount).toLocaleString('zh-CN')}`).join('、')}</p></div><a className="btn" href="#/dca">去执行</a></div>}<div className="grid gap-4 md:grid-cols-4">{cards.map(c=><div className="card p-5" key={c[0]}><p className="metric-label">{c[0]}</p><p className={`mt-3 text-2xl font-bold tracking-tight ${c[2]}`}>{c[1]}</p></div>)}</div><AllocationChart breakdown={getBreakdown()} targetAllocation={config?.targetAllocation||{}}/><div className="card p-5"><h3 className="mb-4 font-semibold text-white">持仓列表</h3>{summary.holdings.length===0?<p className="text-[#888888]">暂无持仓，前往<Link className="text-[#3b82f6]" to="/holdings">持仓明细</Link>添加基金。</p>:<div className="divide-y divide-[#222222]">{summary.holdings.map(h=><Link to="/holdings" key={h.code} className="flex items-center justify-between gap-4 rounded-lg px-2 py-3 transition-colors hover:bg-[#1a1a1a]"><span className="min-w-0"><span className="block truncate text-white">{h.name}</span><span className="pill mt-2">{h.category}</span></span><span className="text-right"><span className="block font-semibold text-white">{formatMoney(h.value)}</span><b className={h.pnl>=0?'good':'danger'}>{formatPct(h.pnlPct)}</b></span></Link>)}</div>}</div></div>;
}
