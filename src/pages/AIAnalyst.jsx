import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { clearAllConversations, deleteConversation, getConfig, getConversation, getConversations, saveAiLog, saveConversation } from '../db/index.js';
import { estimateCost, streamWithTools } from '../services/deepseek.js';
import { ANALYST_SYSTEM_PROMPT } from '../services/analystPrompt.js';
import { TOOL_DEFINITIONS, buildPortfolioContext, executeTool as runTool } from '../services/exaSearch.js';
import { useStore } from '../store/useStore.js';
import { makeId } from '../utils/formatters.js';

const MODE_OPTIONS = [
  ['disabled', '无思考'],
  ['high', '标准'],
  ['max', '深度'],
];

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
  const scrollerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { loadAll(); refreshConversations(); }, [loadAll]);
  useEffect(() => { if (config?.defaultThinkingMode) setThinkingMode(config.defaultThinkingMode); }, [config?.defaultThinkingMode]);
  useEffect(() => { scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' }); }, [displayMessages]);
  useEffect(() => { if (!input && inputRef.current) inputRef.current.style.height = 'auto'; }, [input]);

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
    setError('');
  }

  async function loadConversation(id) {
    if (isStreaming) return;
    const conv = await getConversation(id);
    if (!conv) return;
    setCurrentConvId(conv.id);
    setDisplayMessages(conv.displayMessages || (conv.messages || []).filter((m) => m.role !== 'system' && m.role !== 'tool').map(toDisplayMessage));
    setApiMessages(conv.apiMessages || conv.messages || []);
    setLastUsage(conv.lastUsage || null);
    setError('');
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
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
    target.style.overflowY = target.scrollHeight > 120 ? 'auto' : 'hidden';
  }

  function handleInput(event) {
    setInput(event.target.value);
    resizeInput(event.target);
  }

  async function send() {
    const q = input.trim();
    if (!q || isStreaming) return;

    const convId = currentConvId || makeId();
    const userDisplay = { id: makeId(), role: 'user', content: q, reasoning: '', reasoningDone: true, toolEvents: [], status: 'done', timestamp: Date.now() };
    const assistantId = makeId();
    const assistantDisplay = { id: assistantId, role: 'assistant', content: '', reasoning: '', reasoningDone: false, toolEvents: [], status: 'streaming', timestamp: Date.now() };
    const contextMessage = { role: 'system', content: latestContext };
    const userApiMessage = { role: 'user', content: q };
    const nextDisplay = [...displayMessages, userDisplay, assistantDisplay];
    const nextApi = [...apiMessages, contextMessage, userApiMessage];

    setCurrentConvId(convId);
    setDisplayMessages(nextDisplay);
    setApiMessages(nextApi);
    setInput('');
    setIsStreaming(true);
    setLastUsage(null);
    setError('');

    let finalDisplay = nextDisplay;
    let assistantText = '';
    let assistantReasoning = '';
    let finalUsage = null;

    const applyDisplay = (producer) => {
      setDisplayMessages((msgs) => {
        const updated = producer(msgs);
        finalDisplay = updated;
        return updated;
      });
    };

    try {
      const cfg = await getConfig();
      const usage = await streamWithTools({
        messages: nextApi,
        systemPrompt: ANALYST_SYSTEM_PROMPT,
        thinkingMode,
        tools: TOOL_DEFINITIONS,
        executeTool: (name, args) => runTool(name, args, { proxyUrl: cfg.proxyUrl, holdings, config }),
        onChunk: (chunk) => {
          if (chunk.type === 'reasoning') {
            assistantReasoning += chunk.content;
            applyDisplay((msgs) => msgs.map((msg) => (msg.id === assistantId ? { ...msg, reasoning: msg.reasoning + chunk.content } : msg)));
          }
          if (chunk.type === 'text') {
            assistantText += chunk.content;
            applyDisplay((msgs) => msgs.map((msg) => (msg.id === assistantId ? { ...msg, content: msg.content + chunk.content, reasoningDone: true } : msg)));
          }
          if (chunk.type === 'tool_start') {
            applyDisplay((msgs) => msgs.map((msg) => (msg.id === assistantId ? { ...msg, reasoningDone: true, toolEvents: [...(msg.toolEvents || []), { callId: chunk.callId, name: chunk.name, status: 'running', result: '' }] } : msg)));
          }
          if (chunk.type === 'tool_result') {
            applyDisplay((msgs) => msgs.map((msg) => (msg.id === assistantId ? { ...msg, toolEvents: (msg.toolEvents || []).map((evt) => (evt.callId === chunk.callId ? { ...evt, status: chunk.error ? 'error' : 'done', error: chunk.error, result: chunk.result } : evt)) } : msg)));
          }
          if (chunk.type === 'done') {
            finalUsage = chunk.usage;
            setLastUsage(chunk.usage);
            applyDisplay((msgs) => msgs.map((msg) => (msg.id === assistantId ? { ...msg, status: 'done', reasoningDone: true, usage: chunk.usage } : msg)));
          }
          if (chunk.type === 'error') throw new Error(chunk.message);
        },
      });
      finalUsage = finalUsage || usage;
      const completedApi = [...nextApi, { role: 'assistant', content: assistantText }];
      setApiMessages(completedApi);
      await persistConversation({ convId, display: finalDisplay, api: completedApi, usage: finalUsage });
      await saveAiLog({
        question: q.slice(0, 50),
        thinkingMode,
        inputTokens: finalUsage?.prompt_tokens || 0,
        outputTokens: finalUsage?.completion_tokens || 0,
        reasoningTokens: finalUsage?.reasoning_tokens || 0,
        estimatedCostUSD: parseFloat(estimateCost(finalUsage || {}).toFixed(4)),
        exaCallCount: (finalDisplay[finalDisplay.length - 1]?.toolEvents || []).filter((e) => e.name === 'exa_search').length,
      });
    } catch (e) {
      setError(e.message);
      applyDisplay((msgs) => msgs.map((msg) => (msg.id === assistantId ? { ...msg, content: msg.content || `出错：${e.message}`, status: 'error', reasoningDone: true } : msg)));
    } finally {
      setIsStreaming(false);
    }
  }

  return <div className="flex h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-lg border border-vscode-border bg-vscode-panel">
    <header className="flex items-center justify-between border-b border-vscode-border p-4">
      <h2 className="text-xl font-bold text-white">AI 分析师</h2>
      <div className="flex flex-wrap items-center gap-2">
        {MODE_OPTIONS.map(([value, label]) => <button key={value} className={thinkingMode === value ? 'btn' : 'btn2'} disabled={isStreaming} onClick={() => setThinkingMode(value)}>{label}</button>)}
        <button className="btn2" disabled={isStreaming} onClick={startNewConversation}>新对话</button>
      </div>
    </header>
    <div className="grid min-h-0 flex-1 md:grid-cols-[16rem_1fr]">
      <aside className="flex min-h-0 flex-col border-r border-vscode-border p-3">
        <h3 className="mb-3 font-semibold">对话历史</h3>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto">
          {conversations.length === 0 && <p className="text-sm text-gray-500">暂无历史对话</p>}
          {conversations.map((conv) => <button key={conv.id} onClick={() => loadConversation(conv.id)} className={`w-full rounded p-2 text-left text-sm hover:bg-[#2a2a2a] ${conv.id === currentConvId ? 'bg-[#2a2a2a] text-white' : 'text-gray-300'}`}>
            <span className="block truncate">{conv.title}</span>
            <span className="mt-1 flex items-center justify-between text-xs text-gray-500"><span>{new Date(conv.updatedAt).toLocaleString('zh-CN')}</span><span className="text-red-400" onClick={(e) => removeConversation(conv.id, e)}>删除</span></span>
          </button>)}
        </div>
        <button className="btn2 mt-3 text-red-400" disabled={!conversations.length || isStreaming} onClick={clearHistory}>清空历史</button>
      </aside>
      <section className="flex min-h-0 flex-col">
        <div ref={scrollerRef} className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {displayMessages.length === 0 && <div className="grid h-full place-items-center text-center text-gray-500"><div><p className="text-lg text-gray-300">询问新增资金如何配置</p><p className="mt-2 text-sm">AI 会读取持仓、拉取净值历史并按需搜索实时信息。</p></div></div>}
          {displayMessages.map((msg) => <div key={msg.id} className={msg.role === 'user' ? 'text-right' : 'text-left'}>
            <div className={`inline-block max-w-[90%] rounded-lg p-3 text-sm ${msg.role === 'user' ? 'bg-vscode-blue text-white' : 'bg-[#1e1e1e] text-gray-100'}`}>
              {msg.reasoning && <details className="my-2 rounded border border-vscode-border"><summary className="cursor-pointer px-3 py-1 text-sm text-gray-400">{msg.reasoningDone ? '▶ 查看思考过程' : '⏳ 思考中...'}</summary><pre className="whitespace-pre-wrap p-3 text-xs text-gray-500">{msg.reasoning}</pre></details>}
              {msg.toolEvents?.map((evt) => <div key={evt.callId} className="my-1 text-xs text-gray-400">{evt.status === 'running' ? `🔍 正在${getToolLabel(evt.name)}...` : evt.error ? `✗ ${getToolLabel(evt.name)}失败` : `✓ ${getToolLabel(evt.name)}完成`}</div>)}
              {msg.role === 'assistant' ? <div><ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{msg.content || (msg.status === 'streaming' ? '...' : '')}</ReactMarkdown></div> : <div className="whitespace-pre-wrap">{msg.content}</div>}
              {msg.status === 'error' && <div className="mt-2 text-xs text-red-400">生成失败</div>}
              {msg.usage && <div className="mt-2 text-right text-xs text-gray-500">Input {msg.usage.prompt_tokens?.toLocaleString()} | Output {msg.usage.completion_tokens?.toLocaleString()} | Reasoning {msg.usage.reasoning_tokens?.toLocaleString()} tokens | ≈${estimateCost(msg.usage).toFixed(4)}</div>}
            </div>
          </div>)}
        </div>
        <div className="border-t border-vscode-border p-4">
          {lastUsage && <div className="mb-2 text-right text-xs text-gray-500">Token消耗：{((lastUsage.prompt_tokens || 0) + (lastUsage.completion_tokens || 0) + (lastUsage.reasoning_tokens || 0)).toLocaleString()} | ≈${estimateCost(lastUsage).toFixed(4)}</div>}
          {error && <p className="danger mb-2">{error}</p>}
          <div className="flex gap-2">
            <textarea ref={inputRef} rows={1} className="input flex-1 resize-none overflow-hidden leading-6" style={{ maxHeight: '120px' }} value={input} disabled={isStreaming} onInput={handleInput} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="例如：本月新增1万元，优先买哪个方向？" />
            <button className="btn px-6" disabled={isStreaming || !input.trim()} onClick={send}>{isStreaming ? '生成中' : '发送'}</button>
          </div>
        </div>
      </section>
    </div>
  </div>;
}
