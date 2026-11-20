import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';

const baseURL = 'https://api.anthropic.com';
const defaultModel = 'claude-sonnet-5-5';

export function anthropicSettings() {
  let file = {};
  try {
    file = parseEnv(readFileSync('.env', 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const setting = (name) => file[name]?.trim() || process.env[name]?.trim();
  const apiKey = setting('ANTHROPIC_API_KEY');
  const model = setting('LLM_MODEL') || defaultModel;
  const reasoningEffort = setting('REASONING_EFFORT') || 'none';
  if (!apiKey) throw new Error('Set ANTHROPIC_API_KEY in .env before starting the agent.');
  if (!['none', 'minimal', 'low', 'medium', 'high'].includes(reasoningEffort)) {
    throw new Error('REASONING_EFFORT must be none, minimal, low, medium, or high.');
  }
  return { apiKey, model, reasoningEffort };
}

function thinkingOptions(capabilities, reasoningEffort) {
  if (!capabilities?.thinking?.supported) return {};
  const types = capabilities.thinking.types ?? {};
  const effort = ['none', 'minimal'].includes(reasoningEffort) ? 'low' : reasoningEffort;
  const output = capabilities.effort?.[effort]?.supported ? { output_config: { effort } } : {};
  if (reasoningEffort === 'none') {
    if (types.disabled?.supported) return { thinking: { type: 'disabled' } };
    if (types.between_tools?.supported) return { thinking: { type: 'between_tools' }, ...output };
  }
  if (types.adaptive?.supported) return { thinking: { type: 'adaptive' }, ...output };
  if (types.enabled?.supported && reasoningEffort !== 'none') {
    const budgets = { minimal: 1024, low: 1024, medium: 2048, high: 4096 };
    return { thinking: { type: 'enabled', budget_tokens: budgets[reasoningEffort] }, ...output };
  }
  return output;
}

export async function createAnthropicClient({ apiKey, model, reasoningEffort }) {
  const response = await fetch(`${baseURL}/v1/models/${encodeURIComponent(model)}`, {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Could not load Anthropic model ${model} (HTTP ${response.status}). Check LLM_MODEL and ANTHROPIC_API_KEY.`);
  const { capabilities } = await response.json();
  const options = thinkingOptions(capabilities, reasoningEffort);

  // The pinned LiveKit adapter builds the Messages request but has no thinking options.
  // Apply the selected model's supported settings to both streaming and vision requests.
  return new Anthropic({ apiKey, baseURL, maxRetries: 0, fetch(url, init) {
    if (init?.method?.toUpperCase() !== 'POST' || new URL(url).pathname !== '/v1/messages') return fetch(url, init);
    const body = JSON.parse(init.body);
    const budget = options.thinking?.budget_tokens ?? 0;
    const headers = new Headers(init.headers);
    headers.delete('content-length');
    return fetch(url, { ...init, headers, body: JSON.stringify({
      ...body, ...options, max_tokens: body.max_tokens + budget,
      // Extended thinking supports automatic tool selection with tool calls.
      ...(options.thinking?.type === 'enabled' && body.tool_choice &&
        !['auto', 'none'].includes(body.tool_choice.type) &&
        { tool_choice: { ...body.tool_choice, type: 'auto', name: undefined } }),
    }) });
  } });
}
