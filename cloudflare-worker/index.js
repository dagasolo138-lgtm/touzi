const CORS_HEADERS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, x-exa-key", "Content-Type": "application/json;charset=UTF-8" };

export default { async fetch(request) { if (request.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS }); const url = new URL(request.url); try { if (url.pathname === "/nav") return await handleSingleNav(url.searchParams.get("code")); if (url.pathname === "/nav/batch") return await handleBatchNav(url.searchParams.get("codes")?.split(",") || []); if (url.pathname === "/nav/history") return await handleNavHistory(url.searchParams.get("code"), parseHistoryDays(url.searchParams.get("days"))); if (url.pathname === "/exa") return await handleExaSearch(request, url.searchParams.get("query"), url.searchParams.get("category") || "general"); return json({ error: "Unknown route" }, 404); } catch (e) { return json({ error: e.message }, 500); } } };
async function handleSingleNav(code) { if (!code) return json({ error: "code required" }, 400); return json(await fetchLatestNav(code)); }
async function handleBatchNav(codes) { if (!codes.length) return json({ error: "codes required" }, 400); const results = await Promise.allSettled(codes.map((code) => fetchLatestNav(code))); const data = {}; codes.forEach((code, i) => { const r = results[i]; data[code] = r.status === "fulfilled" ? r.value : { error: r.reason.message }; }); return json(data); }
function parseHistoryDays(value) { const days = parseInt(value || "30", 10); return Number.isFinite(days) ? Math.min(Math.max(days, 1), 1200) : 30; }
async function handleNavHistory(code, days) { if (!code) return json({ error: "code required" }, 400); const today = new Date(); const start = new Date(today.getTime() - days * 86400000); const apiUrl = `https://fund.eastmoney.com/f10/F10DataApi.aspx?type=lsjz&code=${code}&page=1&sdate=${formatDate(start)}&edate=${formatDate(today)}&per=${Math.min(days, 1000)}&token=&pToken=`; const text = await fetchText(apiUrl, { Referer: "http://fund.eastmoney.com/" }); const rows = parseHistoryRows(text); if (!rows.length) return json({ error: "parse error", raw: text.slice(0, 200) }, 500); return json({ code, history: rows }); }

async function handleExaSearch(request, query, category) { if (request.method !== "GET") return json({ error: "Method not allowed" }, 405); if (!query) return json({ error: "query required" }, 400); const apiKey = request.headers.get("x-exa-key"); if (!apiKey) return json({ error: "x-exa-key required" }, 400); const res = await fetch("https://api.exa.ai/search", { method: "POST", headers: { "x-api-key": apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ query, type: category === "news" ? "news" : "auto", numResults: 5, contents: { text: { maxCharacters: 800 } } }) }); const data = await res.text(); return new Response(data, { status: res.status, headers: CORS_HEADERS }); }

async function fetchLatestNav(code) {
  try {
    return await fetchRealTimeNav(code);
  } catch (error) {
    return fetchOfficialLatestNav(code, error);
  }
}

async function fetchRealTimeNav(code) { const text = await fetchText(`https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`, { Referer: "https://fund.eastmoney.com/" }); const match = text.match(/jsonpgz\((\{.*\})\)/s); if (!match) throw new Error(`实时估值接口暂无 ${code}`); const data = JSON.parse(match[1]); const nav = Number.parseFloat(data.dwjz); if (!Number.isFinite(nav) || nav <= 0) throw new Error(`实时估值接口暂无 ${code}`); return { code: data.fundcode || code, name: data.name || code, nav, estimatedNav: Number.parseFloat(data.gsz) || null, navDate: data.jzrq, estimatedTime: data.gztime, source: "fundgz" }; }

async function fetchOfficialLatestNav(code, realtimeError) {
  const [name, history] = await Promise.all([fetchFundName(code).catch(() => code), fetchOfficialHistory(code, 30)]);
  const latest = history[0];
  if (!latest) throw new Error(`${realtimeError?.message || "实时估值不可用"}，且官方净值接口暂无 ${code}`);
  return { code, name, nav: latest.nav, accNav: latest.accNav, navDate: latest.date, estimatedNav: null, estimatedTime: null, source: "eastmoney-f10" };
}

async function fetchOfficialHistory(code, days) {
  const today = new Date();
  const start = new Date(today.getTime() - days * 86400000);
  const apiUrl = `https://fund.eastmoney.com/f10/F10DataApi.aspx?type=lsjz&code=${code}&page=1&sdate=${formatDate(start)}&edate=${formatDate(today)}&per=${Math.min(days, 1000)}&token=&pToken=`;
  return parseHistoryRows(await fetchText(apiUrl, { Referer: "http://fund.eastmoney.com/" }));
}

async function fetchFundName(code) {
  const text = await fetchText(`https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`, { Referer: "https://fund.eastmoney.com/" });
  const match = text.match(/var\s+fS_name\s*=\s*"([^"]+)"/);
  return match?.[1] || code;
}

export function parseHistoryRows(text) { const match = text.match(/content:"(.*?)",records/s); if (!match) return []; const rows = []; const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gs; let rowMatch; let isFirst = true; while ((rowMatch = rowRegex.exec(match[1])) !== null) { if (isFirst) { isFirst = false; continue; } const tds = []; const tdReg = /<td[^>]*>(.*?)<\/td>/gs; let tdMatch; while ((tdMatch = tdReg.exec(rowMatch[1])) !== null) tds.push(tdMatch[1].replace(/<[^>]+>/g, "").trim()); const nav = Number.parseFloat(tds[1]); if (tds.length >= 2 && Number.isFinite(nav) && nav > 0) rows.push({ date: tds[0], nav, accNav: Number.parseFloat(tds[2]) || null }); } return rows; }
async function fetchText(url, headers = {}) { const res = await fetch(url, { headers }); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS }); }
function formatDate(d) { return d.toISOString().split("T")[0]; }
