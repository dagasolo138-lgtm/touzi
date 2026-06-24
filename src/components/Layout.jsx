import { NavLink, Outlet } from 'react-router-dom';
import clsx from 'clsx';
import NavRefreshButton from './NavRefreshButton.jsx';

const nav = [['首页', '/', '🏠'], ['持仓', '/holdings', '📊'], ['AI', '/ai', '🤖'], ['设置', '/settings', '⚙️']];

export default function Layout() {
  return <div className="min-h-screen bg-[#0a0a0a] text-[#f5f5f5]"><aside className="fixed left-0 top-0 z-20 hidden h-full w-[220px] border-r border-[#1a1a1a] bg-[#0f0f0f] p-4 md:block"><h1 className="mb-8 flex items-center gap-2 text-lg font-semibold tracking-tight text-[#f5f5f5]"><span className="h-2 w-2 rounded-full bg-[#3b82f6] shadow-[0_0_18px_rgba(59,130,246,.85)]" />投资仪表盘</h1><nav className="space-y-1">{nav.map(([t, to]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => clsx('relative block rounded-lg px-4 py-2.5 text-sm transition-colors', isActive ? 'bg-[#1a1a1a] text-white before:absolute before:left-0 before:top-2 before:h-6 before:w-1 before:rounded-full before:bg-[#3b82f6]' : 'text-[#888888] hover:bg-[#151515] hover:text-[#f5f5f5]')}>{t}</NavLink>)}</nav><div className="absolute bottom-4 left-4 right-4"><NavRefreshButton /></div></aside><main className="px-4 pb-24 pt-5 md:ml-[220px] md:p-6"><Outlet /></main><nav aria-label="底部导航" className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-[#1a1a1a] bg-[#0f0f0f] px-2 py-2 md:hidden">{nav.map(([t, to, icon]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => clsx('relative flex flex-1 flex-col items-center gap-1 py-1.5 text-[11px]', isActive ? 'text-[#3b82f6] after:absolute after:bottom-0 after:h-0.5 after:w-6 after:rounded-full after:bg-[#3b82f6]' : 'text-[#888888]')}><span className="text-base leading-none">{icon}</span><span>{t}</span></NavLink>)}</nav></div>;
}
