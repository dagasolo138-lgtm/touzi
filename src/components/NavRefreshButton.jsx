import { useState } from 'react';
import { getFunds, saveNav } from '../db/index.js';
import { fetchNav } from '../services/fundApi.js';
import { generateSnapshot } from '../services/snapshot.js';
import { useStore } from '../store/useStore.js';
import { today } from '../utils/formatters.js';
export default function NavRefreshButton(){ const [msg,setMsg]=useState(''); const [loading,setLoading]=useState(false); const loadAll=useStore(s=>s.loadAll); async function run(){ setLoading(true); try{ const funds=await getFunds(); const results=await Promise.allSettled(funds.map(f=>fetchNav(f.code))); let ok=0; for (const r of results) if(r.status==='fulfilled'){ ok++; await saveNav({fundCode:r.value.code,date:r.value.navDate||today(),nav:r.value.nav,accNav:null,source:'api'}); } await generateSnapshot(); await loadAll(); setMsg(`成功${ok}只，失败${results.length-ok}只`); }catch(e){ setMsg(e.message); } finally{ setLoading(false); } } return <div><button onClick={run} disabled={loading} className="btn w-full">{loading?'刷新中...':'刷新净值'}</button>{msg&&<p className="mt-2 text-xs text-gray-400">{msg}</p>}</div> }
