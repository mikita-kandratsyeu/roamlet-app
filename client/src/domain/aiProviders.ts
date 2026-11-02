export const AI_PROVIDER_TEMPLATES = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
] as const;
export function aiProviderTemplate(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, '');
  return AI_PROVIDER_TEMPLATES.find((template) => template.baseUrl === normalized ||
    (template.name === 'DeepSeek' && normalized === `${template.baseUrl}/v1`));
}
export function aiProviderChoices(allowed: string[]) {
  const known = AI_PROVIDER_TEMPLATES.map((template) => ({ ...template,
    value: allowed.find((url) => aiProviderTemplate(url)?.name === template.name) ?? template.baseUrl,
    enabled: allowed.some((url) => aiProviderTemplate(url)?.name === template.name),
  }));
  const custom = allowed.filter((url) => !aiProviderTemplate(url)).map((url) => ({ name: url, baseUrl: url, value: url, model: '', enabled: true }));
  return [...known, ...custom];
}
