import { useEffect, useMemo, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { deleteDcaPlan, getConfig, getDcaPlans, getFunds, getNavHistory, getTransactions, saveDcaPlan, saveTransaction } from '../db/index.js';
import { calcRSI } from '../utils/riskEngine.js';
import { buildPortfolio } from '../utils/positionEngine.js';
import { buildCategoryFactorSnapshots } from '../services/factorContext.js';
import { suggestDcaMultiplier } from '../utils/factorEngine.js';
import { formatMoney, makeId, today, yuanToCents } from '../utils/formatters.js';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const frequencyLabels = { daily: '每个工作日', weekly: '每周', biweekly: '每两周', monthly: '每月' };
const toDate = (value) => new Date(`${value}T00:00:00`);
const dateStr = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const lastDayOfMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
const monthlyDueDay = (plan, date) => Math.min(Number(plan.dayOfMonth) || 1, lastDayOfMonth(date));

export function isDueToday(plan, todayStr) {
  if (!plan || plan.status !== 'active' || plan.lastExecutedDate === todayStr) return false;
  const current = toDate(todayStr);
  const start = toDate(plan.startDate || todayStr);
  if (current < start) return false;
  const day = current.getDay();

  if (plan.frequency === 'daily') return day >= 1 && day <= 5;
  if (plan.frequency === 'weekly') return day === Number(plan.dayOfWeek);
  if (plan.frequency === 'biweekly') {
    const diffDays = Math.floor((current - start) / 86400000);
    const weeks = Math.floor(diffDays / 7);
    return day === Number(plan.dayOfWeek) && weeks % 2 === 0;
  }
  if (plan.frequency === 'monthly') return current.getDate() === monthlyDueDay(plan, current);
  return false;
}

export function getNextDueDate(plan, fromDate = today()) {
  const from = typeof fromDate === 'string' ? toDate(fromDate) : fromDate;
  for (let i = 0; i < 380; i += 1) {
    const candidate = addDays(from, i);
    const value = dateStr(candidate);
    if (isDueToday(plan, value)) return value;
  }
  return '';
}

function describeFrequency(plan) {
  if (plan.frequency === 'daily') return frequencyLabels.daily;
  if (plan.frequency === 'weekly') return `每周${WEEKDAYS[Number(plan.dayOfWeek)].replace('周', '')}`;
  if (plan.frequency === 'biweekly') return `每两周${WEEKDAYS[Number(plan.dayOfWeek)].replace('周', '')}`;
  if (plan.frequency === 'monthly') return `每月${plan.dayOfMonth}日`;
  return frequencyLabels[plan.frequency] || plan.frequency;
}

function formatDateLabel(value) {
  if (!value) return '--';
  const date = toDate(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function planExecutionTransactions(plan, transactions) {
  return transactions
    .filter((tx) => tx.fundCode === plan.fundCode && tx.type === 'buy' && tx.notes === '定投执行' && (!plan.startDate || tx.date >= plan.startDate))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

function navForDate(fundCode, date, navRows, fallbackPrice) {
  const nav = navRows
    .filter((row) => row.fundCode === fundCode && row.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date))[0]?.nav;
  return Number(nav || fallbackPrice || 0);
}

function buildChartData(plan, navRows, transactions) {
  const executed = planExecutionTransactions(plan, transactions);
  const points = [];
  let invested = 0;
  let shares = 0;
  let firstExecutionNav = 0;

  for (const tx of executed) {
    const nav = navForDate(plan.fundCode, tx.date, navRows, tx.price);
    const amount = (Number(tx.amountCents) || yuanToCents(tx.amount)) / 100;
    const txShares = Number(tx.shares) || (nav ? amount / nav : 0);
    if (nav > 0 && amount > 0) {
      if (!firstExecutionNav) firstExecutionNav = nav;
      invested += amount;
      shares += txShares;
      const dcaValue = shares * nav;
      const lumpShares = firstExecutionNav ? invested / firstExecutionNav : 0;
      const lumpValue = lumpShares * nav;
      points.push({ date: tx.date, dca: invested ? (dcaValue / invested) * 100 : 100, lump: invested ? (lumpValue / invested) * 100 : 100 });
    }
  }
  return points;
}

function executionStats(plan, transactions) {
  const related = planExecutionTransactions(plan, transactions);
  const shares = related.reduce((sum, tx) => sum + (Number(tx.shares) || 0), 0);
  const amountCents = related.reduce((sum, tx) => sum + (Number(tx.amountCents) || yuanToCents(tx.amount)), 0);
  return { count: related.length, invested: amountCents / 100, avgCost: shares ? amountCents / 100 / shares : 0 };
}

function rsiHint(plan, navRows) {
  const rows = navRows.filter((r) => r.fundCode === plan.fundCode).sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  if (rows.length < 15) return { text: '净值历史不足，暂无RSI提示', cls: 'text-[#888888]' };
  const value = calcRSI(rows, 14);
  if (value == null) return { text: '净值历史不足，暂无RSI提示', cls: 'text-[#888888]' };
  if (value < 30) return { text: `当前RSI=${value.toFixed(2)}，处于低位区间，仅作为价格状态参考`, cls: 'good' };
  if (value > 70) return { text: `当前RSI=${value.toFixed(2)}，处于高位区间，仅作为价格状态参考`, cls: 'text-yellow-400' };
  return { text: `当前RSI=${value.toFixed(2)}，处于正常区间`, cls: 'text-[#888888]' };
}

export default function DCA() {
  const [plans, setPlans] = useState([]);
  const [funds, setFunds] = useState([]);
  const [navRows, setNavRows] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [config, setConfig] = useState(null);
  const [editing, setEditing] = useState(null);
  const [executing, setExecuting] = useState(null);
  const [executeError, setError] = useState('');
  const [executeSaving, setExecuteSaving] = useState(false);
  const [expanded, setExpanded] = useState({});
  const todayStr = today();

  async function load() {
    const [txData, fundsData, plansData, navData, cfg] = await Promise.all([getTransactions(), getFunds(), getDcaPlans(), getNavHistory(), getConfig()]);
    setTransactions(txData);
    setFunds(fundsData);
    setPlans(plansData);
    setNavRows(navData);
    setConfig(cfg);
  }

  useEffect(() => { load(); }, []);

  const navMap = useMemo(() => navRows.reduce((map, row) => (!map[row.fundCode] || row.date > map[row.fundCode].date ? { ...map, [row.fundCode]: row } : map), {}), [navRows]);
  const summary = useMemo(() => buildPortfolio(funds, transactions, navMap), [funds, transactions, navMap]);
  const factorResult = useMemo(() => (config ? buildCategoryFactorSnapshots({ config, funds, transactions, navRows, asOfDate: todayStr }) : null), [config, funds, navRows, todayStr, transactions]);

  async function savePlan(values) {
    const fund = funds.find((f) => f.code === values.fundCode);
    await saveDcaPlan({ ...values, fundName: fund?.name || values.fundName || '', amount: Number(values.amount) || 0, dayOfWeek: Number(values.dayOfWeek) || 1, dayOfMonth: Number(values.dayOfMonth) || 1 });
    setEditing(null);
    await load();
  }

  async function toggle(plan) {
    await saveDcaPlan({ ...plan, status: plan.status === 'active' ? 'paused' : 'active' });
    await load();
  }

  async function remove(plan) {
    if (confirm('确认删除该定投计划？')) {
      await deleteDcaPlan(plan.id);
      await load();
    }
  }

  async function confirmExecute(payload) {
    const today = new Date().toISOString().split('T')[0];
    if (executing.lastExecutedDate === today) {
      setError('今日已执行过该定投计划，请勿重复操作');
      return;
    }

    const totalAmount = Number(payload.totalAmount) || 0;
    const fee = Number(payload.fee) || 0;
    const price = Number(payload.price) || 0;
    const amount = totalAmount - fee;
    const shares = Number(payload.shares) || (price ? amount / price : 0);

    if (totalAmount <= 0) {
      setError('计划金额必须大于0');
      return;
    }
    if (fee < 0) {
      setError('手续费不能小于0');
      return;
    }
    if (amount <= 0) {
      setError('扣除手续费后的确认金额必须大于0');
      return;
    }
    if (price <= 0) {
      setError('确认净值必须大于0');
      return;
    }
    if (shares <= 0) {
      setError('确认份额必须大于0');
      return;
    }

    setExecuteSaving(true);
    try {
      await saveTransaction({ date: todayStr, fundCode: executing.fundCode, type: 'buy', shares, price, amount, amountCents: yuanToCents(amount), fee, feeCents: yuanToCents(fee), notes: '定投执行' });
      await saveDcaPlan({ ...executing, lastExecutedDate: todayStr, executionCount: (Number(executing.executionCount) || 0) + 1 });
      setExecuting(null);
      setError('');
      await load();
    } finally {
      setExecuteSaving(false);
    }
  }

  return <div className="space-y-6"><div className="flex items-center justify-between"><h2 className="text-2xl font-bold text-white">定投计划</h2><button className="btn" onClick={() => setEditing({ frequency: 'monthly', dayOfWeek: 1, dayOfMonth: 1, startDate: todayStr, status: 'active', note: '', amount: '', fundCode: funds[0]?.code || '' })}>+ 新建计划</button></div>{plans.length === 0 ? <div className="card p-8 text-center text-[#888888]">还没有定投计划，点击「新建计划」开始设置</div> : <div className="grid gap-4">{plans.map((plan) => { const due = isDueToday(plan, todayStr); const done = plan.lastExecutedDate === todayStr; const holding = summary.holdings.find((h) => h.code === plan.fundCode); const chartData = buildChartData(plan, navRows, transactions); const stats = executionStats(plan, transactions); const invested = stats.invested || (Number(plan.executionCount) || 0) * (Number(plan.amount) || 0); const roi = invested ? ((holding?.value || 0) / 100 - invested) / invested : 0; return <div className="card p-5" key={plan.id}>{due && <span className="pill mb-3 bg-[#1d4ed8] text-white">今日待执行</span>}{done && <span className="pill mb-3 bg-green-700 text-white">今日已执行</span>}<div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg font-semibold text-white">{plan.fundName} <span className="text-sm text-[#888888]">{plan.fundCode}</span></h3><p className="mt-2 text-sm text-[#888888]">{describeFrequency(plan)} · 每次金额 ¥{Number(plan.amount).toLocaleString('zh-CN')} · 下次执行：{formatDateLabel(getNextDueDate(plan, todayStr))}</p><span className={plan.status === 'active' ? 'pill mt-3 bg-green-900 text-green-200' : 'pill mt-3 bg-[#333333] text-[#bbbbbb]'}>{plan.status === 'active' ? '启用' : '暂停'}</span></div><div className="flex flex-wrap gap-2"><button className="btn" onClick={() => { setError(''); setExecuting(plan); }}>执行</button><button className="btn2" onClick={() => setEditing(plan)}>编辑</button><button className="btn2" onClick={() => toggle(plan)}>{plan.status === 'active' ? '暂停' : '启用'}</button><button className="btn2 text-red-400" onClick={() => remove(plan)}>删除</button></div></div><button className="mt-4 text-sm text-[#3b82f6]" onClick={() => setExpanded((v) => ({ ...v, [plan.id]: !v[plan.id] }))}>{expanded[plan.id] ? '收起分析' : '展开分析'}</button>{expanded[plan.id] && <div className="mt-4 grid gap-4 md:grid-cols-2"><div className="grid gap-3 text-sm text-[#bbbbbb]"><p>累计执行次数：{stats.count || plan.executionCount || 0}</p><p>累计投入金额：¥{invested.toLocaleString('zh-CN')}</p><p>当前持仓市值：{formatMoney(holding?.value || 0)}</p><p>定投收益率：{(roi * 100).toFixed(2)}%</p><p>平均买入成本：¥{stats.avgCost.toFixed(4)}</p></div><div className="h-56"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><XAxis dataKey="date" stroke="#888" tick={{ fontSize: 11 }} /><YAxis stroke="#888" tick={{ fontSize: 11 }} /><Tooltip contentStyle={{ background: '#1e1e1e', border: '1px solid #333' }} formatter={(v, name) => [Number(v).toFixed(2), name === 'dca' ? '定投策略' : '一次性买入']} labelFormatter={(label) => `日期：${label}`} /><Line type="monotone" dataKey="dca" stroke="#3b82f6" dot={false} /><Line type="monotone" dataKey="lump" stroke="#f97316" strokeDasharray="4 4" dot={false} /></LineChart></ResponsiveContainer></div></div>}</div>; })}</div>}{editing && <PlanModal plan={editing} funds={funds} onClose={() => setEditing(null)} onSave={savePlan} />}{executing && <ExecuteModal plan={executing} fund={funds.find((f) => f.code === executing.fundCode)} navRows={navRows} config={config} factorResult={factorResult} hint={rsiHint(executing, navRows)} error={executeError} saving={executeSaving} onClose={() => { setExecuting(null); setError(''); }} onConfirm={confirmExecute} />}</div>;
}

function PlanModal({ plan, funds, onClose, onSave }) {
  const [form, setForm] = useState({ ...plan });
  const set = (k, v) => setForm((old) => ({ ...old, [k]: v }));
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"><form className="card grid w-full max-w-lg gap-3 p-5" onSubmit={(e) => { e.preventDefault(); onSave({ id: form.id || makeId(), createdAt: form.createdAt || Date.now(), lastExecutedDate: form.lastExecutedDate || null, executionCount: form.executionCount || 0, ...form }); }}><h3 className="text-xl font-semibold text-white">{form.id ? '编辑计划' : '新建计划'}</h3><select className="input" value={form.fundCode} onChange={e => set('fundCode', e.target.value)}>{funds.map(f => <option key={f.code} value={f.code}>{f.code} {f.name}</option>)}</select><input className="input" type="number" min="0" step="0.01" placeholder="每次金额" value={form.amount} onChange={e => set('amount', e.target.value)} required /><select className="input" value={form.frequency} onChange={e => set('frequency', e.target.value)}><option value="daily">每个工作日</option><option value="weekly">每周</option><option value="biweekly">每两周</option><option value="monthly">每月</option></select>{['weekly', 'biweekly'].includes(form.frequency) && <select className="input" value={form.dayOfWeek} onChange={e => set('dayOfWeek', e.target.value)}>{WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}</select>}{form.frequency === 'monthly' && <input className="input" type="number" min="1" max="31" value={form.dayOfMonth} onChange={e => set('dayOfMonth', e.target.value)} />}<input className="input" type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} /><input className="input" placeholder="备注" value={form.note || ''} onChange={e => set('note', e.target.value)} /><div className="flex justify-end gap-2"><button type="button" className="btn2" onClick={onClose}>取消</button><button className="btn">保存</button></div></form></div>;
}

function ExecuteModal({ plan, fund, navRows, config, factorResult, hint, error, saving, onClose, onConfirm }) {
  const latest = navRows.filter((r) => r.fundCode === plan.fundCode).sort((a, b) => b.date.localeCompare(a.date))[0];
  const feeRate = Number(fund?.purchaseFeeRate ?? 0.0015);
  const initialTotal = Number(plan.amount) || 0;
  const initialFee = initialTotal * feeRate;
  const initialPrice = latest?.nav || '';
  const calcShares = (totalAmount, fee, price) => {
    const netAmount = Number(totalAmount) - Number(fee);
    const nav = Number(price);
    return nav > 0 && netAmount > 0 ? (netAmount / nav).toFixed(4) : '';
  };
  const factorSnapshot = fund ? factorResult?.snapshotsByCategory?.[fund.category] : null;
  const dcaSuggestion = suggestDcaMultiplier(factorSnapshot?.actionPriority ?? null);
  const suggestedAmount = initialTotal * dcaSuggestion.multiplier;
  const suggestionClass = factorSnapshot?.actionPriority == null ? 'bg-[#151515] text-[#d4d4d4]' : dcaSuggestion.multiplier >= 1.5 ? 'bg-green-500/15 text-green-100 border-green-500/30' : dcaSuggestion.multiplier <= 0.75 ? 'bg-yellow-500/15 text-yellow-100 border-yellow-500/30' : 'bg-[#151515] text-[#d4d4d4] border-[#333333]';
  const [form, setForm] = useState({ totalAmount: plan.amount, fee: initialFee.toFixed(2), price: initialPrice, shares: calcShares(initialTotal, initialFee, initialPrice) });
  const set = (k, v) => setForm((old) => {
    const next = { ...old, [k]: v };
    if (['totalAmount', 'fee', 'price'].includes(k)) next.shares = calcShares(next.totalAmount, next.fee, next.price);
    return next;
  });
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"><form className="card grid w-full max-w-lg gap-3 p-5" onSubmit={(e) => { e.preventDefault(); onConfirm(form); }}><h3 className="text-xl font-semibold text-white">执行定投</h3><p className="text-[#bbbbbb]">{plan.fundName} · 计划金额 ¥{Number(plan.amount).toLocaleString('zh-CN')}</p><p className={hint.cls}>{hint.text}</p><div className="rounded-lg bg-[#151515] p-3 text-sm text-[#d4d4d4]"><p>价格状态：{factorSnapshot?.priceCondition.score == null ? '数据不足' : factorSnapshot.priceCondition.score} · 数据置信度：{factorSnapshot?.dataConfidence.score ?? '数据不足'}</p><p className="mt-1 text-[#888888]">行动说明：{factorSnapshot?.signalFundCode ? factorSnapshot.explanation : '数据不足：尚未配置该类别信号基金'}</p><p className="mt-1 text-[#888888]">风险标记：{factorSnapshot?.flags?.length ? factorSnapshot.flags.join('、') : '暂无'}</p><p className="mt-1 text-[#888888]">默认金额保持计划金额；不自动改金额。</p></div><div className={`rounded-lg border p-3 text-sm ${suggestionClass}`}>{factorSnapshot?.actionPriority == null ? <p>因子数据不足，按计划执行</p> : <div className="grid gap-1"><p>评分：{factorSnapshot.actionPriority}分</p><p>建议：{dcaSuggestion.label}（{Math.round(dcaSuggestion.multiplier * 100)}% × 计划金额 = ¥{suggestedAmount.toFixed(2)}）</p><p>原因：{dcaSuggestion.reason}</p></div>}<div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" className="btn2" onClick={() => set('totalAmount', suggestedAmount.toFixed(2))}>按建议金额</button><span className="text-xs text-[#888888]">因子建议为参考，最终金额由你决定</span></div></div>{error && <p className="danger">{error}</p>}<input className="input" type="number" step="0.01" placeholder="计划金额" value={form.totalAmount} onChange={e => set('totalAmount', e.target.value)} /><label className="grid gap-1"><input className="input" type="number" step="0.01" min="0" placeholder="手续费" value={form.fee} onChange={e => set('fee', e.target.value)} /><span className="text-xs text-[#888888]">费率 {(feeRate * 100).toFixed(2)}%</span></label><input className="input" type="number" step="0.0001" placeholder="确认净值" value={form.price} onChange={e => set('price', e.target.value)} /><input className="input" type="number" step="0.0001" placeholder="确认份额" value={form.shares} onChange={e => set('shares', e.target.value)} /><div className="flex justify-end gap-2"><button type="button" className="btn2" onClick={onClose}>取消</button><button className="btn" disabled={saving}>{saving ? '执行中...' : '确认执行'}</button></div></form></div>;
}
