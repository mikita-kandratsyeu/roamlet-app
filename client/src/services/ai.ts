import { validAiProposal, type AiContext, type AiProposal } from '../domain/ai';
export interface AiConnection {
  baseUrl: string;
  model: string;
}
export interface AiSession {
  available: boolean;
  connected: boolean;
  providers: string[];
  connection?: AiConnection;
}
export const aiErrors = {
  configuration: 'AI connection settings are invalid. Check the provider, model and key.',
  unavailable: 'AI is not configured on this deployment. Local planning remains available.',
  auth: 'The AI key is invalid or the session expired. Connect again.',
  permission: 'The AI provider denied access to this model.',
  quota: 'The AI provider quota or rate limit was reached. Check your API billing.',
  network: 'Could not reach the AI provider. Check your connection and retry.',
  timeout: 'The AI provider did not respond in time. Retry manually.',
  'invalid-data': 'The AI response is unsupported. No settings were changed.',
  'too-large': 'The AI request or response exceeds the supported size.',
} as const;
export class AiError extends Error {
  constructor(public code: keyof typeof aiErrors) {
    super(aiErrors[code]);
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
function validConnection(value: unknown): value is AiConnection {
  return (
    object(value) &&
    typeof value.baseUrl === 'string' &&
    value.baseUrl.length <= 2048 &&
    typeof value.model === 'string' &&
    value.model.length > 0 &&
    value.model.length <= 128
  );
}
async function request(action: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/ai?action=${action}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AiError('network');
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AiError('invalid-data');
  }
  if (!response.ok) {
    const code = object(data) && object(data.error) ? data.error.code : undefined;
    throw new AiError(
      typeof code === 'string' && Object.hasOwn(aiErrors, code)
        ? (code as keyof typeof aiErrors)
        : 'network',
    );
  }
  return data;
}
export async function getAiSession(signal: AbortSignal): Promise<AiSession> {
  const data = await request('session', signal);
  if (
    !object(data) ||
    typeof data.available !== 'boolean' ||
    typeof data.connected !== 'boolean' ||
    !Array.isArray(data.providers) ||
    data.providers.length > 32 ||
    !data.providers.every((url) => typeof url === 'string' && url.length <= 2048) ||
    (data.connected && !validConnection(data.connection))
  )
    throw new AiError('invalid-data');
  return {
    available: data.available,
    connected: data.connected,
    providers: data.providers,
    ...(validConnection(data.connection) ? { connection: data.connection } : {}),
  };
}
export async function connectAi(
  connection: AiConnection & { apiKey: string },
  signal: AbortSignal,
) {
  await request('connect', signal, connection);
}
export async function disconnectAi(signal: AbortSignal) {
  await request('logout', signal, {});
}
export async function proposeAi(
  prompt: string,
  context: AiContext,
  signal: AbortSignal,
): Promise<AiProposal> {
  const data = await request('propose', signal, { prompt, context });
  if (!validAiProposal(data, context.activity)) throw new AiError('invalid-data');
  return data;
}
