export const today = () => new Date().toISOString().slice(0, 10);
export const yuanToCents = (value) => Math.round((Number(value) || 0) * 100);
export const centsToYuan = (value) => (Number(value) || 0) / 100;
export const formatMoney = (cents) => `¥${centsToYuan(cents).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const formatPct = (value) => `${((Number(value) || 0) * 100).toFixed(2)}%`;
export const formatNav = (value) => (Number(value) || 0).toFixed(4);
export const makeId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`);
