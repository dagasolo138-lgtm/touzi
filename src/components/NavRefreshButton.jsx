import { useEffect, useState } from 'react';
import { getFunds, saveNav } from '../db/index.js';
import { fetchNav } from '../services/fundApi.js';
import { generateSnapshot } from '../services/snapshot.js';
import { useStore } from '../store/useStore.js';
import { today } from '../utils/formatters.js';

export default function NavRefreshButton() {
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [failures, setFailures] = useState([]);
  const [showFailures, setShowFailures] = useState(false);
  const loadAll = useStore((s) => s.loadAll);

  useEffect(() => {
    if (!failures.length) return undefined;
    const timer = setTimeout(() => {
      setFailures([]);
      setShowFailures(false);
    }, 10000);
    return () => clearTimeout(timer);
  }, [failures]);

  async function refreshOne(fund) {
    try {
      const nav = await fetchNav(fund.code);
      if (!nav?.nav) throw new Error('接口返回空数据');
      await saveNav({ fundCode: nav.code || fund.code, date: nav.navDate || today(), nav: nav.nav, accNav: null, source: 'api' });
      return { ok: true };
    } catch (error) {
      return { ok: false, fundCode: fund.code, fundName: fund.name, error: error.message || '刷新失败' };
    }
  }

  async function run() {
    setLoading(true);
    setFailures([]);
    setShowFailures(false);
    try {
      const funds = await getFunds();
      const results = await Promise.all(funds.map(refreshOne));
      const failed = results.filter((result) => !result.ok);
      const ok = results.length - failed.length;
      await generateSnapshot();
      await loadAll();
      setMsg(failed.length ? `刷新完成：成功 ${ok} 只，失败 ${failed.length} 只` : `刷新完成：成功 ${ok} 只，失败 0 只`);
      setFailures(failed);
      setShowFailures(failed.length > 0);
    } catch (error) {
      setMsg(error.message || '批量刷新失败');
    } finally {
      setLoading(false);
    }
  }

  return <div className="relative">
    <button onClick={run} disabled={loading} className="btn w-full">{loading ? '刷新中...' : '刷新净值'}</button>
    {msg && <div className="mt-2 rounded border border-vscode-border bg-[#181818] p-2 text-xs text-gray-300">
      <div className="flex items-center justify-between gap-2">
        <span>{msg}</span>
        {failures.length > 0 && <div className="flex items-center gap-2">
          <button className="text-blue-300 hover:text-blue-200" onClick={() => setShowFailures((value) => !value)}>{showFailures ? '收起' : '展开'}</button>
          <button className="text-gray-500 hover:text-gray-300" onClick={() => { setFailures([]); setShowFailures(false); setMsg(''); }}>×</button>
        </div>}
      </div>
      {showFailures && failures.length > 0 && <ul className="mt-2 space-y-1 border-t border-vscode-border pt-2 text-left text-red-200">
        {failures.map((failure) => <li key={failure.fundCode}>{failure.fundCode} {failure.fundName || '未命名基金'}：{failure.error}</li>)}
      </ul>}
    </div>}
  </div>;
}
