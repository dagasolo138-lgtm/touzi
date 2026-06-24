import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import NavRefreshButton from './NavRefreshButton.jsx';
const nav = [['📊','总览','/'],['💼','持仓明细','/holdings'],['📝','交易记录','/transactions'],['⚖️','再平衡','/rebalance'],['📈','收益追踪','/performance'],['🤖','AI分析','/ai'],['📋','日志','/logs'],['⚙️','设置','/settings']];
export default function Layout(){ return <div className="min-h-screen bg-vscode-bg text-[#d4d4d4]"><aside className="fixed left-0 top-0 h-full w-60 border-r border-vscode-border bg-[#181818] p-4"><h1 className="mb-6 text-xl font-bold text-white">投资仪表盘</h1><nav className="space-y-2">{nav.map(([i,t,to])=><NavLink key={to} to={to} end={to==='/'} className={({isActive})=>clsx('block rounded-lg px-3 py-2',isActive?'bg-vscode-blue text-white':'hover:bg-vscode-card')}>{i} {t}</NavLink>)}</nav><div className="absolute bottom-4 left-4 right-4"><NavRefreshButton /></div></aside><main className="ml-60 p-6"><Outlet /></main></div> }
