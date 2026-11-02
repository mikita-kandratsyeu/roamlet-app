import { afterEach, expect, it, vi } from 'vitest';
import { getAiSession, proposeAi, AiError } from './ai';
import { DEFAULT_ROUTING_OPTIONS } from '../domain/routingOptions';
afterEach(() => vi.unstubAllGlobals());
it('sends only explicit prompt and supported context to same-origin API', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ routingOptions: { avoidSteps: true }, explanation: 'Avoid steps' }),
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal;
  await proposeAi(
    'Avoid steps',
    { activity: 'cycling', routingOptions: DEFAULT_ROUTING_OPTIONS },
    signal,
  );
  expect(fetcher).toHaveBeenCalledWith(
    '/api/ai?action=propose',
    expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', signal }),
  );
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    prompt: 'Avoid steps',
    context: { activity: 'cycling', routingOptions: DEFAULT_ROUTING_OPTIONS },
  });
});
it('rejects invalid proposals and session metadata', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ routingOptions: { coordinates: [] }, explanation: 'No' })),
      ),
  );
  await expect(
    proposeAi(
      'Plan',
      { activity: 'hiking', routingOptions: DEFAULT_ROUTING_OPTIONS },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'invalid-data' });
  await expect(getAiSession(new AbortController().signal)).rejects.toMatchObject({
    code: 'invalid-data',
  });
});
it('maps provider errors without exposing raw text and preserves cancellation', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: 'quota', message: 'private upstream text' } }),
          { status: 429 },
        ),
      ),
  );
  await expect(getAiSession(new AbortController().signal)).rejects.toEqual(new AiError('quota'));
  const abort = new AbortController();
  abort.abort();
  const failure = new DOMException('Aborted', 'AbortError');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
  await expect(getAiSession(abort.signal)).rejects.toBe(failure);
});
