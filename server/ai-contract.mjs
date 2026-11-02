import { GithubError as AiError } from './github-http.mjs';
export { AiError };

export const PROFILES = ['cycling-regular', 'cycling-road', 'cycling-mountain'];
export function object(value, allowed, required = allowed, status = 400) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  )
    throw new AiError('invalid-data', status);
  return value;
}
export function text(value, max, status = 400) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    [...value].some((character) => {
      const code = character.codePointAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    })
  )
    throw new AiError('invalid-data', status);
  return value;
}
export function connection(value, providers, status = 400) {
  object(value, ['baseUrl', 'model', 'apiKey'], undefined, status);
  if (
    !providers.includes(value.baseUrl) ||
    typeof value.model !== 'string' ||
    !/^[\x21-\x7e]{1,128}$/.test(value.model) ||
    typeof value.apiKey !== 'string' ||
    !/^[\x21-\x7e]{1,1024}$/.test(value.apiKey)
  )
    throw new AiError('invalid-data', status);
  const settings = { baseUrl: value.baseUrl, model: value.model, apiKey: value.apiKey };
  // Leave room for timestamps, encryption and attributes below the browser's 4 KiB cookie limit.
  if (Buffer.byteLength(JSON.stringify(settings), 'utf8') > 2700)
    throw new AiError('too-large', status === 400 ? 413 : status);
  return settings;
}
export function routingOptions(value, partial = false, status = 400) {
  const keys = ['cyclingProfile', 'avoidFerries', 'avoidSteps'];
  object(value, keys, partial ? [] : keys, status);
  if (
    (Object.hasOwn(value, 'cyclingProfile') && !PROFILES.includes(value.cyclingProfile)) ||
    ['avoidFerries', 'avoidSteps'].some(
      (key) => Object.hasOwn(value, key) && typeof value[key] !== 'boolean',
    )
  )
    throw new AiError('invalid-data', status);
  return { ...value };
}
export function proposalInput(value) {
  object(value, ['prompt', 'context']);
  text(value.prompt, 2000);
  object(value.context, ['activity', 'routingOptions']);
  if (!['cycling', 'hiking'].includes(value.context.activity))
    throw new AiError('invalid-data', 400);
  routingOptions(value.context.routingOptions);
  return value;
}
export function proposalOutput(value, activity) {
  object(value, ['routingOptions', 'explanation'], undefined, 502);
  const options = routingOptions(value.routingOptions, true, 502);
  if (activity === 'hiking' && Object.hasOwn(options, 'cyclingProfile'))
    throw new AiError('invalid-data', 502);
  return { routingOptions: options, explanation: text(value.explanation, 2000, 502).trim() };
}
