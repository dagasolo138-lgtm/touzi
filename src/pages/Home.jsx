import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDcaPlans } from '../db/index.js';
import { useStore } from '../store/useStore.js';
import { formatMoney, formatPct, today } from '../utils/formatters.js';
import { isDueToday } from './DCA.jsx';

const entries = [
  ['📊', '持仓明细', '查看所有基金持仓', '/holdings'],
  ['📝', '交易记录', '录入买卖和红利再投', '/transactions'],
  ['⚖️', '再平衡', '计算追加资金配置', '/rebalance'],
  ['📈', '收益追踪', '查看组合历史收益', '/performance'],
  ['🤖', 'AI分析', '与AI讨论投资决策', '/ai'],
  ['🔀', '基准对比', '对比沪深300等基准', '/benchmark'],
  ['🛡️', '风险分析', '查看回撤和波动率', '/risk'],
  ['🗓️', '定投计划', '管理定期定额投资', '/dca'],
];

export default function Home() {
  const { summary, navMap, loadAll } = useStore();
  const [dcaDueCount, setDcaDueCount] = useState(0);

  useEffect(() => {
    loadAll();
    getDcaPlans().then((plans) => setDcaDueCount(plans.filter((plan) => isDueToday(plan, today())).length));
  }, [loadAll]);

  const updated = Object.values(navMap || {}).sort((a, b) => (b.fetchedAt || 0) - (a.fetchedAt || 0))[0]?.fetchedAt;
  const todayPnl = summary.todayPnl || 0;
  const todayPnlPct = summary.todayPnlPct || 0;

  return <div className="mx-auto max-w-4xl space-y-5"><header className="flex items-center justify-between"><h1 className="text-2xl font-semibold text-white">投资仪表盘</h1><a className="grid h-10 w-10 place-items-center rounded-full bg-[#111111] text-xl text-[#bbbbbb] active:scale-[0.97]" href="#/settings" aria-label="设置">⚙️</a></header><section className="rounded-2xl bg-[#111111] p-5 shadow-[0_0_0_1px_rgba(255,255,255,.04)]"><p className="metric-label">总市值</p><p className="mt-2 text-4xl font-bold tracking-tight text-white">{formatMoney(summary.totalValue)}</p><div className="mt-5 grid grid-cols-2 gap-4"><div><p className="metric-label">今日盈亏</p><p className={`mt-1 font-semibold ${todayPnl >= 0 ? 'good' : 'danger'}`}>{formatMoney(todayPnl)} ({formatPct(todayPnlPct)})</p></div><div><p className="metric-label">总盈亏</p><p className={`mt-1 font-semibold ${summary.totalPnl >= 0 ? 'good' : 'danger'}`}>{formatMoney(summary.totalPnl)} ({formatPct(summary.pnlPct)})</p></div></div><p className="mt-4 text-xs text-[#888888]">更新时间：{updated ? new Date(updated).toLocaleString('zh-CN') : '暂无'}</p></section><section className="grid grid-cols-2 gap-3">{entries.map(([icon, title, desc, to]) => <Link key={to} to={to} className="relative flex min-h-[116px] items-center gap-3 rounded-xl bg-[#111111] p-4 transition-transform active:scale-[0.97]"><span className="text-2xl">{icon}</span><span className="min-w-0 flex-1"><span className="block font-semibold text-white">{title}</span><span className="mt-1 block text-xs text-[#888888]">{desc}</span></span><span className="text-[#666666]">→</span>{to === '/dca' && dcaDueCount > 0 && <span className="absolute right-2 top-2 min-w-5 rounded-full bg-[#2563eb] px-1.5 py-0.5 text-center text-xs font-bold text-white">{dcaDueCount}</span>}</Link>)}</section></div>;
}
