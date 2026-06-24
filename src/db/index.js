import { openDB } from 'idb';
import { today, makeId } from '../utils/formatters.js';

const DB_NAME = 'investment-db';
const DB_VERSION = 2;
export const DEFAULT_CONFIG = { id: 'singleton', targetAllocation: { A股: 0.2, QDII: 0.3, 债券: 0.3, 黄金: 0.15 }, categories: ['A股', 'QDII', '债券', '黄金'], proxyUrl: '', defaultThinkingMode: 'disabled', updatedAt: Date.now() };

export const dbPromise = openDB(DB_NAME, DB_VERSION, { upgrade(db) { if (!db.objectStoreNames.contains('funds')) db.createObjectStore('funds', { keyPath: 'code' }); if (!db.objectStoreNames.contains('transactions')) { const s = db.createObjectStore('transactions', { keyPath: 'id' }); s.createIndex('fundCode', 'fundCode'); s.createIndex('date', 'date'); } if (!db.objectStoreNames.contains('navHistory')) { const s = db.createObjectStore('navHistory', { keyPath: 'id' }); s.createIndex('fundCode', 'fundCode'); s.createIndex('date', 'date'); } if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'date' }); if (!db.objectStoreNames.contains('aiLogs')) db.createObjectStore('aiLogs', { keyPath: 'id' }); if (!db.objectStoreNames.contains('conversations')) { const s = db.createObjectStore('conversations', { keyPath: 'id' }); s.createIndex('updatedAt', 'updatedAt'); } if (!db.objectStoreNames.contains('config')) db.createObjectStore('config', { keyPath: 'id' }); } });
const all = async (store) => (await dbPromise).getAll(store);
const put = async (store, value) => (await dbPromise).put(store, value);
const del = async (store, key) => (await dbPromise).delete(store, key);
export async function getFunds(includeArchived = false) { const rows = await all('funds'); return includeArchived ? rows : rows.filter((f) => !f.archived); }
export async function getFund(code) { return (await dbPromise).get('funds', code); }
export async function saveFund(fund) { return put('funds', { archived: false, ...fund, createdAt: fund.createdAt || Date.now() }); }
export async function getTransactions() { return (await all('transactions')).sort((a, b) => b.date.localeCompare(a.date)); }
export async function saveTransaction(tx) { return put('transactions', { id: tx.id || makeId(), fee: 0, notes: '', createdAt: Date.now(), ...tx }); }
export async function deleteTransaction(id) { return del('transactions', id); }
export async function saveNav(record) { return put('navHistory', { id: `${record.fundCode}_${record.date}`, fetchedAt: Date.now(), ...record }); }
export async function getNavHistory() { return all('navHistory'); }
export async function getLatestNavMap() { const rows = await all('navHistory'); return rows.reduce((m, r) => (!m[r.fundCode] || r.date > m[r.fundCode].date ? { ...m, [r.fundCode]: r } : m), {}); }
export async function saveSnapshot(snapshot) { return put('snapshots', { date: today(), createdAt: Date.now(), ...snapshot }); }
export async function getSnapshots() { return (await all('snapshots')).sort((a, b) => a.date.localeCompare(b.date)); }
export async function saveAiLog(log) { return put('aiLogs', { id: makeId(), createdAt: Date.now(), timestamp: Date.now(), ...log }); }
export async function getAiLogs() { return (await all('aiLogs')).sort((a, b) => b.timestamp - a.timestamp); }
export async function clearAiLogs() { const db = await dbPromise; const tx = db.transaction('aiLogs', 'readwrite'); await tx.store.clear(); await tx.done; }
export async function getConversations() { return (await all('conversations')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); }
export async function getConversation(id) { return (await dbPromise).get('conversations', id); }
export async function saveConversation(conv) { return put('conversations', { ...conv, createdAt: conv.createdAt || Date.now(), updatedAt: Date.now() }); }
export async function deleteConversation(id) { return del('conversations', id); }
export async function clearAllConversations() { const db = await dbPromise; const tx = db.transaction('conversations', 'readwrite'); await tx.store.clear(); await tx.done; }
export async function getConfig() { return (await (await dbPromise).get('config', 'singleton')) || DEFAULT_CONFIG; }
export async function saveConfig(config) { return put('config', { ...(await getConfig()), ...config, id: 'singleton', updatedAt: Date.now() }); }
export async function exportData() { return { funds: await all('funds'), transactions: await all('transactions'), navHistory: await all('navHistory'), snapshots: await all('snapshots'), aiLogs: await all('aiLogs'), conversations: await all('conversations') }; }
export async function importData(data) { const db = await dbPromise; const tx = db.transaction(['funds', 'transactions', 'navHistory', 'snapshots', 'aiLogs', 'conversations'], 'readwrite'); for (const store of tx.objectStoreNames) for (const item of data[store] || []) await tx.objectStore(store).put(item); await tx.done; }
export async function clearAllData() { const db = await dbPromise; const tx = db.transaction(['funds', 'transactions', 'navHistory', 'snapshots', 'aiLogs', 'conversations'], 'readwrite'); for (const s of tx.objectStoreNames) await tx.objectStore(s).clear(); await tx.done; }
