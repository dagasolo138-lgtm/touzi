import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clearAllConversations, deleteConversation, getConfig, getConversation, getConversations, getDcaPlans, getFunds, getNavHistory, getSnapshots, getTransactions, saveAiLog, saveAnalysisRun, saveConversation, updateAnalysisRun } from '../db/index.js';
import { estimateCost, streamWithTools } from '../services/deepseek.js';
import { ANALYST_SYSTEM_PROMPT, TRIAGE_PROMPT } from '../services/analystPrompt.js';
import { runStep, runNewCapital, runFundDive, runHealthCheck } from '../services/skillPipelines.js';
import { TOOL_DEFINITIONS, buildFactorContext, buildPortfolioContext, executeTool as runTool, exaSearch } from '../services/exaSearch.js';
import { buildCategoryFactorSnapshots, formatFactorContextForLLM } from '../services/factorContext.js';
import { runCollaboration } from '../services/collaborationEngine.js';
import { buildResearchPacket } from '../services/researchContext.js';
import { COLLABORATION_AGENT_META } from '../services/collaborationPrompts.js';
import { fetchNavHistory } from '../services/fundApi.js';
import { useStore } from '../store/useStore.js';
import { makeId } from '../utils/formatters.js';

const MODE_OPTIONS = [
  ['disabled', '无思考'],
  ['high', '标准'],
  ['max', '深度'],
];

const THINKING_LABELS = Object.fromEntries(MODE_OPTIONS);

function relativeTime(timestamp) {
  const time = Number(timestamp || Date.now());
  const diff = Date.now() - time;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  if (hours < 48) return '昨天';
  return new Date(time).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

const MARKDOWN_COMPONENTS = {
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-xl font-bold text-white">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-3 text-lg font-bold text-white">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-3 text-base font-semibold text-white">{children}</h3>,
  p: ({ children }) => <p className="my-2">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="my-1">{children}</li>,
  table: ({ node, ...props }) => <table className="w-full border-collapse my-3 text-sm" {...props} />,
  thead: ({ node, ...props }) => <thead className="border-b border-gray-600" {...props} />,
  tbody: ({ node, ...props }) => <tbody {...props} />,
  tr: ({ node, ...props }) => <tr className="border-b border-gray-700" {...props} />,
  th: ({ node, ...props }) => <th className="text-left py-2 px-3 text-gray-300 font-semibold" {...props} />,
  td: ({ node, ...props }) => <td className="py-2 px-3 text-gray-400" {...props} />,
  code: ({ children }) => <code className="rounded bg-[#111] px-1 py-0.5 text-xs text-blue-200">{children}</code>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded bg-[#111] p-3 text-xs text-gray-200">{children}</pre>,
};

function getToolLabel(name) {
  return { exa_search: '搜索网络', fetch_fund_nav_history: '拉取净值历史', get_portfolio_context: '读取持仓' }[name] || name;
}

function titleFrom(text) {
  return (text || '新对话').trim().slice(0, 20) || '新对话';
}

function toDisplayMessage(message) {
  return { id: makeId(), role: message.role, content: message.content || '', reasoning: message.reasoningContent || '', reasoningDone: true, toolEvents: [], status: message.status || 'done', timestamp: message.timestamp || Date.now() };
}

export default function AIAnalyst() {
  const { summary, config, loadAll } = useStore();
  const [conversations, setConversations] = useState([]);
  const [currentConvId, setCurrentConvId] = useState(makeId());
  const [displayMessages, setDisplayMessages] = useState([]);
  const [apiMessages, setApiMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [thinkingMode, setThinkingMode] = useState('disabled');
  const [lastUsage, setLastUsage] = useState(null);
  const [error, setError] = useState('');
  const [pipelineSteps, setPipelineSteps] = useState([]);
  const [hitl, setHitl] = useState(null);
  const [aiMode, setAiMode] = useState(() => localStorage.getItem('investment-ai-mode') || 'single');
  const [collabSteps, setCollabSteps] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const cancelRef = useRef({ cancelled: false, runId: null });
  const iteratorRef = useRef(null);
  const runtimeRef = useRef(null);
  const scrollerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { loadAll(); refreshConversations(); }, [loadAll]);
  useEffect(() => { if (config?.defaultThinkingMode) setThinkingMode(config.defaultThinkingMode); }, [config?.defaultThinkingMode]);
  useEffect(() => { scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' }); }, [displayMessages]);
  useEffect(() => { if (!input && inputRef.current) inputRef.current.style.height = 'auto'; }, [input]);
  useEffect(() => { localStorage.setItem('investment-ai-mode', aiMode); }, [aiMode]);

  const holdings = summary?.holdings || [];
  const latestContext = useMemo(() => buildPortfolioContext(holdings, config), [holdings, config]);

  async function refreshConversations() {
    setConversations(await getConversations());
  }

  function startNewConversation() {
    if (isStreaming) return;
    setCurrentConvId(makeId());
    setDisplayMessages([]);
    setApiMessages([]);
    setLastUsage(null);
    setPipelineSteps([]);
    setHitl(null);
    setError('');
    setCollabSteps([]);
    setDrawerOpen(false);
    setMoreOpen(false);
  }

  async function loadConversation(id) {
    if (isStreaming) return;
    if (input.trim() && !confirm('当前有未发送内容，确认切换对话？')) return;
    const conv = await getConversation(id);
    if (!conv) return;
    setCurrentConvId(conv.id);
    setDisplayMessages(conv.displayMessages || (conv.messages || []).filter((m) => m.role !== 'system' && m.role !== 'tool').map(toDisplayMessage));
    setApiMessages(conv.apiMessages || conv.messages || []);
    setLastUsage(conv.lastUsage || null);
    setError('');
    setCollabSteps([]);
    setDrawerOpen(false);
  }

  async function removeConversation(id, event) {
    event.stopPropagation();
    if (!confirm('确认删除这条对话？')) return;
    await deleteConversation(id);
    if (id === currentConvId) startNewConversation();
    await refreshConversations();
  }

  async function clearHistory() {
    if (!confirm('确认清空全部对话历史？')) return;
    await clearAllConversations();
    startNewConversation();
    await refreshConversations();
  }


  async function persistConversation({ convId, display, api, usage }) {
    const firstUser = display.find((m) => m.role === 'user')?.content || input;
    await saveConversation({ id: convId, title: titleFrom(firstUser), messages: api, apiMessages: api, displayMessages: display, lastUsage: usage, createdAt: conversations.find((c) => c.id === convId)?.createdAt || Date.now() });
    await refreshConversations();
  }

  function resizeInput(target) {
    target.style.height = 'auto';
    const maxHeight = Math.max(180, window.innerHeight * 0.25);
    target.style.height = `${Math.min(target.scrollHeight, maxHeight)}px`;
    target.style.overflowY = target.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  function handleInput(event) {
    setInput(event.target.value);
    resizeInput(event.target);
  }


  function jsonParseSafe(text, fallback = null) {
    try { return JSON.parse(text); } catch { return fallback; }
  }

  function stepLabelsFor(skill) {
    const map = {
      new_capital: [['allocation_analysis', '配置分析'], ['technical_analysis', '技术分析'], ['macro_assessment', '宏观研判'], ['final_synthesis', '生成建议']],
      fund_dive: [['technical_analysis', '技术分析'], ['macro_assessment', '宏观研判'], ['allocation_analysis', '持仓上下文'], ['final_synthesis', '生成建议']],
      health_check: [['allocation_analysis', '配置分析'], ['final_synthesis', '生成报告']],
    };
    return (map[skill] || []).map(([name, label]) => ({ name, label, status: 'waiting', start: 0, duration: 0 }));
  }

  function updateStep(name, patch) {
    setPipelineSteps((steps) => steps.map((step) => (step.name === name ? { ...step, ...patch } : step)));
  }

  async function consumePipeline() {
    const runtime = runtimeRef.current;
    const iterator = iteratorRef.current;
    let pausedForHitl = false;
    if (!runtime || !iterator) return;
    try {
      while (true) {
        const { value: event, done } = await iterator.next();
        if (done) break;
        if (event.type === 'step_start') updateStep(event.stepName, { status: 'running', start: Date.now(), label: event.stepLabel });
        if (event.type === 'step_done') setPipelineSteps((steps) => steps.map((step) => (step.name === event.stepName ? { ...step, status: 'done', duration: Date.now() - (step.start || Date.now()) } : step)));
        if (event.usage) { runtime.finalUsage = event.usage; setLastUsage(event.usage); }
        if (event.type === 'hitl') { pausedForHitl = true; setHitl({ summary: event.summary }); setIsStreaming(false); return; }
        if (event.type === 'final') {
          runtime.assistantText += event.content || '';
          runtime.finalUsage = event.usage || runtime.finalUsage;
          if (event.usage) {
            setLastUsage(runtime.finalUsage);
            setPipelineSteps((steps) => steps.map((step) => (step.name === 'final_synthesis' ? { ...step, status: 'done', duration: Date.now() - (step.start || Date.now()) } : step)));
          }
          runtime.applyDisplay((msgs) => msgs.map((msg) => (msg.id === runtime.assistantId ? { ...msg, content: msg.content + (event.content || ''), status: event.done ? 'done' : msg.status, usage: runtime.finalUsage } : msg)));
        }
        if (event.type === 'error') throw new Error(event.message);
      }
      const completedApi = [...runtime.nextApi, { role: 'assistant', content: runtime.assistantText }];
      setApiMessages(completedApi);
      await persistConversation({ convId: runtime.convId, display: runtime.finalDisplay, api: completedApi, usage: runtime.finalUsage });
      await saveAiLog({ question: runtime.q.slice(0, 50), thinkingMode, inputTokens: runtime.finalUsage?.prompt_tokens || 0, outputTokens: runtime.finalUsage?.completion_tokens || 0, reasoningTokens: runtime.finalUsage?.reasoning_tokens || 0, estimatedCostUSD: parseFloat(estimateCost(runtime.finalUsage || {}).toFixed(4)), exaCallCount: 0 });
    } catch (e) {
      setError(e.message);
      runtime.applyDisplay((msgs) => msgs.map((msg) => (msg.id === runtime.assistantId ? { ...msg, content: msg.content || `出错：${e.message}`, status: 'error', reasoningDone: true } : msg)));
    } finally {
      if (!pausedForHitl) setIsStreaming(false);
    }
  }

  async function continueHitl() {
    setHitl(null);
    setIsStreaming(true);
    await consumePipeline();
  }

  async function cancelHitl() {
    const runtime = runtimeRef.current;
    setHitl(null);
    iteratorRef.current = null;
    if (runtime) runtime.applyDisplay((msgs) => msgs.map((msg) => (msg.id === runtime.assistantId ? { ...msg, content: `${msg.content}\n\n已取消生成建议。`, status: 'done' } : msg)));
  }

  function initialCollabSteps() {
    return [
      { agentId: 'prepare', label: '数据准备', status: 'waiting', durationMs: 0 },
      { agentId: 'quantitativeAnalyst', label: '量化与组合分析', status: 'waiting', durationMs: 0 },
      { agentId: 'factResearcher', label: '市场与基金事实研究', status: 'waiting', durationMs: 0 },
      { agentId: 'riskReviewer', label: '风险审查', status: 'waiting', durationMs: 0 },
      { agentId: 'chiefAnalyst', label: '首席整合', status: 'waiting', durationMs: 0 },
    ];
  }

  async function sendCollaboration(q) {
    const convId = currentConvId || makeId();
    const userDisplay = { id: makeId(), role: 'user', content: q, reasoning: '', reasoningDone: true, toolEvents: [], status: 'done', timestamp: Date.now() };
    const assistantId = makeId();
    const runId = makeId();
    const assistantDisplay = { id: assistantId, role: 'assistant', content: '', reasoning: '', reasoningDone: true, toolEvents: [], status: 'streaming', timestamp: Date.now(), analysisRunId: runId, collaboration: { agentRuns: [], totalUsage: null, estimatedCostUSD: 0 } };
    const nextDisplay = [...displayMessages, userDisplay, assistantDisplay];
    setCurrentConvId(convId);
    setDisplayMessages(nextDisplay);
    setInput('');
    setIsStreaming(true);
    setLastUsage(null);
    setError('');
    setCollabSteps(initialCollabSteps());
    cancelRef.current = { cancelled: false, runId };

    let finalDisplay = nextDisplay;
    const applyDisplay = (producer) => {
      if (cancelRef.current.cancelled || cancelRef.current.runId !== runId) return;
      setDisplayMessages((msgs) => {
        const updated = producer(msgs);
        finalDisplay = updated;
        return updated;
      });
    };
    const updateCollabStep = (agentId, patch) => {
      if (cancelRef.current.cancelled || cancelRef.current.runId !== runId) return;
      setCollabSteps((steps) => steps.map((step) => (step.agentId === agentId ? { ...step, ...patch } : step)));
    };
    try {
      const [freshCfg, freshFunds, freshTx, freshNavRows, dcaPlans, snapshots] = await Promise.all([getConfig(), getFunds(), getTransactions(), getNavHistory(), getDcaPlans(), getSnapshots()]);
      const asOfDate = new Date().toISOString().slice(0, 10);
      const researchPacket = buildResearchPacket({ config: freshCfg, funds: freshFunds, transactions: freshTx, navRows: freshNavRows, dcaPlans, snapshots, asOfDate });
      const runRecord = { id: runId, conversationId: convId, mode: 'collaboration', question: q, asOfDate, createdAt: Date.now(), status: 'running', researchPacketMeta: { asOfDate, generatedAt: researchPacket.generatedAt, holdingCount: researchPacket.portfolio.holdings.length, staleFunds: researchPacket.dataQuality.staleFunds }, agentRuns: [], finalContent: '', totalUsage: null, estimatedCostUSD: 0, riskVerdict: null };
      await saveAnalysisRun(runRecord);
      updateCollabStep('prepare', { status: 'done', durationMs: 0 });
      const agentRuns = {};
      const prompts = freshCfg.agentSettings?.mode2 || {};
      const onEvent = async (event) => {
        if (cancelRef.current.cancelled || cancelRef.current.runId !== runId) return;
        if (event.type === 'agent_start') updateCollabStep(event.agentId, { status: 'running', startedAt: event.startedAt });
        if (event.type === 'agent_done' || event.type === 'agent_error') {
          updateCollabStep(event.agentId, { status: event.type === 'agent_error' ? 'error' : 'done', durationMs: event.durationMs || 0 });
          if (event.agentId !== 'prepare') {
            agentRuns[event.agentId] = { agentId: event.agentId, label: event.label, prompt: prompts.prompts?.[event.agentId] || '', startedAt: event.startedAt, completedAt: Date.now(), durationMs: event.durationMs, status: event.type === 'agent_error' ? 'error' : 'done', report: event.report, toolEvents: event.toolEvents || [], sources: event.report?.sources || [], usage: event.usage || {}, error: event.error };
            await updateAnalysisRun(runId, { agentRuns: Object.values(agentRuns), status: event.type === 'agent_error' ? 'partial' : 'running', riskVerdict: agentRuns.riskReviewer?.report?.verdict || null });
            applyDisplay((msgs) => msgs.map((msg) => (msg.id === assistantId ? { ...msg, collaboration: { ...(msg.collaboration || {}), agentRuns: Object.values(agentRuns), riskVerdict: agentRuns.riskReviewer?.report?.verdict } } : msg)));
          }
        }
        if (event.type === 'final_chunk') applyDisplay((msgs) => msgs.map((msg) => (msg.id === assistantId ? { ...msg, content: msg.content + event.content } : msg)));
        if (event.type === 'final_done') setLastUsage(event.usage);
      };
      const result = await runCollaboration({ question: q, thinkingMode, researchPacket, prompts, proxyUrl: freshCfg.proxyUrl, onEvent });
      if (cancelRef.current.cancelled || cancelRef.current.runId !== runId) return;
      const finalAgentRuns = Object.entries(result.agentRuns || {}).map(([agentId, run]) => ({ agentId, label: COLLABORATION_AGENT_META[agentId]?.label || agentId, prompt: prompts.prompts?.[agentId] || '', ...run }));
      await updateAnalysisRun(runId, { completedAt: Date.now(), status: result.status, agentRuns: finalAgentRuns, finalContent: result.finalContent, totalUsage: result.totalUsage, estimatedCostUSD: result.estimatedCostUSD, riskVerdict: result.riskVerdict });
      const completedApi = [...apiMessages, { role: 'user', content: q }, { role: 'assistant', content: result.finalContent }];
      const completedDisplay = finalDisplay.map((msg) => (msg.id === assistantId ? { ...msg, content: result.finalContent || msg.content, status: result.status === 'failed' ? 'error' : 'done', usage: result.totalUsage, collaboration: { ...(msg.collaboration || {}), agentRuns: finalAgentRuns, totalUsage: result.totalUsage, estimatedCostUSD: result.estimatedCostUSD, riskVerdict: result.riskVerdict } } : msg));
      setApiMessages(completedApi);
      setDisplayMessages(completedDisplay);
      await persistConversation({ convId, display: completedDisplay, api: completedApi, usage: result.totalUsage });
      await saveAiLog({ question: q.slice(0, 50), thinkingMode, inputTokens: result.totalUsage?.prompt_tokens || 0, outputTokens: result.totalUsage?.completion_tokens || 0, reasoningTokens: result.totalUsage?.reasoning_tokens || 0, estimatedCostUSD: parseFloat((result.estimatedCostUSD || 0).toFixed(4)), exaCallCount: Object.values(result.agentRuns || {}).flatMap((r) => r.toolEvents || []).filter((e) => e.name === 'exa_search').length });
    } catch (e) {
      setError(e.message);
      await updateAnalysisRun(runId, { status: 'failed', completedAt: Date.now(), error: e.message });
      applyDisplay((msgs) => msgs.map((msg) => (msg.id === assistantId ? { ...msg, content: msg.content || `出错：${e.message}`, status: 'error' } : msg)));
    } finally {
      setIsStreaming(false);
    }
  }

  async function cancelCollaboration() {
    if (!cancelRef.current.runId) return;
    cancelRef.current.cancelled = true;
    await updateAnalysisRun(cancelRef.current.runId, { status: 'cancelled', completedAt: Date.now() });
    setIsStreaming(false);
    setCollabSteps((steps) => steps.map((step) => (step.status === 'running' || step.status === 'waiting' ? { ...step, status: 'error' } : step)));
  }

  async function send() {
    const q = input.trim();
    if (!q || isStreaming) return;
    if (aiMode === 'collaboration') return sendCollaboration(q);

    const convId = currentConvId || makeId();
    const userDisplay = { id: makeId(), role: 'user', content: q, reasoning: '', reasoningDone: true, toolEvents: [], status: 'done', timestamp: Date.now() };
    const assistantId = makeId();
    const assistantDisplay = { id: assistantId, role: 'assistant', content: '', reasoning: '', reasoningDone: true, toolEvents: [], status: 'streaming', timestamp: Date.now() };
    const [freshCfg, freshFunds, freshTx, freshNavRows] = await Promise.all([getConfig(), getFunds(), getTransactions(), getNavHistory()]);
    const factorResult = buildCategoryFactorSnapshots({ config: freshCfg, funds: freshFunds, transactions: freshTx, navRows: freshNavRows, asOfDate: new Date().toISOString().slice(0, 10) });
    factorResult.fundsByCode = Object.fromEntries(freshFunds.map((fund) => [fund.code, fund]));
    const factorContextForLLM = formatFactorContextForLLM(factorResult);
    const contextMessage = { role: 'system', content: `${buildPortfolioContext(holdings, config)}\n\n${buildFactorContext(factorResult)}` };
    const shouldInjectFactorContext = !apiMessages.some((message) => message.role === 'user');
    const userApiMessage = { role: 'user', content: shouldInjectFactorContext && factorContextForLLM ? `${factorContextForLLM}\n\n${q}` : q };
    const nextDisplay = [...displayMessages, userDisplay, assistantDisplay];
    const nextApi = [...apiMessages, contextMessage, userApiMessage];

    setCurrentConvId(convId);
    setDisplayMessages(nextDisplay);
    setApiMessages(nextApi);
    setInput('');
    setIsStreaming(true);
    setLastUsage(null);
    setPipelineSteps([]);
    setHitl(null);
    setError('');

    let finalDisplay = nextDisplay;
    let assistantText = '';
    let finalUsage = null;
    const applyDisplay = (producer) => {
      setDisplayMessages((msgs) => {
        const updated = producer(msgs);
        finalDisplay = updated;
        if (runtimeRef.current) runtimeRef.current.finalDisplay = updated;
        return updated;
      });
    };

    try {
      const cfg = await getConfig();
      const apiKey = localStorage.getItem('deepseekApiKey');
      const triageRes = await runStep(TRIAGE_PROMPT, q, thinkingMode, apiKey);
      const triage = jsonParseSafe(triageRes.content, { skill: 'general', params: {}, reason: '无法解析意图' });
      finalUsage = triageRes.usage;
      setLastUsage(finalUsage);

      if (triage.skill === 'general') {
        const usage = await streamWithTools({
          messages: nextApi,
          systemPrompt: ANALYST_SYSTEM_PROMPT,
          thinkingMode,
          tools: TOOL_DEFINITIONS,
          executeTool: (name, args) => runTool(name, args, { proxyUrl: cfg.proxyUrl, holdings, config }),
          onChunk: (chunk) => {
            if (chunk.type === 'text') { assistantText += chunk.content; applyDisplay((msgs) => msgs.map((msg) => (msg.id === assistantId ? { ...msg, content: msg.content + chunk.content } : msg))); }
            if (chunk.type === 'tool_start') applyDisplay((msgs) => msgs.map((msg) => (msg.id === assistantId ? { ...msg, toolEvents: [...(msg.toolEvents || []), { callId: chunk.callId, name: chunk.name, status: 'running', result: '' }] } : msg)));
            if (chunk.type === 'tool_result') applyDisplay((msgs) => msgs.map((msg) => (msg.id === assistantId ? { ...msg, toolEvents: (msg.toolEvents || []).map((evt) => (evt.callId === chunk.callId ? { ...evt, status: chunk.error ? 'error' : 'done', error: chunk.error, result: chunk.result } : evt)) } : msg)));
            if (chunk.type === 'done') { finalUsage = chunk.usage; setLastUsage(chunk.usage); applyDisplay((msgs) => msgs.map((msg) => (msg.id === assistantId ? { ...msg, status: 'done', usage: chunk.usage } : msg))); }
          },
        });
        finalUsage = finalUsage || usage;
        const completedApi = [...nextApi, { role: 'assistant', content: assistantText }];
        setApiMessages(completedApi);
        await persistConversation({ convId, display: finalDisplay, api: completedApi, usage: finalUsage });
        await saveAiLog({ question: q.slice(0, 50), thinkingMode, inputTokens: finalUsage?.prompt_tokens || 0, outputTokens: finalUsage?.completion_tokens || 0, reasoningTokens: finalUsage?.reasoning_tokens || 0, estimatedCostUSD: parseFloat(estimateCost(finalUsage || {}).toFixed(4)), exaCallCount: (finalDisplay[finalDisplay.length - 1]?.toolEvents || []).filter((e) => e.name === 'exa_search').length });
        return;
      }

      setPipelineSteps(stepLabelsFor(triage.skill));
      const navFetcher = (code, days) => fetchNavHistory(code, days);
      const exaSearcher = (query, category = 'news') => exaSearch(query, category, cfg.proxyUrl);
      const params = triage.params || {};
      const iterator = triage.skill === 'new_capital'
        ? runNewCapital(params.amount, holdings, config, navFetcher, exaSearcher, thinkingMode, apiKey)
        : triage.skill === 'fund_dive'
          ? runFundDive(params.fundCode, params.fundName, holdings, config, navFetcher, exaSearcher, thinkingMode, apiKey)
          : runHealthCheck(holdings, config, thinkingMode, apiKey);
      iteratorRef.current = iterator;
      runtimeRef.current = { q, convId, assistantId, nextApi, finalDisplay, assistantText, finalUsage, applyDisplay };
      await consumePipeline();
    } catch (e) {
      setError(e.message);
      applyDisplay((msgs) => msgs.map((msg) => (msg.id === assistantId ? { ...msg, content: msg.content || `出错：${e.message}`, status: 'error', reasoningDone: true } : msg)));
    } finally {
      setIsStreaming(false);
    }
  }

  const modeLabel = aiMode === 'single' ? '单AI' : '四AI协同';
  const thinkingLabel = THINKING_LABELS[thinkingMode] || '无思考';
  const visibleConversations = conversations.slice(0, 50);

  return <div className="relative flex h-[calc(100vh-7rem)] min-h-[640px] flex-col overflow-hidden rounded-lg border border-vscode-border bg-vscode-panel">
    <header className="relative z-20 flex h-11 shrink-0 items-center justify-between border-b border-vscode-border bg-[#181818] px-3">
      <button className="rounded p-2 text-xl text-gray-200 hover:bg-[#2a2a2a]" onClick={() => setDrawerOpen(true)} aria-label="打开对话设置">☰</button>
      <div className="text-center leading-tight">
        <h2 className="text-base font-semibold text-white">AI分析师</h2>
        <p className="text-[11px] text-gray-500">{modeLabel} · {thinkingLabel}思考</p>
      </div>
      <div className="relative">
        <button className="rounded px-3 py-2 text-xl text-gray-200 hover:bg-[#2a2a2a]" onClick={() => setMoreOpen((value) => !value)} aria-label="更多操作">⋯</button>
        {moreOpen && <div className="absolute right-0 top-10 z-30 w-36 rounded-lg border border-vscode-border bg-[#1e1e1e] p-1 text-sm shadow-xl">
          <button className="block w-full rounded px-3 py-2 text-left text-gray-100 hover:bg-[#2a2a2a]" disabled={isStreaming} onClick={() => { setMoreOpen(false); startNewConversation(); }}>新对话</button>
          <button className="block w-full rounded px-3 py-2 text-left text-red-300 hover:bg-[#2a2a2a]" disabled={!conversations.length || isStreaming} onClick={() => { setMoreOpen(false); clearHistory(); }}>清空历史</button>
        </div>}
      </div>
    </header>

    <div className={`fixed inset-0 z-30 bg-black/50 transition-opacity duration-300 ${drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`} onClick={() => setDrawerOpen(false)} />
    <aside className={`fixed left-0 top-0 z-40 flex h-full w-[280px] max-w-full flex-col border-r border-vscode-border bg-[#181818] p-4 shadow-2xl transition-transform duration-300 ease-in-out sm:w-[280px] ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="mb-5 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">对话设置</h3>
        <button className="rounded p-2 text-gray-300 hover:bg-[#2a2a2a]" onClick={() => setDrawerOpen(false)}>✕</button>
      </div>
      <div className="space-y-5 text-sm">
        <div>
          <p className="mb-2 text-gray-400">AI模式</p>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-vscode-border bg-[#111] p-1">
            <button className={aiMode === 'single' ? 'btn' : 'btn2'} disabled={isStreaming} onClick={() => setAiMode('single')}>单AI</button>
            <button className={aiMode === 'collaboration' ? 'btn' : 'btn2'} disabled={isStreaming} onClick={() => setAiMode('collaboration')}>四AI协同</button>
          </div>
        </div>
        <div>
          <p className="mb-2 text-gray-400">思考深度</p>
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-vscode-border bg-[#111] p-1">
            {MODE_OPTIONS.map(([value, label]) => <button key={value} className={thinkingMode === value ? 'btn' : 'btn2'} disabled={isStreaming} onClick={() => setThinkingMode(value)}>{label}</button>)}
          </div>
        </div>
        <div className="border-t border-vscode-border pt-4">
          <p className="mb-2 text-gray-400">操作</p>
          <button className="btn mb-2 w-full" disabled={isStreaming} onClick={startNewConversation}>+ 新对话</button>
          <button className="btn2 w-full text-red-300" disabled={!conversations.length || isStreaming} onClick={clearHistory}>清空所有历史</button>
        </div>
      </div>
      <div className="mt-5 min-h-0 flex-1 border-t border-vscode-border pt-4">
        <h3 className="mb-3 font-semibold text-white">对话历史</h3>
        <div className="max-h-full space-y-2 overflow-auto pr-1">
          {conversations.length === 0 && <p className="text-sm text-gray-500">暂无历史对话</p>}
          {visibleConversations.map((conv) => <button key={conv.id} onClick={() => loadConversation(conv.id)} className={`w-full rounded p-2 text-left text-sm hover:bg-[#2a2a2a] ${conv.id === currentConvId ? 'bg-[#2a2a2a] text-white' : 'text-gray-300'}`}>
            <span className="block truncate">{(conv.title || '新对话').slice(0, 30)}</span>
            <span className="mt-1 block text-xs text-gray-500">{relativeTime(conv.updatedAt || conv.createdAt)}</span>
          </button>)}
          {conversations.length > visibleConversations.length && <p className="py-2 text-center text-xs text-gray-500">仅显示最近50条历史</p>}
        </div>
      </div>
      <div className="mt-4 rounded border border-vscode-border bg-[#111] p-3 text-xs text-gray-500">AI 会读取持仓、因子快照，并按需拉取净值历史或搜索外部事实。</div>
    </aside>

    <section className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollerRef} className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {displayMessages.length === 0 && <div className="grid h-full place-items-center text-center text-gray-500"><div className="rounded-2xl border border-vscode-border bg-[#181818]/80 px-6 py-5"><p className="text-lg text-gray-300">询问新增资金如何配置</p><p className="mt-2 text-sm">AI会读取持仓...</p></div></div>}
        {(pipelineSteps.length > 0 || hitl) && <div className="rounded-lg border border-vscode-border bg-[#181818] p-3">
          {pipelineSteps.length > 0 && <div className="mb-3 flex flex-wrap gap-2 text-sm">
            {pipelineSteps.map((step) => <div key={step.name} className="flex items-center gap-2 rounded-full border border-vscode-border px-3 py-1 text-gray-300">
              {step.status === 'running' ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" /> : step.status === 'done' ? <span className="text-green-400">✓</span> : <span className="h-2 w-2 rounded-full bg-gray-500" />}
              <span>{step.label}</span>
              <span className="text-xs text-gray-500">{step.status === 'waiting' ? '等待中' : step.status === 'running' ? '运行中' : `${(step.duration / 1000).toFixed(1)}s`}</span>
            </div>)}
          </div>}
          {hitl && <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 p-3 text-sm">
            <pre className="whitespace-pre-wrap text-gray-100">{hitl.summary}</pre>
            <div className="mt-3 flex gap-2"><button className="btn" onClick={continueHitl}>继续生成建议</button><button className="btn2" onClick={cancelHitl}>取消</button></div>
          </div>}
        </div>}
        {displayMessages.map((msg) => <div key={msg.id} className={msg.role === 'user' ? 'text-right' : 'text-left'}>
          <div className={`inline-block max-w-[92%] rounded-lg p-3 text-sm ${msg.role === 'user' ? 'bg-vscode-blue text-white' : 'bg-[#1e1e1e] text-gray-100'}`}>
            {msg.reasoning && <details className="my-2 rounded border border-vscode-border"><summary className="cursor-pointer px-3 py-1 text-sm text-gray-400">{msg.reasoningDone ? '▶ 查看思考过程' : '⏳ 思考中...'}</summary><pre className="whitespace-pre-wrap p-3 text-xs text-gray-500">{msg.reasoning}</pre></details>}
            {msg.toolEvents?.map((evt) => <div key={evt.callId} className="my-1 text-xs text-gray-400">{evt.status === 'running' ? `🔍 正在${getToolLabel(evt.name)}...` : evt.error ? `✗ ${getToolLabel(evt.name)}失败` : `✓ ${getToolLabel(evt.name)}完成`}</div>)}
            {msg.role === 'assistant' ? <div><ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{msg.content || (msg.status === 'streaming' ? '...' : '')}</ReactMarkdown></div> : <div className="whitespace-pre-wrap">{msg.content}</div>}
            {msg.collaboration && <details className="mt-3 rounded border border-vscode-border p-2 text-left text-xs text-gray-400"><summary className="cursor-pointer text-gray-200">查看协同过程</summary><div className="mt-2 space-y-2"><div>风险审查 verdict：{msg.collaboration.riskVerdict || '—'}</div><div>总 token：{((msg.collaboration.totalUsage?.prompt_tokens || 0) + (msg.collaboration.totalUsage?.completion_tokens || 0) + (msg.collaboration.totalUsage?.reasoning_tokens || 0)).toLocaleString()}；估算成本：${(msg.collaboration.estimatedCostUSD || 0).toFixed(4)}</div>{(msg.collaboration.agentRuns || []).map((run) => <details key={run.agentId} className="rounded bg-[#111] p-2"><summary className="cursor-pointer">{run.label || run.agentId} · {run.status} · {run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'} · tokens {((run.usage?.prompt_tokens || 0) + (run.usage?.completion_tokens || 0) + (run.usage?.reasoning_tokens || 0)).toLocaleString()}</summary><div className="mt-2"><div className="mb-1 text-gray-500">角色 Prompt 当前版本</div><pre className="whitespace-pre-wrap">{run.prompt || '—'}</pre><div className="mb-1 mt-2 text-gray-500">原始报告</div><pre className="whitespace-pre-wrap">{JSON.stringify(run.report || {}, null, 2)}</pre>{run.toolEvents?.length > 0 && <><div className="mb-1 mt-2 text-gray-500">工具调用和来源</div><pre className="whitespace-pre-wrap">{JSON.stringify(run.toolEvents, null, 2)}</pre></>}</div></details>)}</div></details>}
            {msg.status === 'error' && <div className="mt-2 text-xs text-red-400">生成失败</div>}
            {msg.usage && <div className="mt-2 text-right text-xs text-gray-500">Input {msg.usage.prompt_tokens?.toLocaleString()} | Output {msg.usage.completion_tokens?.toLocaleString()} | Reasoning {msg.usage.reasoning_tokens?.toLocaleString()} tokens | ≈${estimateCost(msg.usage).toFixed(4)}</div>}
          </div>
        </div>)}
        {aiMode === 'collaboration' && collabSteps.length > 0 && <div className="rounded-lg border border-vscode-border bg-[#181818] p-3"><div className="flex flex-wrap gap-2 text-sm">{collabSteps.map((step) => <div key={step.agentId} className="flex items-center gap-2 rounded-full border border-vscode-border px-3 py-1 text-gray-300"><span>{step.status === 'running' ? '⏳' : step.status === 'done' ? '✓' : step.status === 'error' ? '✗' : '○'}</span><span>{step.label}</span><span className="text-xs text-gray-500">{step.status}{step.durationMs ? ` ${(step.durationMs / 1000).toFixed(1)}s` : ''}</span></div>)}</div>{isStreaming && <button className="btn2 mt-3 text-red-300" onClick={cancelCollaboration}>取消协同任务</button>}</div>}
      </div>
      <div className="shrink-0 border-t border-vscode-border bg-[#181818] p-3 sm:p-4">
        {lastUsage && <div className="mb-2 text-right text-xs text-gray-500">Token消耗：{((lastUsage.prompt_tokens || 0) + (lastUsage.completion_tokens || 0) + (lastUsage.reasoning_tokens || 0)).toLocaleString()} | ≈${estimateCost(lastUsage).toFixed(4)}</div>}
        {error && <p className="danger mb-2">{error}</p>}
        <div className="relative">
          <textarea ref={inputRef} rows={3} className="input min-h-[25vh] w-full resize-none overflow-hidden pb-12 pr-16 leading-6" style={{ maxHeight: '32vh' }} value={input} disabled={isStreaming} onInput={handleInput} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="例如：本月新增1万元，优先买哪个方向？" />
          <button className="btn absolute bottom-3 right-3 px-5" disabled={isStreaming || !input.trim()} onClick={send}>{isStreaming ? '生成中' : '发送'}</button>
        </div>
      </div>
    </section>
  </div>;
}
