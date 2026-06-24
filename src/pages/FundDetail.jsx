import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import TransactionForm from '../components/TransactionForm.jsx';
import { getConfig, getFund, getFunds, getNavHistory, getTransactions, saveNav } from '../db/index.js';
import { fetchNavHistory } from '../services/fundApi.js';
import { formatMoney, formatNav, formatPct, yuanToCents } from '../utils/formatters.js';
import { buildPortfolio, categoryBreakdown } from '../utils/positionEngine.js';
import { buildFactorSnapshot } from '../utils/factorEngine.js';

const RANGE_OPTIONS = [
  ['1m', '1月', 30],
  ['3m', '3月', 90],
  ['6m', '6月', 180],
  ['1y', '1年', 365],
  ['all', '全部', Infinity],
];

const TX_TYPE_LABEL = { buy: '买入', sell: '卖出', reinvest: '红利再投' };

function calcMA(data, period) {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    return slice.reduce((sum, d) => sum + Number(d.nav || 0), 0) / period;
  });
}

function calcRSI(data, period = 14) {
  const changes = data.slice(1).map((d, i) => Number(d.nav || 0) - Number(data[i].nav || 0));
  return data.map((_, i) => {
    if (i < period) return null;
    const slice = changes.slice(i - period, i);
    const gains = slice.filter((change) => change > 0).reduce((sum, change) => sum + change, 0) / period;
    const losses = Math.abs(slice.filter((change) => change < 0).reduce((sum, change) => sum + change, 0)) / period;
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  });
}

function TriangleDot({ cx, cy, fill, direction = 'up' }) {
  if (cx == null || cy == null) return null;
  const points = direction === 'up'
    ? `${cx},${cy - 8} ${cx - 6},${cy + 5} ${cx + 6},${cy + 5}`
    : `${cx},${cy + 8} ${cx - 6},${cy - 5} ${cx + 6},${cy - 5}`;
  return <polygon points={points} fill={fill} stroke="white" strokeWidth={1} />;
}

function Skeleton() {
  return <div className="space-y-6 animate-pulse">
    <div className="h-16 rounded-lg bg-[#222]" />
    <div className="grid gap-4 md:grid-cols-4">{[1, 2, 3, 4].map((n) => <div key={n} className="h-24 rounded-lg bg-[#222]" />)}</div>
    <div className="h-[520px] rounded-lg bg-[#222]" />
  </div>;
}

export default function FundDetail() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [fund, setFund] = useState(null);
  const [funds, setFunds] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [navHistory, setNavHistory] = useState([]);
  const [range, setRange] = useState('3m');
  const [showMA, setShowMA] = useState({ ma5: true, ma20: true, ma60: true });
  const [showTxModal, setShowTxModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState(null);
  const [showPriceState, setShowPriceState] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [fundRow, fundRows, txRows, navRows, cfg] = await Promise.all([getFund(code), getFunds(true), getTransactions(), getNavHistory(), getConfig()]);
      setFund(fundRow || { code, name: `基金 ${code}`, category: '未分类' });
      setFunds(fundRows);
      setTransactions(txRows.filter((tx) => tx.fundCode === code));
      setNavHistory(navRows.filter((nav) => nav.fundCode === code).sort((a, b) => a.date.localeCompare(b.date)));
      setConfig(cfg);
      setError('');
    } catch (err) {
      setError(err.message || '基金详情加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [code]);

  const latestNavRow = navHistory.at(-1);
  const position = useMemo(() => buildPortfolio(
    fund ? [fund] : [],
    transactions,
    latestNavRow ? { [code]: { nav: latestNavRow.nav, date: latestNavRow.date } } : {},
  ).holdings[0] || { shares: 0, totalCost: 0, totalFee: 0, unrealizedPnl: 0, value: 0, avgCost: 0 }, [code, fund, latestNavRow, transactions]);
  const latestNav = latestNavRow?.nav || 0;
  const marketValue = position.value;
  const pnl = position.unrealizedPnl;
  const pnlPct = position.pnlPct;
  const avgCost = position.avgCost;
  const hasHolding = position.shares > 0;

  const chartData = useMemo(() => {
    const selected = RANGE_OPTIONS.find(([key]) => key === range) || RANGE_OPTIONS[1];
    const days = selected[2];
    const cutoff = Number.isFinite(days) ? new Date(Date.now() - days * 86400000).toISOString().slice(0, 10) : '';
    const filtered = navHistory.filter((row) => !cutoff || row.date >= cutoff).map((row) => ({ date: row.date, nav: Number(row.nav || 0) }));
    const ma5 = calcMA(filtered, 5);
    const ma20 = calcMA(filtered, 20);
    const ma60 = calcMA(filtered, 60);
    const rsi14 = calcRSI(filtered, 14);
    const txByDate = transactions.reduce((map, tx) => ({ ...map, [tx.date]: [...(map[tx.date] || []), tx] }), {});
    return filtered.map((row, index) => {
      const txs = txByDate[row.date] || [];
      const buy = txs.find((tx) => tx.type === 'buy' || tx.type === 'reinvest');
      const sell = txs.find((tx) => tx.type === 'sell');
      return {
        ...row,
        ma5: ma5[index],
        ma20: ma20[index],
        ma60: ma60[index],
        rsi14: rsi14[index],
        buyNav: buy ? row.nav : null,
        sellNav: sell ? row.nav : null,
      };
    });
  }, [navHistory, range, transactions]);

  const latestPoint = chartData.at(-1) || {};
  const recent30 = chartData.slice(-30).map((row) => row.nav).filter(Boolean);
  const supportLevel = recent30.length ? Math.min(...recent30) : 0;
  const resistanceLevel = recent30.length ? Math.max(...recent30) : 0;
  const trend = latestPoint.ma5 && latestPoint.ma20 && latestPoint.ma60
    ? latestPoint.ma5 > latestPoint.ma20 && latestPoint.ma20 > latestPoint.ma60
      ? '多头'
      : latestPoint.ma5 < latestPoint.ma20 && latestPoint.ma20 < latestPoint.ma60
        ? '空头'
        : '震荡'
    : '数据不足';


  const priceSnapshot = useMemo(() => {
    if (!fund || !config) return null;
    const latestMap = navHistory.length ? { [code]: latestNavRow } : {};
    const allPortfolio = buildPortfolio(funds, transactions, latestMap);
    const breakdown = categoryBreakdown(allPortfolio.holdings, config.categories, config.targetAllocation);
    return buildFactorSnapshot({ category: fund.category, signalFundCode: code, navRows: navHistory, actualWeight: breakdown[fund.category]?.weight || 0, targetWeight: breakdown[fund.category]?.targetWeight || 0, asOfDate: new Date().toISOString().slice(0, 10), settings: config.factorSettings });
  }, [code, config, fund, funds, latestNavRow, navHistory, transactions]);

  async function refreshHistory() {
    setRefreshing(true);
    try {
      const rows = await fetchNavHistory(code, 180);
      await Promise.all(rows.filter((row) => row.date).map((row) => saveNav({ fundCode: code, date: row.date, nav: Number(row.nav ?? row.unitNetWorth ?? row.netValue ?? 0), source: 'api' })));
      await load();
    } catch (err) {
      setError(err.message || '刷新净值失败');
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <Skeleton />;

  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <button className="mb-3 text-sm text-[#3b82f6] hover:text-[#93c5fd]" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/holdings'))}>← 返回</button>
        <h2 className="text-2xl font-bold text-white">{fund?.name}</h2>
        <div className="mt-2 flex items-center gap-2 text-sm text-[#888888]"><span>{code}</span><span className="pill">{fund?.category || '未分类'}</span></div>
      </div>
      <Link className="btn2" to="/holdings">返回持仓</Link>
    </header>

    {error && <p className="danger">{error}</p>}

    <section className="grid gap-4 md:grid-cols-4">
      <div className="card p-5"><p className="metric-label">持有份额</p><p className="mt-3 text-2xl font-bold text-white">{hasHolding ? position.shares.toFixed(2) : '暂无持仓'}</p></div>
      <div className="card p-5"><p className="metric-label">当前净值</p><p className="mt-3 text-2xl font-bold text-white">{latestNav ? formatNav(latestNav) : '--'}</p></div>
      <div className="card p-5"><p className="metric-label">持有市值</p><p className="mt-3 text-2xl font-bold text-white">{hasHolding ? formatMoney(marketValue) : '暂无持仓'}</p></div>
      <div className="card p-5"><p className="metric-label">盈亏</p><p className={`mt-3 text-2xl font-bold ${pnl >= 0 ? 'good' : 'danger'}`}>{hasHolding ? `${formatMoney(pnl)} (${formatPct(pnlPct)})` : '暂无持仓'}</p></div>
    </section>

    {navHistory.length < 60 && <div className="card flex flex-wrap items-center justify-between gap-3 border-yellow-500/40 bg-yellow-500/10 p-4">
      <p className="text-yellow-100">净值历史数据不足，点击刷新净值获取更多数据</p>
      <button className="btn" disabled={refreshing} onClick={refreshHistory}>{refreshing ? '刷新中...' : '刷新净值'}</button>
    </div>}


    <section className="card p-4">
      <button className="flex w-full items-center justify-between text-left font-semibold text-white" onClick={() => setShowPriceState((value) => !value)}><span>价格状态</span><span className="text-[#888888]">{showPriceState ? '收起' : '展开'}</span></button>
      {showPriceState && <div className="mt-4 grid gap-3 text-sm text-[#d4d4d4] md:grid-cols-3">
        <p>价格状态分：{priceSnapshot?.priceCondition.score == null ? '数据不足' : priceSnapshot.priceCondition.score}</p>
        <p>价格位置分位数：{priceSnapshot?.priceCondition.raw?.percentile == null ? '数据不足' : `${(priceSnapshot.priceCondition.raw.percentile * 100).toFixed(1)}%`}</p>
        <p>距窗口高点回撤：{priceSnapshot?.priceCondition.raw?.drawdown == null ? '数据不足' : `${(priceSnapshot.priceCondition.raw.drawdown * 100).toFixed(1)}%`}</p>
        <p>RSI：{priceSnapshot?.priceCondition.raw?.rsi == null ? '数据不足' : priceSnapshot.priceCondition.raw.rsi.toFixed(1)}</p>
        <p>数据置信度：{priceSnapshot?.dataConfidence.score ?? '数据不足'}</p>
        <p>行动说明：{priceSnapshot?.explanation || '数据不足，暂不生成行动提示'}</p>
      </div>}
    </section>

    <section className="card p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">{RANGE_OPTIONS.map(([key, label]) => <button key={key} className={range === key ? 'btn' : 'btn2'} onClick={() => setRange(key)}>{label}</button>)}</div>
        <div className="flex gap-2">{[['ma5', 'MA5'], ['ma20', 'MA20'], ['ma60', 'MA60']].map(([key, label]) => <button key={key} className={showMA[key] ? 'btn' : 'btn2'} onClick={() => setShowMA((value) => ({ ...value, [key]: !value[key] }))}>{label}</button>)}</div>
      </div>

      <div className="h-[380px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 24, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="#333" strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke="#888" minTickGap={28} />
            <YAxis stroke="#888" domain={["dataMin - 0.02", "dataMax + 0.02"]} tickFormatter={(value) => Number(value).toFixed(3)} />
            <Tooltip contentStyle={{ background: '#1e1e1e', border: '1px solid #333' }} formatter={(value, name) => [value == null ? '--' : Number(value).toFixed(4), { nav: '净值', ma5: 'MA5', ma20: 'MA20', ma60: 'MA60', buyNav: '买入点', sellNav: '卖出点' }[name] || name]} labelFormatter={(label) => `日期：${label}`} />
            {hasHolding && avgCost > 0 && <ReferenceLine y={avgCost} stroke="#f97316" strokeDasharray="6 4" label={{ value: '持有成本', fill: '#f97316', position: 'insideTopRight' }} />}
            <Line type="monotone" dataKey="nav" stroke="#3b82f6" dot={false} strokeWidth={2} isAnimationActive={false} />
            {showMA.ma5 && <Line type="monotone" dataKey="ma5" stroke="#7dd3fc" dot={false} strokeWidth={1} isAnimationActive={false} />}
            {showMA.ma20 && <Line type="monotone" dataKey="ma20" stroke="#facc15" dot={false} strokeWidth={1} isAnimationActive={false} />}
            {showMA.ma60 && <Line type="monotone" dataKey="ma60" stroke="#a78bfa" dot={false} strokeWidth={1} isAnimationActive={false} />}
            <Line dataKey="buyNav" stroke="transparent" dot={(props) => <TriangleDot {...props} fill="#22c55e" direction="up" />} activeDot={false} isAnimationActive={false} />
            <Line dataKey="sellNav" stroke="transparent" dot={(props) => <TriangleDot {...props} fill="#ef4444" direction="down" />} activeDot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="#333" strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke="#888" minTickGap={28} />
            <YAxis stroke="#888" domain={[0, 100]} />
            <Tooltip contentStyle={{ background: '#1e1e1e', border: '1px solid #333' }} formatter={(value) => [value == null ? '--' : Number(value).toFixed(2), 'RSI14']} labelFormatter={(label) => `日期：${label}`} />
            <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="5 5" />
            <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="5 5" />
            <Line type="monotone" dataKey="rsi14" stroke="#f5f5f5" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>

    <section className="grid gap-4 md:grid-cols-4">
      <div className="card p-5"><p className="metric-label">当前RSI</p><p className="mt-3 text-xl font-bold text-white">{latestPoint.rsi14 == null ? '--' : latestPoint.rsi14.toFixed(2)}</p></div>
      <div className="card p-5"><p className="metric-label">趋势判断</p><p className="mt-3 text-xl font-bold text-white">{trend}</p></div>
      <div className="card p-5"><p className="metric-label">支撑位</p><p className="mt-3 text-xl font-bold text-white">{supportLevel ? formatNav(supportLevel) : '--'}</p></div>
      <div className="card p-5"><p className="metric-label">阻力位</p><p className="mt-3 text-xl font-bold text-white">{resistanceLevel ? formatNav(resistanceLevel) : '--'}</p></div>
    </section>

    <section className="card overflow-auto p-4">
      <div className="mb-4 flex items-center justify-between"><h3 className="font-semibold text-white">交易记录</h3><button className="btn" onClick={() => setShowTxModal(true)}>+ 新增交易</button></div>
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-[#888888]"><tr>{['日期', '类型', '份额', '净值', '金额'].map((head) => <th key={head} className="p-3">{head}</th>)}</tr></thead>
        <tbody>{[...transactions].sort((a, b) => b.date.localeCompare(a.date)).map((tx) => <tr key={tx.id} className="border-t border-vscode-border"><td className="p-3">{tx.date}</td><td>{TX_TYPE_LABEL[tx.type] || tx.type}</td><td>{Number(tx.shares || 0).toFixed(2)}</td><td>{formatNav(tx.price)}</td><td>{formatMoney(tx.amountCents || yuanToCents(tx.amount))}</td></tr>)}</tbody>
      </table>
      {transactions.length === 0 && <p className="py-6 text-center text-[#888888]">暂无交易记录</p>}
    </section>

    {showTxModal && <div className="modal-backdrop fixed inset-0 z-40 grid place-items-center p-4">
      <div className="w-full max-w-4xl">
        <TransactionForm funds={funds.some((row) => row.code === code) ? funds.filter((row) => row.code === code) : [fund]} onSaved={async () => { setShowTxModal(false); await load(); }} />
        <button className="btn2 mt-3 w-full" onClick={() => setShowTxModal(false)}>关闭</button>
      </div>
    </div>}
  </div>;
}
