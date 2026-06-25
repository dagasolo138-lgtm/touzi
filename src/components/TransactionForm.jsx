import { useEffect, useState } from 'react';
import { makeId, today, yuanToCents } from '../utils/formatters.js';
import { saveTransaction } from '../db/index.js';

const defaultForm = {
  date: today(),
  fundCode: '',
  type: 'buy',
  totalAmount: '',
  shares: '',
  price: '',
  amount: '',
  fee: '0',
  notes: '',
};

const toAmount = (value) => Number(value) || 0;
const feeRateOf = (funds, fundCode) => Number(funds.find((f) => f.code === fundCode)?.purchaseFeeRate ?? 0.0015);
const calcFee = (totalAmount, feeRate) => (toAmount(totalAmount) * feeRate).toFixed(2);
const calcShares = (totalAmount, fee, price) => {
  const netAmount = toAmount(totalAmount) - toAmount(fee);
  const nav = toAmount(price);
  return nav > 0 && netAmount > 0 ? (netAmount / nav).toFixed(4) : '';
};

export default function TransactionForm({ funds = [], editing, onSaved, onBeforeSave }) {
  const [form, setForm] = useState(defaultForm);
  const [error, setError] = useState('');

  useEffect(() => {
    if (editing) {
      const amount = (editing.amountCents ?? yuanToCents(editing.amount)) / 100;
      const fee = (editing.feeCents ?? yuanToCents(editing.fee)) / 100;
      setForm({ ...defaultForm, ...editing, amount, fee, totalAmount: editing.type === 'buy' ? (amount + fee).toFixed(2) : '' });
      return;
    }

    if (funds[0]) {
      setForm((f) => ({ ...f, fundCode: f.fundCode || funds[0].code }));
    }
  }, [editing, funds]);

  const set = (key, value) => setForm((current) => {
    const next = { ...current, [key]: value };
    const nextFundCode = key === 'fundCode' ? value : current.fundCode;
    const nextType = key === 'type' ? value : current.type;

    if (nextType === 'buy') {
      if (key === 'fundCode' || key === 'totalAmount' || key === 'type') {
        next.fee = calcFee(next.totalAmount, feeRateOf(funds, nextFundCode));
      }
      if (['fundCode', 'totalAmount', 'fee', 'price', 'type'].includes(key)) {
        next.shares = calcShares(next.totalAmount, next.fee, next.price);
      }
    } else if (key === 'shares' || key === 'price') {
      next.amount = ((key === 'shares' ? value : current.shares) * (key === 'price' ? value : current.price) || 0).toFixed(2);
    }

    return next;
  });

  async function submit(e) {
    e.preventDefault();
    try {
      if (!form.fundCode) throw new Error('请选择基金');
      const isBuy = form.type === 'buy';
      const totalAmount = toAmount(form.totalAmount);
      const fee = toAmount(form.fee);
      const amount = isBuy ? totalAmount - fee : toAmount(form.amount);

      if (isBuy) {
        if (totalAmount <= 0) throw new Error('买入金额必须大于0');
        if (fee < 0) throw new Error('手续费不能小于0');
        if (amount <= 0) throw new Error('扣除手续费后的确认金额必须大于0');
        if (toAmount(form.price) <= 0) throw new Error('确认净值必须大于0');
        if (toAmount(form.shares) <= 0) throw new Error('确认份额必须大于0');
      }

      const selectedFund = funds.find((fund) => fund.code === form.fundCode);
      const transaction = {
        id: editing?.id || makeId(),
        createdAt: editing?.createdAt || Date.now(),
        date: form.date,
        fundCode: form.fundCode,
        fundName: selectedFund?.name || editing?.fundName || '',
        category: selectedFund?.category || editing?.category || '',
        type: form.type,
        shares: Number(form.shares),
        price: Number(form.price),
        amount,
        amountCents: yuanToCents(amount),
        fee,
        feeCents: yuanToCents(fee),
        notes: form.notes,
      };
      await onBeforeSave?.(transaction, editing);
      await saveTransaction(transaction);
      setError('');
      setForm({ ...defaultForm, fundCode: form.fundCode, type: form.type });
      onSaved?.();
    } catch (err) {
      setError(err.message);
    }
  }

  const feeRate = feeRateOf(funds, form.fundCode);
  const isBuy = form.type === 'buy';

  return <form onSubmit={submit} className="card grid gap-3 p-4 md:grid-cols-4"><input className="input" type="date" value={form.date} onChange={e => set('date', e.target.value)} /><select className="input" value={form.fundCode} onChange={e => set('fundCode', e.target.value)}>{funds.map(f => <option key={f.code} value={f.code}>{f.code} {f.name}</option>)}</select><select className="input" value={form.type} onChange={e => set('type', e.target.value)}><option value="buy">买入</option><option value="sell">卖出</option><option value="reinvest">红利再投</option></select>{isBuy ? <><input className="input" type="number" step="0.01" placeholder="买入金额" value={form.totalAmount} onChange={e => set('totalAmount', e.target.value)} /><label className="grid gap-1"><input className="input" type="number" step="0.01" min="0" placeholder="手续费" value={form.fee} onChange={e => set('fee', e.target.value)} /><span className="text-xs text-[#888888]">费率 {(feeRate * 100).toFixed(2)}%</span></label><input className="input" type="number" step="0.0001" placeholder="确认净值" value={form.price} onChange={e => set('price', e.target.value)} /><input className="input" type="number" step="0.0001" placeholder="确认份额" value={form.shares} onChange={e => set('shares', e.target.value)} /></> : <><input className="input" placeholder="份额" value={form.shares} onChange={e => set('shares', e.target.value)} /><input className="input" placeholder="成交净值" value={form.price} onChange={e => set('price', e.target.value)} /><input className="input" placeholder="金额" value={form.amount} onChange={e => set('amount', e.target.value)} /><input className="input" placeholder="手续费" value={form.fee} onChange={e => set('fee', e.target.value)} /></>}<input className="input" placeholder="备注" value={form.notes} onChange={e => set('notes', e.target.value)} />{error && <div className="danger md:col-span-4">{error}</div>}<button className="btn md:col-span-4">保存交易</button></form>;
}
