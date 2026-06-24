import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getConfig, getFunds, getNavHistory, getTransactions } from '../db/index.js';
import { buildFactorSnapshot } from '../utils/factorEngine.js';
import { buildPortfolio, categoryBreakdown } from '../utils/positionEngine.js';
import { today } from '../utils/formatters.js';

const fmtScore = (value) => (value == null ? '数据不足' : `${Math.round(value)}`);
const fmtPct = (value) => (value == null || !Number.isFinite(value) ? '数据不足' : `${(value * 100).toFixed(1)}%`);
const fmtNav = (value) => (value == null || !Number.isFinite(value) ? '—' : value.toFixed(4));
const trendLabels = { bullish: '偏强', bearish: '偏弱', neutral: '中性', insufficient: '数据不足' };
const volLabels = { low: '低', normal: '正常', high: '高', insufficient: '数据不足' };

function buildSnapshots({ cfg, funds, navRows, transactions }) {
  const latestMap = navRows.reduce((map, row) => (!map[row.fundCode] || row.date > map[row.fundCode].date ? { ...map, [row.fundCode]: row } : map), {});
  const portfolio = buildPortfolio(funds, transactions, latestMap);
  const breakdown = categoryBreakdown(portfolio.holdings, cfg.categories, cfg.targetAllocation);
  return cfg.categories.map((category) => {
    const signalFundCode = cfg.factorSettings.categorySignalFunds?.[category] || '';
    return buildFactorSnapshot({
      category,
      signalFundCode,
      navRows: navRows.filter((row) => row.fundCode === signalFundCode),
      actualWeight: breakdown[category]?.weight || 0,
      targetWeight: breakdown[category]?.targetWeight || 0,
      asOfDate: today(),
      settings: cfg.factorSettings,
    });
  });
}

export default function Factors() {
  const [state, setState] = useState({ cfg: null, funds: [], snapshots: [], loading: true });

  useEffect(() => {
    let alive = true;
    Promise.all([getConfig(), getFunds(), getNavHistory(), getTransactions()]).then(([cfg, funds, navRows, transactions]) => {
      if (!alive) return;
      setState({ cfg, funds, snapshots: buildSnapshots({ cfg, funds, navRows, transactions }), loading: false });
    });
    return () => { alive = false; };
  }, []);

  const fundName = useMemo(() => Object.fromEntries(state.funds.map((fund) => [fund.code, fund.name])), [state.funds]);

  if (state.loading) return <div className="card p-8 text-center text-[#888888]">因子辅助加载中...</div>;

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-2xl font-bold text-white">因子辅助</h2><p className="mt-2 text-sm text-[#888888]">量化决策辅助 V1：解释配置纪律与价格状态，不预测市场，不自动交易或改变定投金额。</p></div>
      <Link className="btn2" to="/settings">配置信号基金</Link>
    </header>
    <section className="grid gap-4 xl:grid-cols-2">
      {state.snapshots.map((snapshot) => <div key={snapshot.category} className="card p-5">
        <div className="flex items-start justify-between gap-3"><div><h3 className="text-xl font-semibold text-white">{snapshot.category}</h3><p className="mt-1 text-sm text-[#888888]">{snapshot.signalFundCode ? `${snapshot.signalFundCode} ${fundName[snapshot.signalFundCode] || ''}` : '请选择信号基金'}</p></div><span className="pill bg-[#1f2937] text-[#d1d5db]">{snapshot.factorVersion}</span></div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Metric label="配置优先级" value={fmtScore(snapshot.allocationPriority)} />
          <Metric label="价格状态分" value={fmtScore(snapshot.priceCondition.score)} />
          <Metric label="价格位置分位数" value={fmtPct(snapshot.priceCondition.raw?.percentile)} />
          <Metric label="距窗口高点回撤" value={fmtPct(snapshot.priceCondition.raw?.drawdown)} />
          <Metric label="RSI" value={snapshot.priceCondition.raw?.rsi == null ? '数据不足' : snapshot.priceCondition.raw.rsi.toFixed(1)} />
          <Metric label="数据置信度" value={`${snapshot.dataConfidence.score}`} />
        </div>
        <div className="mt-4 grid gap-2 text-sm text-[#d4d4d4] md:grid-cols-2">
          <p>MA60 / MA120 趋势状态：{trendLabels[snapshot.trendState.state]}（{fmtNav(snapshot.trendState.ma60)} / {fmtNav(snapshot.trendState.ma120)}）</p>
          <p>波动率状态：{volLabels[snapshot.volatilityState.state]}</p>
          <p>行动说明：<span className="font-semibold text-white">{snapshot.explanation}</span></p>
          <p>行动优先级：{fmtScore(snapshot.actionPriority)}</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">{snapshot.flags.length ? snapshot.flags.map((flag) => <span key={flag} className="pill bg-yellow-500/20 text-yellow-100">{flag}</span>) : <span className="pill bg-green-500/20 text-green-100">暂无风险标记</span>}</div>
      </div>)}
    </section>
  </div>;
}

function Metric({ label, value }) {
  return <div className="rounded-lg bg-[#151515] p-3"><p className="metric-label">{label}</p><p className="mt-2 text-lg font-semibold text-white">{value}</p></div>;
}
