export function getApiKey(provider) {
  return localStorage.getItem(`${provider}ApiKey`) || '';
}

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'exa_search',
      description: '搜索互联网获取实时信息。适用于：基金公告、行业动态、宏观政策、市场情绪、指数行情、大宗商品价格。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索词，中文为主' },
          category: {
            type: 'string',
            enum: ['general', 'news'],
            description: 'general=通用，news=新闻（时效性更强）',
            default: 'general',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_fund_nav_history',
      description: '获取指定基金的历史净值数据，用于趋势分析、均线计算。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '6位基金代码' },
          days: { type: 'number', description: '历史天数，默认420，最多1200', default: 60 },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_portfolio_context',
      description: '获取用户当前完整持仓数据、各类别配置情况、与目标配置的偏离度。',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export async function executeTool(toolName, toolArgs, { proxyUrl, holdings, config }) {
  switch (toolName) {
    case 'exa_search':
      return await exaSearch(toolArgs.query, toolArgs.category, proxyUrl);
    case 'fetch_fund_nav_history':
      return await fetchFundNavHistory(toolArgs.code, toolArgs.days || 60, proxyUrl);
    case 'get_portfolio_context':
      return buildPortfolioContext(holdings, config);
    default:
      throw new Error(`未知工具：${toolName}`);
  }
}

export async function exaSearch(query, category = 'general', proxyUrl) {
  const apiKey = localStorage.getItem('exaApiKey');
  if (!apiKey) throw new Error('请先在设置页填写 Exa API Key');
  if (!proxyUrl) throw new Error('请先在设置页填写 Proxy URL');
  const params = new URLSearchParams({ query, category });
  const res = await fetch(`${proxyUrl.replace(/\/$/, '')}/exa?${params.toString()}`, {
    headers: { 'x-exa-key': apiKey },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || 'Exa搜索失败');
  return (data.results || []).map((r) => ({ title: r.title, url: r.url, text: r.text, publishedDate: r.publishedDate }));
}

async function fetchFundNavHistory(code, days, proxyUrl) {
  if (!proxyUrl) throw new Error('请先在设置页填写 Proxy URL');
  const safeDays = Math.min(Math.max(Number(days) || 420, 1), 1200);
  const res = await fetch(`${proxyUrl.replace(/\/$/, '')}/nav/history?code=${code}&days=${safeDays}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || '净值历史查询失败');
  return data.history || [];
}

export function buildPortfolioContext(holdings = [], config) {
  const totalValue = holdings.reduce((s, h) => s + (h.value || 0), 0);
  const byCategory = (config?.categories || []).map((cat) => {
    const rows = holdings.filter((h) => h.category === cat);
    const value = rows.reduce((s, h) => s + (h.value || 0), 0);
    const actual = totalValue ? ((value / totalValue) * 100).toFixed(1) : '0.0';
    const target = ((config?.targetAllocation?.[cat] || 0) * 100).toFixed(0);
    const diff = (parseFloat(actual) - parseFloat(target)).toFixed(1);
    return `${cat}：实际${actual}% / 目标${target}% / 偏离${diff > 0 ? '+' : ''}${diff}%`;
  });
  const holdingLines = holdings.map((h) => `  - ${h.name}(${h.code})：市值¥${((h.value || 0) / 100).toFixed(2)}，盈亏${((h.pnlPct || 0) * 100).toFixed(2)}%，净值${h.nav ?? '暂无'}`);
  return ['【当前组合快照】', `总市值：¥${(totalValue / 100).toFixed(2)}`, '', '配置情况：', ...byCategory, '', '各持仓：', ...(holdingLines.length ? holdingLines : ['  - 暂无持仓']), '', '【量化辅助数据】', 'factorSettings=' + JSON.stringify(config?.factorSettings || {}), '说明：因子评分仅供辅助，100分始终表示对新增资金更有吸引力；不能代替事实核验和投资建议，也不能触发自动交易。', '', `数据时间：${new Date().toLocaleString('zh-CN')}`].join('\n');
}
