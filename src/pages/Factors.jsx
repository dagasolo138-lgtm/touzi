import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getConfig, getFunds, getNavHistory, getTransactions } from '../db/index.js';
import { buildCategoryFactorSnapshots } from '../services/factorContext.js';
import { syncFactorSignalHistory } from '../services/factorDataService.js';
import { today } from '../utils/formatters.js';

const fmtScore = (value) => (value == null ? '数据不足' : `${Math.round(value)}`);
const fmtPct = (value) => (value == null || !Number.isFinite(value) ? '数据不足' : `${(value * 100).toFixed(1)}%`);
const fmtNav = (value) => (value == null || !Number.isFinite(value) ? '—' : value.toFixed(4));
const trendLabels = { bullish: '偏强', bearish: '偏弱', neutral: '中性', insufficient: '数据不足' };
const volLabels = { low: '低', normal: '正常', high: '高', insufficient: '数据不足' };

export default function Factors() {
  const [state, setState] = useState({ cfg: null, funds: [], navRows: [], snapshots: [], loading: true });
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState('');
  const [syncResult, setSyncResult] = useState(null);

  async function load() {
    const [cfg, funds, navRows, transactions] = await Promise.all([getConfig(), getFunds(), getNavHistory(), getTransactions()]);
    const result = buildCategoryFactorSnapshots({ config: cfg, funds, transactions, navRows, asOfDate: today() });
    setState({ cfg, funds, navRows, snapshots: result.snapshots, loading: false });
  }

  useEffect(() => { load(); }, []);

  const fundName = useMemo(() => Object.fromEntries(state.funds.map((fund) => [fund.code, fund.name])), [state.funds]);
  const signalStats = useMemo(() => {
    const codes = [...new Set(Object.values(state.cfg?.factorSettings?.categorySignalFunds || {}).filter(Boolean))];
    return codes.map((code) => {
      const rows = state.navRows.filter((row) => row.fundCode === code && Number(row.nav) > 0).sort((a, b) => a.date.localeCompare(b.date));
      return { code, name: fundName[code] || '', count: rows.length, latestDate: rows.at(-1)?.date || '—' };
    });
  }, [fundName, state.cfg, state.navRows]);

  async function runSync() {
    if (!signalStats.length) return;
    setSyncing(true);
    setSyncResult(null);
    setProgress('准备同步...');
    const result = await syncFactorSignalHistory({ config: state.cfg, funds: state.funds, onProgress: (evt) => setProgress(`${evt.code}：${evt.status}${evt.message ? `（${evt.message}）` : ''}`) });
    setSyncResult(result);
    await load();
    setSyncing(false);
  }

  if (state.loading) return <div className="card p-8 text-center text-[#888888]">因子辅助加载中...</div>;

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-2xl font-bold text-white">因子辅助</h2><p className="mt-2 text-sm text-[#888888]">量化决策辅助 V1：解释配置纪律与价格状态，不预测市场，不自动交易或改变定投金额。</p></div>
      <div className="flex flex-wrap gap-2"><button className="btn" disabled={syncing || !signalStats.length} onClick={runSync}>{syncing ? '同步中...' : '同步因子历史数据'}</button><Link className="btn2" to="/settings">配置信号基金</Link></div>
    </header>
    {!signalStats.length && <div className="card border-yellow-500/40 bg-yellow-500/10 p-4 text-yellow-100">尚未配置类别信号基金，请先去设置页配置。</div>}
    {progress && <p className="text-sm text-[#888888]">{progress}</p>}
    {syncResult?.failed?.length > 0 && <div className="card p-4 text-sm text-yellow-100">{syncResult.failed.map((item) => <p key={item.code}>{item.code}：{item.message}</p>)}</div>}
    {signalStats.length > 0 && <section className="card p-4"><h3 className="font-semibold text-white">信号基金本地历史</h3><div className="mt-3 grid gap-2 text-sm text-[#d4d4d4] md:grid-cols-2">{signalStats.map((item) => <p key={item.code}>{item.code} {item.name}：有效 {item.count} 条，最新 {item.latestDate}</p>)}</div></section>}
    <section className="grid gap-4 xl:grid-cols-2">
      {state.snapshots.map((snapshot) => <div key={snapshot.category} className="card p-5">
        <div className="flex items-start justify-between gap-3"><div><h3 className="text-xl font-semibold text-white">{snapshot.category}</h3><p className="mt-1 text-sm text-[#888888]">{snapshot.signalFundCode ? `${snapshot.signalFundCode} ${fundName[snapshot.signalFundCode] || ''}` : '请选择信号基金'}</p></div><span className="pill bg-[#1f2937] text-[#d1d5db]">{snapshot.factorVersion}</span></div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3"><Metric label="配置优先级" value={fmtScore(snapshot.allocationPriority)} /><Metric label="价格状态分" value={fmtScore(snapshot.priceCondition.score)} /><Metric label="价格位置分位数" value={fmtPct(snapshot.priceCondition.raw?.percentile)} /><Metric label="距窗口高点回撤" value={fmtPct(snapshot.priceCondition.raw?.drawdown)} /><Metric label="RSI" value={snapshot.priceCondition.raw?.rsi == null ? '数据不足' : snapshot.priceCondition.raw.rsi.toFixed(1)} /><Metric label="数据置信度" value={`${snapshot.dataConfidence.score}`} /></div>
        <div className="mt-4 grid gap-2 text-sm text-[#d4d4d4] md:grid-cols-2"><p>MA60 / MA120 趋势状态：{trendLabels[snapshot.trendState.state]}（{fmtNav(snapshot.trendState.ma60)} / {fmtNav(snapshot.trendState.ma120)}）</p><p>波动率状态：{volLabels[snapshot.volatilityState.state]}</p><p>行动说明：<span className="font-semibold text-white">{snapshot.explanation}</span></p><p>行动优先级：{fmtScore(snapshot.actionPriority)}</p><p className="text-[#888888]">权重：配置{((snapshot.appliedWeights?.allocation ?? 0) * 100).toFixed(0)}% / 价格{((snapshot.appliedWeights?.price ?? 0) * 100).toFixed(0)}%</p></div>
        <div className="mt-4 flex flex-wrap gap-2">{snapshot.flags.length ? snapshot.flags.map((flag) => <span key={flag} className="pill bg-yellow-500/20 text-yellow-100">{flag}</span>) : <span className="pill bg-green-500/20 text-green-100">暂无风险标记</span>}</div>
      </div>)}
    </section>
  </div>;
}

function Metric({ label, value }) {
  return <div className="rounded-lg bg-[#151515] p-3"><p className="metric-label">{label}</p><p className="mt-2 text-lg font-semibold text-white">{value}</p></div>;
}
