import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AiAssistantDialog } from './AiAssistantDialog';
import { AiConnectionDialog } from './AiConnectionDialog';
import { useAiConnection } from '../hooks/useAiConnection';
import { initialEditor } from '../domain/editorSnapshot';
import { DEFAULT_ROUTING_OPTIONS } from '../domain/routingOptions';
import { getAiSession, connectAi, proposeAi } from '../services/ai';
import type { AiProposal } from '../domain/ai';
import { Toaster } from './ui/sonner';
import i18n from '../i18n';
vi.mock('../services/ai', async (original) => ({
  ...(await original<typeof import('../services/ai')>()),
  getAiSession: vi.fn(),
  connectAi: vi.fn(),
  disconnectAi: vi.fn(),
  proposeAi: vi.fn(),
}));
const session = {
  available: true,
  connected: true,
  providers: ['https://ai.example/v1'],
  connection: { baseUrl: 'https://ai.example/v1', model: 'example' },
};
const snapshot = { ...initialEditor(), routingOptions: DEFAULT_ROUTING_OPTIONS };
const proposal = {
  routingOptions: { avoidSteps: true },
  explanation: 'Prefer routes without steps.',
};
beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.mocked(getAiSession).mockReset().mockResolvedValue(session);
  vi.mocked(connectAi).mockReset().mockResolvedValue(undefined);
  vi.mocked(proposeAi).mockReset().mockResolvedValue(proposal);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function setup(extra = {}) {
  const props = {
    snapshot,
    canApply: true,
    applying: false,
    onApply: vi.fn().mockResolvedValue(true),
    onCancelApply: vi.fn(),
    onClose: vi.fn(),
    ...extra,
  };
  const rendered = render(
    <>
      <Toaster />
      <AiAssistantDialog {...props} />
    </>,
  );
  return { ...rendered, props };
}
async function requestSuggestion(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to change?' }),
    'Avoid steps',
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Get suggestion (uses API quota)' })).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: 'Get suggestion (uses API quota)' }));
}
it('discloses transmitted data and cost, previews changes and only applies explicitly', async () => {
  const user = userEvent.setup();
  const { props } = setup();
  expect(
    screen.getByText(/Coordinates, route geometry, names and the library are not included/),
  ).toBeInTheDocument();
  expect(proposeAi).not.toHaveBeenCalled();
  await requestSuggestion(user);
  expect(await screen.findByRole('heading', { name: 'Suggested changes' })).toHaveFocus();
  expect(props.onApply).not.toHaveBeenCalled();
  expect(proposeAi).toHaveBeenCalledWith(
    'Avoid steps',
    { activity: 'cycling', routingOptions: DEFAULT_ROUTING_OPTIONS },
    expect.any(AbortSignal),
  );
  await user.click(screen.getByRole('button', { name: 'Apply and recalculate' }));
  await waitFor(() => expect(props.onApply).toHaveBeenCalledWith(proposal));
  expect(props.onClose).toHaveBeenCalled();
});
it('disables stale suggestions after route changes and supports empty proposals', async () => {
  const user = userEvent.setup();
  const { props, rerender } = setup();
  await requestSuggestion(user);
  await screen.findByRole('heading', { name: 'Suggested changes' });
  rerender(
    <>
      <Toaster />
      <AiAssistantDialog {...props} snapshot={{ ...snapshot, name: 'Changed locally' }} />
    </>,
  );
  expect(screen.getByRole('button', { name: 'Apply and recalculate' })).toBeDisabled();
  expect(
    screen.getByText('The route or connection changed. Get a new suggestion before applying.'),
  ).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Refine request' }));
  vi.mocked(proposeAi).mockResolvedValue({
    routingOptions: {},
    explanation: 'Cannot guarantee a duration.',
  });
  await user.click(screen.getByRole('button', { name: 'Get suggestion (uses API quota)' }));
  expect(
    await screen.findByText(
      'No supported setting changes were suggested. Nothing will be applied.',
    ),
  ).toBeInTheDocument();
  expect(props.onApply).not.toHaveBeenCalled();
});
it('cancels pending requests and ignores late responses', async () => {
  let resolve!: (value: AiProposal) => void;
  vi.mocked(proposeAi).mockReturnValue(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const user = userEvent.setup();
  const { props } = setup();
  await requestSuggestion(user);
  const signal = vi.mocked(proposeAi).mock.calls[0][2];
  await user.click(screen.getByRole('button', { name: 'Stop request' }));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(proposal));
  expect(screen.queryByRole('heading', { name: 'Suggested changes' })).not.toBeInTheDocument();
  expect(props.onApply).not.toHaveBeenCalled();
});
it('keeps the dialog open on failed recalculation and shows the original-preserved error', async () => {
  const user = userEvent.setup();
  const onApply = vi.fn().mockRejectedValue(new Error('Raw provider failure'));
  const { props } = setup({ onApply });
  await requestSuggestion(user);
  await screen.findByRole('heading', { name: 'Suggested changes' });
  await user.click(screen.getByRole('button', { name: 'Apply and recalculate' }));
  expect(
    await screen.findByText('Recalculation failed. The original route and settings were kept.'),
  ).toBeInTheDocument();
  expect(props.onClose).not.toHaveBeenCalled();
});
it('connects using explicit model and hidden key, clears it after success and supports Russian', async () => {
  vi.mocked(getAiSession).mockResolvedValue({
    ...session,
    connected: false,
    connection: undefined,
  });
  function Connection() {
    const ai = useAiConnection(true);
    return <AiConnectionDialog ai={ai} onClose={vi.fn()} />;
  }
  const user = userEvent.setup();
  render(<Connection />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'AI provider' })).toBeEnabled());
  await user.type(screen.getByRole('textbox', { name: 'Model ID' }), 'example');
  const key = screen.getByLabelText('API key');
  expect(key).toHaveAttribute('type', 'password');
  await user.type(key, 'synthetic-key');
  vi.mocked(getAiSession).mockResolvedValue(session);
  await user.click(screen.getByRole('button', { name: 'Verify and connect (uses API quota)' }));
  await screen.findByRole('button', { name: 'Change AI connection' });
  expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();
  expect(connectAi).toHaveBeenCalledWith(
    { baseUrl: 'https://ai.example/v1', model: 'example', apiKey: 'synthetic-key' },
    expect.any(AbortSignal),
  );
  await act(async () => i18n.changeLanguage('ru'));
  expect(screen.getByRole('dialog', { name: 'Настройки ИИ-подключения' })).toBeInTheDocument();
});
