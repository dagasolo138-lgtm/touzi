import { chatCompletion, streamChatCompletion, streamWithTools, estimateCost } from './deepseek.js';
import { TOOL_DEFINITIONS, executeTool } from './exaSearch.js';
import { buildAgentSystemPrompt, COLLABORATION_AGENT_META, mergeMode2Prompts } from './collaborationPrompts.js';
import { summarizeResearchPacket } from './researchContext.js';
import { extractJson } from './skillPipelines.js';

function now() { return Date.now(); }
function addUsage(total, usage = {}) { total.prompt_tokens += usage.prompt_tokens || 0; total.completion_tokens += usage.completion_tokens || 0; total.reasoning_tokens += usage.reasoning_tokens || usage.completion_tokens_details?.reasoning_tokens || 0; }
function parseJson(content, fallback) { try { return JSON.parse(extractJson(content)); } catch { return fallback; } }
function fallbackReport(agentId, error) {
  if (agentId === 'factResearcher') return { agent: agentId, summary: '外部搜索不可用，事实研究降级。', externalFacts: [], conflictingEvidence: [], unavailableData: ['EXTERNAL_SEARCH_UNAVAILABLE', error].filter(Boolean), sources: [] };
  if (agentId === 'riskReviewer') return { agent: agentId, verdict: 'insufficient_for_action', summary: '风险审查未能完整完成，最终结论限制为研究方向。', blockingRisks: [error].filter(Boolean), requiredCaveats: ['风险审查未完整完成。'], conflicts: [], invalidInferences: [], permittedConclusionScope: 'research_priority_only' };
  return { agent: agentId, summary: `Agent 执行失败：${error}`, confirmedFacts: [], quantitativeFindings: [], risks: [error].filter(Boolean), uncertainties: ['该 Agent 输出不可用。'], researchPriorities: [], dataGaps: [] };
}
export function createSearchLimiter(limit = 6) {
  let count = 0;
  const seen = new Set();
  return async function limitedSearch(query, category, proxyUrl) {
    const key = `${String(query).trim().toLowerCase()}|${category || 'general'}`;
    if (seen.has(key)) throw new Error('DUPLICATE_SEARCH_BLOCKED');
    if (count >= limit) throw new Error('FACT_SEARCH_LIMIT_EXCEEDED');
    seen.add(key); count += 1;
    return executeTool('exa_search', { query, category }, { proxyUrl });
  };
}
async function runJsonAgent({ agentId, prompt, messages, thinkingMode, onEvent }) {
  const startedAt = now();
  onEvent?.({ type: 'agent_start', agentId, label: COLLABORATION_AGENT_META[agentId].label, startedAt });
  const res = await chatCompletion({ messages, systemPrompt: prompt, thinkingMode });
  const report = parseJson(res.content, fallbackReport(agentId, 'JSON_PARSE_FAILED'));
  const durationMs = now() - startedAt;
  onEvent?.({ type: 'agent_done', agentId, label: COLLABORATION_AGENT_META[agentId].label, startedAt, durationMs, report, usage: res.usage || {} });
  return { report, usage: res.usage || {}, durationMs, startedAt, completedAt: now(), status: 'done', toolEvents: [], sources: report.sources || [] };
}
async function runFactAgent({ prompt, question, researchPacket, thinkingMode, proxyUrl, factSearchLimit, onEvent }) {
  const agentId = 'factResearcher';
  const startedAt = now();
  const toolEvents = [];
  onEvent?.({ type: 'agent_start', agentId, label: COLLABORATION_AGENT_META[agentId].label, startedAt });
  try {
    const limiter = createSearchLimiter(factSearchLimit);
    let text = '';
    const usage = await streamWithTools({
      messages: [{ role: 'user', content: JSON.stringify({ question, researchPacket: summarizeResearchPacket(researchPacket) }, null, 2) }],
      systemPrompt: prompt,
      thinkingMode,
      tools: TOOL_DEFINITIONS.filter((t) => ['exa_search', 'fetch_fund_nav_history'].includes(t.function.name)),
      executeTool: async (name, args) => {
        if (name === 'exa_search') return limiter(args.query, args.category, proxyUrl);
        return executeTool(name, args, { proxyUrl });
      },
      onChunk: (chunk) => {
        if (chunk.type === 'text') text += chunk.content;
        if (chunk.type === 'tool_start') toolEvents.push({ callId: chunk.callId, name: chunk.name, status: 'running', startedAt: now() });
        if (chunk.type === 'tool_result') { const evt = toolEvents.find((e) => e.callId === chunk.callId); if (evt) Object.assign(evt, { status: chunk.error ? 'error' : 'done', result: chunk.result, error: chunk.error, completedAt: now() }); }
        onEvent?.({ type: 'agent_progress', agentId, label: COLLABORATION_AGENT_META[agentId].label, toolEvents });
      },
    });
    const report = parseJson(text, fallbackReport(agentId, 'JSON_PARSE_FAILED'));
    const durationMs = now() - startedAt;
    onEvent?.({ type: 'agent_done', agentId, label: COLLABORATION_AGENT_META[agentId].label, startedAt, durationMs, report, usage, toolEvents });
    return { report, usage, durationMs, startedAt, completedAt: now(), status: 'done', toolEvents, sources: report.sources || [] };
  } catch (err) {
    const report = fallbackReport(agentId, err.message || 'EXTERNAL_SEARCH_UNAVAILABLE');
    const durationMs = now() - startedAt;
    onEvent?.({ type: 'agent_error', agentId, label: COLLABORATION_AGENT_META[agentId].label, startedAt, durationMs, report, toolEvents, error: err.message });
    return { report, usage: {}, durationMs, startedAt, completedAt: now(), status: 'error', toolEvents, sources: [], error: err.message };
  }
}

export async function runCollaboration({ question, thinkingMode = 'disabled', researchPacket, prompts = {}, proxyUrl = '', onEvent } = {}) {
  const mergedPrompts = mergeMode2Prompts(prompts?.prompts || prompts);
  const factSearchLimit = Number(prompts?.factSearchLimit || 6);
  const totalUsage = { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0 };
  const agentRuns = {};
  onEvent?.({ type: 'agent_done', agentId: 'prepare', label: '数据准备', startedAt: now(), durationMs: 0, report: { asOfDate: researchPacket.asOfDate, generatedAt: researchPacket.generatedAt } });
  const qaPrompt = buildAgentSystemPrompt('quantitativeAnalyst', mergedPrompts.quantitativeAnalyst);
  const factPrompt = buildAgentSystemPrompt('factResearcher', mergedPrompts.factResearcher);
  const qaPromise = runJsonAgent({ agentId: 'quantitativeAnalyst', prompt: qaPrompt, messages: [{ role: 'user', content: JSON.stringify({ question, researchPacket }, null, 2) }], thinkingMode, onEvent }).catch((e) => ({ ...fallbackReport('quantitativeAnalyst', e.message), report: fallbackReport('quantitativeAnalyst', e.message), usage: {}, status: 'error', error: e.message }));
  const factPromise = runFactAgent({ prompt: factPrompt, question, researchPacket, thinkingMode, proxyUrl, factSearchLimit, onEvent });
  const [qa, fact] = await Promise.all([qaPromise, factPromise]);
  agentRuns.quantitativeAnalyst = qa; agentRuns.factResearcher = fact; addUsage(totalUsage, qa.usage); addUsage(totalUsage, fact.usage);
  const riskPrompt = buildAgentSystemPrompt('riskReviewer', mergedPrompts.riskReviewer);
  let risk;
  try { risk = await runJsonAgent({ agentId: 'riskReviewer', prompt: riskPrompt, messages: [{ role: 'user', content: JSON.stringify({ question, researchPacket, quantitativeAnalyst: qa.report, factResearcher: fact.report }, null, 2) }], thinkingMode, onEvent }); } catch (e) { risk = { report: fallbackReport('riskReviewer', e.message), usage: {}, status: 'error', error: e.message }; }
  agentRuns.riskReviewer = risk; addUsage(totalUsage, risk.usage);
  const chiefPrompt = buildAgentSystemPrompt('chiefAnalyst', mergedPrompts.chiefAnalyst, { riskVerdict: risk.report?.verdict });
  const startedAt = now();
  let finalContent = '';
  onEvent?.({ type: 'agent_start', agentId: 'chiefAnalyst', label: COLLABORATION_AGENT_META.chiefAnalyst.label, startedAt });
  try {
    const { usage } = await streamChatCompletion({ messages: [{ role: 'user', content: JSON.stringify({ question, researchPacket: summarizeResearchPacket(researchPacket), quantitativeAnalyst: qa.report, factResearcher: fact.report, riskReviewer: risk.report }, null, 2) }], systemPrompt: chiefPrompt, thinkingMode, onChunk: (chunk) => { if (chunk.type === 'text') { finalContent += chunk.content; onEvent?.({ type: 'final_chunk', agentId: 'chiefAnalyst', label: COLLABORATION_AGENT_META.chiefAnalyst.label, content: chunk.content }); } } });
    addUsage(totalUsage, usage);
    const durationMs = now() - startedAt;
    agentRuns.chiefAnalyst = { report: { content: finalContent }, usage, durationMs, startedAt, completedAt: now(), status: 'done', toolEvents: [], sources: [] };
    onEvent?.({ type: 'agent_done', agentId: 'chiefAnalyst', label: COLLABORATION_AGENT_META.chiefAnalyst.label, startedAt, durationMs, report: { content: finalContent }, usage });
    onEvent?.({ type: 'final_done', agentId: 'chiefAnalyst', label: COLLABORATION_AGENT_META.chiefAnalyst.label, content: finalContent, usage: totalUsage });
    return { finalContent, agentRuns, totalUsage, estimatedCostUSD: estimateCost(totalUsage), riskVerdict: risk.report?.verdict, status: fact.status === 'error' || qa.status === 'error' || risk.status === 'error' ? 'partial' : 'completed' };
  } catch (e) {
    onEvent?.({ type: 'agent_error', agentId: 'chiefAnalyst', label: COLLABORATION_AGENT_META.chiefAnalyst.label, startedAt, durationMs: now() - startedAt, error: e.message });
    return { finalContent, agentRuns, totalUsage, estimatedCostUSD: estimateCost(totalUsage), riskVerdict: risk.report?.verdict, status: 'failed', error: e.message };
  }
}
