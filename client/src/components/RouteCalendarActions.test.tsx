import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { RouteCalendarActions, type RouteCalendarInput } from './RouteCalendarActions';
import {
  getGoogleCalendarSession,
  publishCalendarEvent,
  logoutGoogleCalendar,
} from '../services/connectors/googleCalendar';
import { CALENDAR_CONNECTION_KEY } from '../hooks/useGoogleCalendarSession';
import { ConnectorError } from '../services/connectors/types';
import { Toaster } from './ui/sonner';
import i18n from '../i18n';
import { toast } from 'sonner';
vi.mock('../services/connectors/googleCalendar', async (original) => ({
  ...(await original<typeof import('../services/connectors/googleCalendar')>()),
  getGoogleCalendarSession: vi.fn(),
  publishCalendarEvent: vi.fn(),
  logoutGoogleCalendar: vi.fn(),
}));
const input: RouteCalendarInput = {
  routeId: 'route-one',
  name: 'Weekend ride',
  description: 'A local ride',
  canPublish: true,
  online: true,
};
const connected = () => ({
  available: true,
  connected: true,
  email: 'user@example.test',
  accountId: 'user-one',
  expiresAt: Date.now() + 3600000,
});
function view(overrides: Partial<RouteCalendarInput> = {}) {
  return (
    <>
      <Toaster />
      <RouteCalendarActions
        input={{ ...input, ...overrides }}
        departureLocal="2026-11-07T10:00"
        durationSeconds={7200}
        location="Park"
      />
    </>
  );
}
beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.mocked(getGoogleCalendarSession)
    .mockReset()
    .mockResolvedValue({ available: true, connected: false });
  vi.mocked(logoutGoogleCalendar).mockReset().mockResolvedValue(undefined);
  vi.mocked(publishCalendarEvent)
    .mockReset()
    .mockImplementation(async (event) => ({
      eventId: event.eventId,
      htmlLink: 'https://www.google.com/calendar/event?eid=example',
    }));
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function preview() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add to calendar' }));
  await user.click(screen.getByRole('button', { name: 'Start time zone (IANA)' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Europe/Warsaw' }));
  return user;
}
it('keeps ICS available without a connector and previews without transmitting data', async () => {
  render(view());
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'Add to calendar' })).toBeInTheDocument();
  const user = await preview();
  const times = screen.getByRole('region', { name: 'Event preview' }).querySelectorAll('time');
  expect(times[0]).toHaveAttribute('datetime', '2026-11-07T10:00:00+01:00');
  expect(times[1]).toHaveAttribute('datetime', '2026-11-07T12:00:00+01:00');
  expect(times[0]).toHaveTextContent('Nov 7, 2026');
  expect(times[0]).toHaveTextContent('10:00');
  expect(screen.getByText('Europe/Warsaw · UTC+01:00')).toBeVisible();
  expect(screen.queryByText('2026-11-07T10:00:00+01:00')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm event creation' })).not.toBeInTheDocument();
  const objectUrl = vi.fn().mockReturnValue('blob:calendar');
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = objectUrl;
      static revokeObjectURL = vi.fn();
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await user.click(screen.getByRole('button', { name: 'Download .ics' }));
  expect(objectUrl).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
  expect(publishCalendarEvent).not.toHaveBeenCalled();
});
it('does not show publication guidance when Google Calendar is not configured', async () => {
  vi.mocked(getGoogleCalendarSession).mockResolvedValue({
    available: false,
    connected: false,
  });
  render(view({ canPublish: false }));
  await act(async () => {});
  await preview();
  expect(
    screen.queryByText(
      'Save the current route and its schedule before publishing to Google Calendar.',
    ),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      'Google Calendar is not configured. Local planning and ICS export remain available.',
    ),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download .ics' })).toBeEnabled();
  expect(publishCalendarEvent).not.toHaveBeenCalled();
});
it('does not notify about unavailable Google Calendar when a stale connection is remembered', async () => {
  localStorage.setItem(CALENDAR_CONNECTION_KEY, '1');
  vi.mocked(getGoogleCalendarSession).mockRejectedValueOnce(new ConnectorError('unavailable'));
  render(view({ canPublish: false }));
  await act(async () => {});
  await preview();
  expect(
    screen.queryByText(
      'Google Calendar is not configured. Local planning and ICS export remain available.',
    ),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText('Could not reach Google Calendar. Check your connection, then retry.'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      'Save the current route and its schedule before publishing to Google Calendar.',
    ),
  ).not.toBeInTheDocument();
});
it('does not show an unavailable notification when publication confirms the connector is not configured', async () => {
  vi.mocked(getGoogleCalendarSession).mockResolvedValue(connected());
  vi.mocked(publishCalendarEvent).mockRejectedValueOnce(new ConnectorError('unavailable'));
  render(view());
  await screen.findByRole('button', { name: 'Add to calendar' });
  const user = await preview();
  await user.click(screen.getByRole('button', { name: 'Confirm event creation' }));
  await waitFor(() => expect(publishCalendarEvent).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Confirm event creation' }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByText(
      'Google Calendar is not configured. Local planning and ICS export remain available.',
    ),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText('Could not reach Google Calendar. Check your connection, then retry.'),
  ).not.toBeInTheDocument();
});
it.each([
  [
    'en',
    'Event preview',
    'Event settings',
    'Start time zone (IANA)',
    'Timing and privacy',
    'Download .ics',
  ],
  [
    'ru',
    'Предпросмотр события',
    'Настройки события',
    'Часовой пояс старта (IANA)',
    'Расчёт времени и приватность',
    'Скачать .ics',
  ],
])(
  'shows a localized event card, focused settings and collapsed guidance (%s)',
  async (language, previewLabel, settingsLabel, zoneLabel, guidanceLabel, downloadLabel) => {
    await i18n.changeLanguage(language);
    render(view());
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', {
        name: language === 'ru' ? 'Добавить в календарь' : 'Add to calendar',
      }),
    );
    const zone = screen.getByRole('button', { name: zoneLabel });
    expect(zone).toHaveFocus();
    await user.click(zone);
    const warsaw = screen.getByRole('menuitemradio', { name: 'Europe/Warsaw' });
    expect(warsaw).toHaveAttribute('aria-checked', 'false');
    await user.click(warsaw);
    expect(zone).toHaveTextContent('Europe/Warsaw');
    const preview = screen.getByRole('region', { name: previewLabel });
    expect(within(preview).getByRole('heading', { name: input.name })).toBeVisible();
    expect(preview.querySelector('time')).toHaveTextContent(language === 'ru' ? 'нояб.' : 'Nov');
    expect(screen.getByRole('region', { name: settingsLabel })).toContainElement(zone);
    const disclosure = screen.getByText(guidanceLabel).closest('details');
    expect(disclosure).not.toHaveAttribute('open');
    expect(disclosure?.querySelector('.calendar-event-disclosure-body')).not.toBeVisible();
    expect(screen.getByRole('button', { name: downloadLabel })).toHaveAttribute(
      'data-variant',
      'default',
    );
    expect(
      screen.getByText(
        language === 'ru'
          ? 'Только файл календаря. В Google ничего не отправляется.'
          : 'Calendar file only. Nothing is sent to Google.',
      ),
    ).toBeVisible();
    await user.click(screen.getByText(guidanceLabel));
    expect(disclosure).toHaveAttribute('open');
    expect(disclosure?.querySelector('.calendar-event-disclosure-body p')).toBeVisible();
    expect(publishCalendarEvent).not.toHaveBeenCalled();
  },
);

it('publishes only after confirmation and manually updates the same persisted event', async () => {
  vi.mocked(getGoogleCalendarSession).mockResolvedValue(connected());
  const { rerender } = render(view());
  await screen.findByRole('button', { name: 'Add to calendar' });
  const user = await preview();
  expect(publishCalendarEvent).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirm event creation' }));
  const openEvent = await screen.findByRole('link', { name: 'Open calendar event' });
  expect(openEvent).toHaveAttribute('href', 'https://www.google.com/calendar/event?eid=example');
  expect(openEvent).toHaveAttribute('target', '_blank');
  expect(openEvent).toHaveAttribute('rel', 'noopener noreferrer');
  const sent = vi.mocked(publishCalendarEvent).mock.calls[0][0];
  expect(sent).toMatchObject({
    summary: input.name,
    description: input.description,
    location: 'Park',
    reminderMinutes: 30,
  });
  const warningToast = vi.spyOn(toast, 'warning').mockImplementation(() => 'calendar-change');
  const dismissToast = vi.spyOn(toast, 'dismiss');
  rerender(view({ description: 'Updated ride' }));
  await waitFor(() =>
    expect(warningToast).toHaveBeenCalledWith(
      'Route or event settings changed. Update the calendar event manually.',
      expect.objectContaining({
        duration: Infinity,
        dismissible: true,
        closeButton: true,
      }),
    ),
  );
  const warningId = warningToast.mock.calls[0][1]?.id;
  expect(warningId).toBeTruthy();
  expect(
    screen.queryByText('Route or event settings changed. Update the calendar event manually.'),
  ).not.toBeInTheDocument();
  expect(publishCalendarEvent).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: 'Add to calendar' }));
  await user.click(screen.getByRole('button', { name: 'Confirm event update' }));
  await waitFor(() => expect(publishCalendarEvent).toHaveBeenCalledTimes(2));
  expect(vi.mocked(publishCalendarEvent).mock.calls[1][0].eventId).toBe(sent.eventId);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(dismissToast).toHaveBeenCalledWith(warningId);
});
it('blocks unsaved and offline publication but not ICS export', async () => {
  vi.mocked(getGoogleCalendarSession).mockResolvedValue(connected());
  render(view({ canPublish: false, online: false }));
  await screen.findByRole('button', { name: 'Add to calendar' });
  await preview();
  expect(screen.getByRole('button', { name: 'Confirm event creation' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Download .ics' })).toBeEnabled();
  expect(
    screen.getByText(
      'Save the current route and its schedule before publishing to Google Calendar.',
    ),
  ).toBeVisible();
  expect(publishCalendarEvent).not.toHaveBeenCalled();
});
it('retains calendar actions after expiry and offers reconnection', async () => {
  localStorage.setItem(CALENDAR_CONNECTION_KEY, '1');
  render(view());
  await act(async () => {});
  await preview();
  expect(screen.getByRole('button', { name: 'Confirm event creation' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reconnect Google Calendar' })).toBeEnabled();
});
it('keeps popular zones compact and searches the full timezone list', async () => {
  vi.mocked(getGoogleCalendarSession).mockResolvedValue(connected());
  render(view());
  await screen.findByRole('button', { name: 'Add to calendar' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add to calendar' }));
  const zone = screen.getByRole('button', { name: 'Start time zone (IANA)' });
  await user.click(zone);
  expect(screen.getByRole('menuitemradio', { name: 'Europe/Warsaw' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitemradio', { name: 'America/Chicago' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('menuitem', { name: 'Search all time zones' }));
  const search = screen.getByRole('searchbox', { name: 'Search all time zones' });
  await user.type(search, 'America/Chicago');
  await user.click(screen.getByRole('menuitemradio', { name: 'America/Chicago' }));
  expect(zone).toHaveTextContent('America/Chicago');

  await user.click(zone);
  expect(screen.getByRole('menuitemradio', { name: 'America/Chicago' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await user.click(screen.getByRole('menuitemradio', { name: 'UTC' }));
  expect(zone).toHaveTextContent('UTC');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm event creation' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Download .ics' })).toBeEnabled();
});
it('uses the same event ID after an uncertain network failure and reload', async () => {
  vi.mocked(getGoogleCalendarSession).mockResolvedValue(connected());
  vi.mocked(publishCalendarEvent).mockRejectedValueOnce(new ConnectorError('network'));
  const first = render(view());
  await screen.findByRole('button', { name: 'Add to calendar' });
  let user = await preview();
  await user.click(screen.getByRole('button', { name: 'Confirm event creation' }));
  await screen.findByText('Could not reach Google Calendar. Check your connection, then retry.');
  const sentId = vi.mocked(publishCalendarEvent).mock.calls[0][0].eventId;
  first.unmount();
  render(view());
  await screen.findByRole('button', { name: 'Add to calendar' });
  user = await preview();
  await user.click(screen.getByRole('button', { name: 'Confirm event creation' }));
  await screen.findByRole('link', { name: 'Open calendar event' });
  expect(vi.mocked(publishCalendarEvent).mock.calls[1][0].eventId).toBe(sentId);
});
it('confirms cancellation, aborts transport and ignores a late success', async () => {
  vi.mocked(getGoogleCalendarSession).mockResolvedValue(connected());
  let finish!: (value: { eventId: string; htmlLink: string }) => void;
  vi.mocked(publishCalendarEvent).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(view());
  await screen.findByRole('button', { name: 'Add to calendar' });
  const user = await preview();
  await user.click(screen.getByRole('button', { name: 'Confirm event creation' }));
  await user.click(screen.getByRole('button', { name: 'Close dialog' }));
  await screen.findByRole('dialog', { name: 'Stop calendar publication?' });
  await user.click(screen.getByRole('button', { name: 'Stop and close' }));
  expect(vi.mocked(publishCalendarEvent).mock.calls[0][1]?.aborted).toBe(true);
  const eventId = vi.mocked(publishCalendarEvent).mock.calls[0][0].eventId;
  await act(async () =>
    finish({ eventId, htmlLink: 'https://www.google.com/calendar/event?eid=example' }),
  );
  expect(screen.queryByRole('link', { name: 'Open calendar event' })).not.toBeInTheDocument();
  expect(
    screen.queryByText('Calendar event saved. Future route changes require a manual update.'),
  ).not.toBeInTheDocument();
});
