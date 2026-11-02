import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAiConnection } from './useAiConnection';
import { connectAi, disconnectAi, getAiSession, AiError, type AiSession } from '../services/ai';
vi.mock('../services/ai', async (original) => ({ ...(await original<typeof import('../services/ai')>()), connectAi: vi.fn(), disconnectAi: vi.fn(), getAiSession: vi.fn() }));
const connected: AiSession = { available: true, connected: true, providers: ['https://ai.example/v1'], connection: { baseUrl: 'https://ai.example/v1', model: 'example' } };
beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.mocked(getAiSession).mockReset().mockResolvedValue(connected);
  vi.mocked(connectAi).mockReset().mockResolvedValue(undefined);
  vi.mocked(disconnectAi).mockReset().mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('does not fetch until opened and never persists keys in localStorage', async () => {
  const save = vi.spyOn(Storage.prototype, 'setItem');
  const { result, rerender } = renderHook(({ active }) => useAiConnection(active), { initialProps: { active: false } });
  expect(getAiSession).not.toHaveBeenCalled();
  rerender({ active: true }); await act(async () => {});
  await act(async () => { await result.current.connect({ baseUrl: 'https://ai.example/v1', model: 'example', apiKey: 'synthetic-key' }); });
  expect(connectAi).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'synthetic-key' }), expect.any(AbortSignal));
  expect(save).not.toHaveBeenCalled(); save.mockRestore();
});
it('ignores stale sessions and aborts on close', async () => {
  let resolve!: (value: AiSession) => void;
  vi.mocked(getAiSession).mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
  const { result, rerender } = renderHook(({ active }) => useAiConnection(active), { initialProps: { active: true } });
  const first = vi.mocked(getAiSession).mock.calls[0][0];
  vi.mocked(getAiSession).mockResolvedValue({ ...connected, connected: false, connection: undefined });
  await act(async () => { await result.current.refresh(); resolve(connected); });
  expect(first.aborted).toBe(true); expect(result.current.session?.connected).toBe(false);
  rerender({ active: false });
  const count = vi.mocked(getAiSession).mock.calls.length;
  window.dispatchEvent(new Event('focus'));
  expect(getAiSession).toHaveBeenCalledTimes(count);
});
it('allows retry after disconnect failure and rechecks same-browser events', async () => {
  const { result } = renderHook(() => useAiConnection(true)); await act(async () => {});
  vi.mocked(disconnectAi).mockRejectedValueOnce(new AiError('network'));
  await act(async () => { expect(await result.current.disconnect()).toBe(false); });
  expect(result.current.session?.connected).toBe(true); expect(result.current.error).toBeTruthy();
  vi.mocked(getAiSession).mockResolvedValue({ ...connected, connected: false, connection: undefined });
  await act(async () => { expect(await result.current.disconnect()).toBe(true); });
  expect(result.current.session?.connected).toBe(false);
  const count = vi.mocked(getAiSession).mock.calls.length;
  await act(async () => window.dispatchEvent(new Event('roamlet-ai-connection-change')));
  expect(getAiSession).toHaveBeenCalledTimes(count + 1);
});
