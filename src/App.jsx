import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Holdings from './pages/Holdings.jsx';
import Transactions from './pages/Transactions.jsx';
import Rebalance from './pages/Rebalance.jsx';
import Performance from './pages/Performance.jsx';
import AIAnalyst from './pages/AIAnalyst.jsx';
import Logs from './pages/Logs.jsx';
import Settings from './pages/Settings.jsx';
export default function App(){ return <BrowserRouter basename="/investment-dashboard"><Routes><Route element={<Layout/>}><Route index element={<Dashboard/>}/><Route path="holdings" element={<Holdings/>}/><Route path="transactions" element={<Transactions/>}/><Route path="rebalance" element={<Rebalance/>}/><Route path="performance" element={<Performance/>}/><Route path="ai" element={<AIAnalyst/>}/><Route path="logs" element={<Logs/>}/><Route path="settings" element={<Settings/>}/></Route></Routes></BrowserRouter> }
