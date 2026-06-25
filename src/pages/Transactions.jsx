import { useEffect, useState } from 'react';
import TransactionForm from '../components/TransactionForm.jsx';
import { deleteTransaction } from '../db/index.js';
import { validateTransactionSave } from '../utils/transactionValidation.js';
import { useStore } from '../store/useStore.js';
import { formatMoney } from '../utils/formatters.js';

export default function Transactions() {
  const { funds, transactions, summary, loadAll } = useStore();
  const [filter, setFilter] = useState({ fund: '', type: '' });
  const [editing, setEditing] = useState(null);

  useEffect(() => { loadAll(); }, [loadAll]);

  const rows = transactions.filter((t) => (!filter.fund || t.fundCode === filter.fund) && (!filter.type || t.type === filter.type));

  async function remove(id) {
    if (confirm('确认删除这条交易？')) {
      await deleteTransaction(id);
      await loadAll();
    }
  }

  async function validateTransaction(tx, currentEditing) {
    const result = await validateTransactionSave(tx, currentEditing?.id || null);
    if (!result.valid) throw new Error(result.error);
  }

  return <div className="space-y-6"><h2 className="text-2xl font-bold text-white">交易记录</h2><TransactionForm funds={funds} editing={editing} onBeforeSave={validateTransaction} onSaved={() => { setEditing(null); loadAll(); }} /><div className="flex gap-3"><select className="input" onChange={e => setFilter({ ...filter, fund: e.target.value })}><option value="">全部基金</option>{funds.map(f => <option key={f.code} value={f.code}>{f.name}</option>)}</select><select className="input" onChange={e => setFilter({ ...filter, type: e.target.value })}><option value="">全部类型</option><option value="buy">买入</option><option value="sell">卖出</option><option value="reinvest">红利再投</option></select></div><div className="card overflow-auto"><table className="w-full text-sm"><tbody>{rows.map(t => <tr className="border-b border-vscode-border" key={t.id}><td className="p-3">{t.date}</td><td>{t.fundCode}</td><td>{t.type}</td><td>{t.shares}</td><td>{t.price}</td><td>{formatMoney(t.amountCents || 0)}</td><td><button className="text-vscode-blue" onClick={() => setEditing(t)}>编辑</button> <button className="text-red-400" onClick={() => remove(t.id)}>删除</button></td></tr>)}</tbody></table></div></div>;
}
