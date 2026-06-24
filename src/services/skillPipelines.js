import { STEP_PROMPTS } from './analystPrompt.js';
import { chatCompletion, streamChatCompletion } from './deepseek.js';

export function buildPortfolioText(holdings = [], config = {}) {
  const yuan = (cents = 0) => Number(cents || 0) / 100;
  const totalValue = holdings.reduce((sum, h) => sum + Number(h.value || 0), 0);
  const categories = config?.categories?.length ? config.categories : [...new Set(holdings.map((h) => h.category).filter(Boolean))];
  const allocation = categories.map((category) => {
    const rows = holdings.filter((h) => h.category === category);
    const value = rows.reduce((sum, h) => sum + Number(h.value || 0), 0);
    const actual = totalValue ? value / totalValue : 0;
    const target = Number(config?.targetAllocation?.[category] || 0);
    return { category, value: yuan(value), actual, target, deviation: actual - target, funds: rows.map((h) => ({ code: h.code, name: h.name, value: yuan(h.value), nav: h.nav, pnlPct: h.pnlPct })) };
  });
  return JSON.stringify({ totalValue: yuan(totalValue), targetAllocation: config?.targetAllocation || {}, allocation, holdings: holdings.map((h) => ({ code: h.code, name: h.name, category: h.category, value: yuan(h.value), nav: h.nav, pnlPct: h.pnlPct })) }, null, 2);
}

function navValue(row) { return Number(row?.nav ?? row?.unitNetWorth ?? row?.value ?? row?.netValue ?? 0); }
export function calcMA(navHistory = [], period) {
  const vals = navHistory.map(navValue).filter((v) => Number.isFinite(v) && v > 0).slice(-period);
  if (!vals.length) return 0;
  return Number((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(4));
}

export function calcRSI(navHistory = [], period = 14) {
  const vals = navHistory.map(navValue).filter((v) => Number.isFinite(v) && v > 0);
  if (vals.length <= period) return 50;
  const recent = vals.slice(-(period + 1));
  let gain = 0; let loss = 0;
  for (let i = 1; i < recent.length; i += 1) {
    const diff = recent[i] - recent[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  return Number((100 - (100 / (1 + avgGain / avgLoss))).toFixed(2));
}

export function extractJson(content = '') {
  const text = String(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const start = text.indexOf(open);
    if (start < 0) continue;
    let depth = 0; let inString = false; let escape = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === open) depth += 1;
      if (ch === close) depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text;
}

export async function runStep(prompt, userContent, thinkingMode, apiKey) {
  const { content, usage } = await chatCompletion({ messages: [{ role: 'user', content: userContent }], systemPrompt: prompt, thinkingMode, apiKey });
  return { content: extractJson(content), usage };
}

function addUsage(total, usage) {
  total.prompt_tokens += usage?.prompt_tokens || 0;
  total.completion_tokens += usage?.completion_tokens || 0;
  total.reasoning_tokens += usage?.reasoning_tokens || usage?.completion_tokens_details?.reasoning_tokens || 0;
}
function parse(content) { return JSON.parse(extractJson(content)); }
function topFundsForGaps(gaps, holdings) {
  return [...(gaps || [])].sort((a, b) => Math.abs(b.deviation || 0) - Math.abs(a.deviation || 0)).slice(0, 2).map((g) => holdings.filter((h) => h.category === g.category).sort((a, b) => (b.value || 0) - (a.value || 0))[0]).filter(Boolean);
}
async function technicalForFund(fund, navFetcher, thinkingMode, apiKey, usageTotal) {
  const history = await navFetcher(fund.code, 90);
  const values = history.map(navValue).filter(Boolean);
  const payload = { fundCode: fund.code, fundName: fund.name, latestNav: values.at(-1) || fund.nav || 0, ma5: calcMA(history, 5), ma20: calcMA(history, 20), ma60: calcMA(history, 60), rsi14: calcRSI(history, 14), supportLevel: values.length ? Math.min(...values.slice(-30)) : 0, resistanceLevel: values.length ? Math.max(...values.slice(-30)) : 0, navHistory: history.slice(-90) };
  const res = await runStep(STEP_PROMPTS.technical_analysis, JSON.stringify(payload), thinkingMode, apiKey); addUsage(usageTotal, res.usage); return parse(res.content);
}
async function macro(context, exaSearcher, thinkingMode, apiKey, usageTotal) {
  const res = await runStep(STEP_PROMPTS.macro_assessment, JSON.stringify(context), thinkingMode, apiKey); addUsage(usageTotal, res.usage);
  const data = parse(res.content);
  if (data.needsSearch && exaSearcher) data.searchResults = await Promise.all((data.searchQueries || []).slice(0, 3).map((q) => exaSearcher(q, 'news')));
  return data;
}
function hitlSummary(allocation, technical = [], macroData = {}) {
  const gaps = (allocation?.gaps || []).slice(0, 2).map((g) => `${g.category}${g.deviation < 0 ? '欠配' : '超配'}${Math.abs((g.deviation || 0) * 100).toFixed(0)}%${g.category === allocation.priorityCategory ? '（最优先）' : ''}`).join('，');
  const tech = technical.map((t) => `${t.fundName || t.fundCode}${t.trend || ''}，RSI=${t.rsi14}，入场${t.entryAdvice}`).join('；') || '暂无技术分析';
  return `配置：${gaps || allocation?.recommendation || '暂无配置偏离'}\n技术：${tech}\n宏观：${macroData.macroSummary || '暂无重大宏观影响'}\n→ 建议继续？`;
}
async function* finalStream(payload, thinkingMode, apiKey, usageTotal) {
  const queue = [];
  let resolveNext;
  let done = false;
  let error = null;
  const wake = () => {
    resolveNext?.();
    resolveNext = null;
  };
  const waitForNext = () => new Promise((resolve) => { resolveNext = resolve; });
  const completion = streamChatCompletion({
    messages: [{ role: 'user', content: JSON.stringify(payload, null, 2) }],
    systemPrompt: STEP_PROMPTS.final_synthesis,
    thinkingMode,
    apiKey,
    onChunk: (chunk) => {
      if (chunk.type === 'text') {
        queue.push({ type: 'final', content: chunk.content });
        wake();
      }
    },
  }).then(({ usage }) => {
    addUsage(usageTotal, usage);
    queue.push({ type: 'final', content: '', usage: { ...usageTotal }, done: true });
  }).catch((err) => { error = err; }).finally(() => { done = true; wake(); });

  while (!done || queue.length) {
    if (!queue.length) await waitForNext();
    while (queue.length) yield queue.shift();
  }
  await completion;
  if (error) throw error;
}

export async function* runNewCapital(amount, holdings, config, navFetcher, exaSearcher, thinkingMode, apiKey) {
  const usage = { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0 };
  try {
    yield { type: 'step_start', stepName: 'allocation_analysis', stepLabel: '配置分析' };
    const aRes = await runStep(STEP_PROMPTS.allocation_analysis, buildPortfolioText(holdings, config), thinkingMode, apiKey); addUsage(usage, aRes.usage); const allocation = parse(aRes.content); yield { type: 'step_done', stepName: 'allocation_analysis', data: allocation, usage: { ...usage } };
    yield { type: 'step_start', stepName: 'technical_analysis', stepLabel: '技术分析' };
    const technical = await Promise.all(topFundsForGaps(allocation.gaps, holdings).map((f) => technicalForFund(f, navFetcher, thinkingMode, apiKey, usage))); yield { type: 'step_done', stepName: 'technical_analysis', data: technical, usage: { ...usage } };
    yield { type: 'step_start', stepName: 'macro_assessment', stepLabel: '宏观研判' };
    const macroData = await macro({ amount, allocation, technical }, exaSearcher, thinkingMode, apiKey, usage); yield { type: 'step_done', stepName: 'macro_assessment', data: macroData, usage: { ...usage } };
    yield { type: 'hitl', summary: hitlSummary(allocation, technical, macroData) };
    yield { type: 'step_start', stepName: 'final_synthesis', stepLabel: '生成建议' };
    yield* finalStream({ skill: 'new_capital', amount, allocation, technical, macro: macroData }, thinkingMode, apiKey, usage);
  } catch (e) { yield { type: 'error', message: e.message }; }
}

export async function* runFundDive(fundCode, fundName, holdings, config, navFetcher, exaSearcher, thinkingMode, apiKey) {
  const usage = { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0 };
  try {
    const fund = holdings.find((h) => h.code === fundCode || h.name?.includes(fundName)) || { code: fundCode, name: fundName };
    yield { type: 'step_start', stepName: 'technical_analysis', stepLabel: '技术分析' };
    const technical = await technicalForFund(fund, navFetcher, thinkingMode, apiKey, usage); yield { type: 'step_done', stepName: 'technical_analysis', data: technical, usage: { ...usage } };
    yield { type: 'step_start', stepName: 'macro_assessment', stepLabel: '宏观研判' };
    const macroData = await macro({ fund, technical }, exaSearcher, thinkingMode, apiKey, usage); yield { type: 'step_done', stepName: 'macro_assessment', data: macroData, usage: { ...usage } };
    yield { type: 'step_start', stepName: 'allocation_analysis', stepLabel: '持仓上下文' };
    const aRes = await runStep(STEP_PROMPTS.allocation_analysis, buildPortfolioText(holdings, config), thinkingMode, apiKey); addUsage(usage, aRes.usage); const allocation = parse(aRes.content); yield { type: 'step_done', stepName: 'allocation_analysis', data: allocation, usage: { ...usage } };
    yield { type: 'hitl', summary: hitlSummary(allocation, [technical], macroData) };
    yield { type: 'step_start', stepName: 'final_synthesis', stepLabel: '生成建议' };
    yield* finalStream({ skill: 'fund_dive', fund, allocation, technical, macro: macroData }, thinkingMode, apiKey, usage);
  } catch (e) { yield { type: 'error', message: e.message }; }
}

export async function* runHealthCheck(holdings, config, thinkingMode, apiKey) {
  const usage = { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0 };
  try {
    yield { type: 'step_start', stepName: 'allocation_analysis', stepLabel: '配置分析' };
    const aRes = await runStep(STEP_PROMPTS.allocation_analysis, buildPortfolioText(holdings, config), thinkingMode, apiKey); addUsage(usage, aRes.usage); const allocation = parse(aRes.content); yield { type: 'step_done', stepName: 'allocation_analysis', data: allocation, usage: { ...usage } };
    yield { type: 'step_start', stepName: 'final_synthesis', stepLabel: '生成报告' };
    yield* finalStream({ skill: 'health_check', allocation }, thinkingMode, apiKey, usage);
  } catch (e) { yield { type: 'error', message: e.message }; }
}
