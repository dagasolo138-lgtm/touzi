const MODEL = 'deepseek-v4-pro';
const BASE_URL = 'https://api.deepseek.com';
const MAX_TOOL_ROUNDS = 5;

export const THINKING_CONFIG = {
  disabled: { thinking: { type: 'disabled' } },
  high: { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
  max: { thinking: { type: 'enabled' }, reasoning_effort: 'max' },
};

export async function streamWithTools({ messages, systemPrompt, thinkingMode = 'disabled', tools, onChunk, executeTool }) {
  const apiKey = localStorage.getItem('deepseekApiKey');
  if (!apiKey) throw new Error('请先在设置页填写 DeepSeek API Key');

  const config = THINKING_CONFIG[thinkingMode] || THINKING_CONFIG.disabled;
  const currentMessages = [{ role: 'system', content: systemPrompt }, ...messages];
  const totalUsage = { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0 };
  let toolRounds = 0;

  while (toolRounds <= MAX_TOOL_ROUNDS) {
    const { toolCalls, usage, assistantMessage } = await streamOnce({ messages: currentMessages, config, tools, onChunk, apiKey });
    totalUsage.prompt_tokens += usage?.prompt_tokens || 0;
    totalUsage.completion_tokens += usage?.completion_tokens || 0;
    totalUsage.reasoning_tokens += usage?.reasoning_tokens || usage?.completion_tokens_details?.reasoning_tokens || 0;

    if (!toolCalls || toolCalls.length === 0) break;
    currentMessages.push(assistantMessage);

    for (const call of toolCalls) {
      onChunk?.({ type: 'tool_start', name: call.function.name, callId: call.id });
      try {
        const args = JSON.parse(call.function.arguments || '{}');
        const result = await executeTool(call.function.name, args);
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        onChunk?.({ type: 'tool_result', callId: call.id, name: call.function.name, result: resultStr });
        currentMessages.push({ role: 'tool', tool_call_id: call.id, content: resultStr });
      } catch (e) {
        const errStr = `工具执行失败：${e.message}`;
        onChunk?.({ type: 'tool_result', callId: call.id, name: call.function.name, result: errStr, error: true });
        currentMessages.push({ role: 'tool', tool_call_id: call.id, content: errStr });
      }
    }
    toolRounds += 1;
  }

  onChunk?.({ type: 'done', usage: totalUsage });
  return totalUsage;
}

export async function streamOnce({ messages, config, tools, onChunk, apiKey }) {
  const body = { model: MODEL, messages, stream: true, stream_options: { include_usage: true }, tools: tools?.length ? tools : undefined, tool_choice: tools?.length ? 'auto' : undefined, ...config };
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `DeepSeek API错误 ${res.status}`);
  }
  if (!res.body) throw new Error('DeepSeek API未返回流式响应');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage = null;
  const toolCallsMap = {};
  let assistantContent = '';
  let assistantReasoning = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      let chunk;
      try { chunk = JSON.parse(raw); } catch { continue; }
      if (chunk.usage) { usage = chunk.usage; continue; }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.reasoning_content) {
        assistantReasoning += delta.reasoning_content;
        onChunk?.({ type: 'reasoning', content: delta.reasoning_content });
      }
      if (delta.content) {
        assistantContent += delta.content;
        onChunk?.({ type: 'text', content: delta.content });
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallsMap[idx]) toolCallsMap[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) toolCallsMap[idx].id = tc.id;
          if (tc.function?.name) toolCallsMap[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCallsMap[idx].function.arguments += tc.function.arguments;
        }
      }
    }
  }

  const toolCalls = Object.values(toolCallsMap);
  return {
    toolCalls,
    usage,
    assistantMessage: { role: 'assistant', content: assistantContent || null, ...(assistantReasoning ? { reasoning_content: assistantReasoning } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
  };
}

export async function chatCompletion({ messages, systemPrompt, thinkingMode = 'disabled', apiKey }) {
  const key = apiKey || localStorage.getItem('deepseekApiKey');
  if (!key) throw new Error('请先在设置页填写 DeepSeek API Key');
  const config = THINKING_CONFIG[thinkingMode] || THINKING_CONFIG.disabled;
  const body = { model: MODEL, messages: [{ role: 'system', content: systemPrompt }, ...messages], stream: false, ...config };
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `DeepSeek API错误 ${res.status}`);
  }
  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content || '', usage: data.usage || {} };
}

export async function streamChatCompletion({ messages, systemPrompt, thinkingMode = 'disabled', apiKey, onChunk }) {
  const key = apiKey || localStorage.getItem('deepseekApiKey');
  if (!key) throw new Error('请先在设置页填写 DeepSeek API Key');
  const config = THINKING_CONFIG[thinkingMode] || THINKING_CONFIG.disabled;
  const { usage } = await streamOnce({ messages: [{ role: 'system', content: systemPrompt }, ...messages], config, onChunk, apiKey: key });
  onChunk?.({ type: 'done', usage: usage || {} });
  return { usage: usage || {} };
}

export function estimateCost(usageOrInput = 0, outputTokens = 0) {
  const input = typeof usageOrInput === 'object' ? usageOrInput?.prompt_tokens || usageOrInput?.inputTokens || 0 : usageOrInput;
  const output = typeof usageOrInput === 'object' ? usageOrInput?.completion_tokens || usageOrInput?.outputTokens || 0 : outputTokens;
  return (input / 1e6) * 0.435 + (output / 1e6) * 0.87;
}
