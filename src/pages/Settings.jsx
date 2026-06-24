import { useEffect, useState } from 'react';
import { clearAllData, exportData, getConfig, getFunds, importData, saveConfig, saveFund } from '../db/index.js';
import { today } from '../utils/formatters.js';

export default function Settings() {
  const [cfg, setCfg] = useState(null);
  const [funds, setFunds] = useState([]);
  const [msg, setMsg] = useState('');

  useEffect(() => { getConfig().then(setCfg); getFunds(true).then(setFunds); }, []);
  if (!cfg) return null;

  const total = Object.values(cfg.targetAllocation).reduce((s, v) => s + Number(v), 0);

  async function save() {
    await saveConfig(cfg);
    localStorage.setItem('deepseekApiKey', cfg.deepseekApiKey || '');
    localStorage.setItem('exaApiKey', cfg.exaApiKey || '');
    setMsg('已保存');
  }

  async function exp() {
    const data = await exportData();
    const safeConfig = { ...(await getConfig()) };
    delete safeConfig.deepseekApiKey;
    delete safeConfig.exaApiKey;

    const exportObj = {
      ...data,
      config: safeConfig,
      exportedAt: new Date().toISOString(),
      version: '1.0',
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `investment-backup-${today()}.json`;
    a.click();
  }

  async function imp(e) {
    const file = e.target.files[0];
    if (!file || !confirm('导入将合并数据，重复记录按ID覆盖')) return;
    const data = JSON.parse(await file.text());
    await importData(data);
    if (data.config) await saveConfig(data.config);
    location.reload();
  }

  async function clear() {
    if (confirm('确认清空所有数据？')) {
      await clearAllData();
      location.reload();
    }
  }

  return <div className="space-y-6"><h2 className="text-2xl font-bold text-white">设置</h2><section className="card grid gap-3 p-4"><h3 className="font-semibold">API配置</h3><input className="input" type="password" placeholder="DeepSeek API Key" defaultValue={localStorage.getItem('deepseekApiKey') || ''} onChange={e => setCfg({ ...cfg, deepseekApiKey: e.target.value })} /><input className="input" type="password" placeholder="Exa API Key" defaultValue={localStorage.getItem('exaApiKey') || ''} onChange={e => setCfg({ ...cfg, exaApiKey: e.target.value })} /><input className="input" placeholder="Proxy URL" value={cfg.proxyUrl} onChange={e => setCfg({ ...cfg, proxyUrl: e.target.value })} /></section><section className="card grid gap-3 p-4"><h3 className="font-semibold">目标配置（合计 {(total * 100).toFixed(0)}%）</h3>{cfg.categories.map(c => <label key={c}>{c}<input className="input ml-3" type="number" value={Math.round(cfg.targetAllocation[c] * 100)} onChange={e => setCfg({ ...cfg, targetAllocation: { ...cfg.targetAllocation, [c]: Number(e.target.value) / 100 } })} />%</label>)}{Math.abs(total - 1) > .001 && <p className="danger">目标配置必须加总 = 100%</p>}</section><section className="card p-4"><h3 className="font-semibold">基金管理</h3>{funds.map(f => <div key={f.code} className="flex flex-wrap items-center gap-2 border-t border-vscode-border py-2"><span className="w-52">{f.code} {f.name}</span><select className="input" value={f.category} onChange={async e => { await saveFund({ ...f, category: e.target.value }); setFunds(await getFunds(true)); }}>{cfg.categories.map(c => <option key={c}>{c}</option>)}</select><label className="flex items-center gap-2 text-sm text-[#bbbbbb]">申购费率：<input className="input w-24" type="number" step="0.01" min="0" max="5" value={(Number(f.purchaseFeeRate ?? 0.0015) * 100).toFixed(2)} onChange={async e => { await saveFund({ ...f, purchaseFeeRate: Number(e.target.value) / 100 }); setFunds(await getFunds(true)); }} />%</label><button className="btn2" onClick={async () => { await saveFund({ ...f, archived: !f.archived }); setFunds(await getFunds(true)); }}>{f.archived ? '恢复' : '归档'}</button></div>)}</section><section className="card flex flex-wrap gap-3 p-4"><div><button className="btn" onClick={exp}>导出全部数据</button><p className="mt-1 text-xs text-[#888888]">导出数据不含API密钥</p></div><label className="btn2">导入数据<input type="file" className="hidden" accept=".json" onChange={imp} /></label><button className="btn2 text-red-400" onClick={clear}>清空所有数据</button><select className="input" value={cfg.defaultThinkingMode} onChange={e => setCfg({ ...cfg, defaultThinkingMode: e.target.value })}><option value="disabled">无思考</option><option value="high">标准思考</option><option value="max">深度思考</option></select></section><button disabled={Math.abs(total - 1) > .001} className="btn" onClick={save}>保存设置</button>{msg && <span className="ml-3 good">{msg}</span>}</div>;
}
