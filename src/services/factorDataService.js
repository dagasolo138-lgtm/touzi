import { saveNav } from '../db/index.js';
import { fetchNavHistory } from './fundApi.js';

function validHistoryRow(row) {
  const date = String(row?.date || row?.navDate || '').slice(0, 10);
  const nav = Number(row?.nav ?? row?.unitNetWorth ?? row?.netValue);
  return date && Number.isFinite(nav) && nav > 0;
}

export async function syncFactorSignalHistory({ config, funds = [], onProgress } = {}) {
  const configuredCodes = Object.values(config?.factorSettings?.categorySignalFunds || {}).filter(Boolean);
  const fundCodes = new Set((funds || []).map((fund) => fund.code));
  const codes = [...new Set(configuredCodes)].filter((code) => !fundCodes.size || fundCodes.has(code));
  const result = { syncedCodes: [], failed: [], fetchedCountByCode: {}, savedCountByCode: {} };

  for (const code of codes) {
    try {
      onProgress?.({ code, status: 'fetching' });
      const rows = await fetchNavHistory(code, 420);
      const validRows = rows.filter(validHistoryRow);
      result.fetchedCountByCode[code] = validRows.length;
      let saved = 0;
      for (const row of validRows) {
        await saveNav({
          fundCode: code,
          date: String(row.date || row.navDate).slice(0, 10),
          nav: Number(row.nav ?? row.unitNetWorth ?? row.netValue),
          accNav: row.accNav ?? null,
          source: 'factor-history-sync',
        });
        saved += 1;
      }
      result.savedCountByCode[code] = saved;
      result.syncedCodes.push(code);
      onProgress?.({ code, status: 'done', fetched: validRows.length, saved });
    } catch (error) {
      result.failed.push({ code, message: error.message || '同步失败' });
      result.fetchedCountByCode[code] = result.fetchedCountByCode[code] || 0;
      result.savedCountByCode[code] = result.savedCountByCode[code] || 0;
      onProgress?.({ code, status: 'failed', message: error.message || '同步失败' });
    }
  }
  return result;
}
