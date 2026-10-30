import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RouteSchedule, type RouteScheduleProps } from './RouteSchedule';
import i18n from '../i18n';
import type { PlannedRoute } from '../domain/types';
const route: PlannedRoute = {
  id: 'route', name: 'Walk', description: '', activity: 'hiking', source: 'manual',
  segments: [[[0, 0], [0.01, 0]]],
  waypoints: [{ id: 'a', name: 'Start', coordinate: [0, 0], pauseMinutes: 5 },
    { id: 'b', name: 'Finish', coordinate: [0.01, 0], pauseMinutes: 10 }],
  stats: { distance: 1112, duration: 3600 },
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
const props = (): RouteScheduleProps => ({ route, waypoints: route.waypoints,
  departureLocal: '2026-10-29T23:30', movingSeconds: 3600,
  onDepartureLocal: vi.fn(), onWaypointPause: vi.fn() });
beforeEach(async () => { await act(async () => { await i18n.changeLanguage('en'); }); });
afterEach(cleanup);
it('renders all arrival/departure rows with actual dates, next-day markers, and explicit timing semantics', () => {
  render(<RouteSchedule {...props()} />);
  const region = screen.getByRole('region', { name: 'Route schedule' });
  const rows = within(region).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByText('1. Start')).toBeVisible();
  expect(rows[0].querySelectorAll('time')[0]).toHaveAttribute('datetime', '2026-10-29T23:30');
  expect(rows[0].querySelectorAll('time')[1]).toHaveAttribute('datetime', '2026-10-29T23:35');
  expect(rows[1].querySelectorAll('time')[0]).toHaveAttribute('datetime', '2026-10-30T00:35');
  expect(rows[1].querySelectorAll('time')[1]).toHaveAttribute('datetime', '2026-10-30T00:45');
  expect(within(rows[1]).getByText('Day +1')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Route schedule', level: 2 })).toBeVisible();
  expect(screen.getByText(/replace aggregate stops for this schedule only/)).not.toBeVisible();
  expect(screen.getByText(/daylight-saving changes are not applied/)).not.toBeVisible();
  const summary = screen.getByText('How arrival times are estimated');
  const details = summary.closest('details')!;
  expect(details).not.toHaveAttribute('open');
  expect(summary.closest('summary')).toHaveClass('section-heading');
  expect(details).toHaveClass('planner-disclosure');
  expect(details.querySelector('.disclosure-toggle')).toHaveAttribute('aria-hidden', 'true');
  expect(details.querySelector('.disclosure-toggle svg')).toHaveAttribute('width', '18');
  fireEvent.click(summary);
  expect(details).toHaveAttribute('open');
  expect(screen.getByText(/replace aggregate stops for this schedule only/)).toBeVisible();
  expect(screen.getByText(/daylight-saving changes are not applied/)).toBeVisible();
  fireEvent.click(summary);
  expect(details).not.toHaveAttribute('open');
  expect(screen.getByText(/daylight-saving changes are not applied/)).not.toBeVisible();
  expect(screen.getByLabelText('Pause (minutes): Start')).toHaveValue('5');
  expect(screen.getByLabelText('Local departure date and time')).toHaveAttribute('type', 'datetime-local');
});
it('commits valid local departure and pause changes only on blur or Enter and supports clearing departure', () => {
  const callbacks = props();
  function Controlled() {
    const [departureLocal, setDeparture] = useState(callbacks.departureLocal);
    const [waypoints, setWaypoints] = useState(callbacks.waypoints);
    return <RouteSchedule {...callbacks} departureLocal={departureLocal} waypoints={waypoints}
      onDepartureLocal={(value) => { callbacks.onDepartureLocal(value); setDeparture(value); }}
      onWaypointPause={(id, value) => {
        callbacks.onWaypointPause(id, value);
        setWaypoints((points) => points.map((point) => point.id === id ? { ...point, pauseMinutes: value } : point));
      }} />;
  }
  render(<Controlled />);
  const departure = screen.getByLabelText('Local departure date and time');
  fireEvent.change(departure, { target: { value: '2026-12-31T23:30' } });
  expect(callbacks.onDepartureLocal).not.toHaveBeenCalled();
  fireEvent.keyDown(departure, { key: 'Enter' });
  expect(callbacks.onDepartureLocal).toHaveBeenCalledWith('2026-12-31T23:30');
  fireEvent.blur(departure);
  expect(callbacks.onDepartureLocal).toHaveBeenCalledTimes(1);
  const pause = screen.getByLabelText('Pause (minutes): Start');
  fireEvent.focus(pause);
  fireEvent.change(pause, { target: { value: '20' } });
  expect(callbacks.onWaypointPause).not.toHaveBeenCalled();
  fireEvent.keyDown(pause, { key: 'Enter' });
  expect(callbacks.onWaypointPause).toHaveBeenCalledWith('a', 20);
  expect(screen.getAllByRole('listitem')[1].querySelector('time')).toHaveAttribute('datetime', '2027-01-01T00:50');
  fireEvent.change(departure, { target: { value: '' } });
  fireEvent.blur(departure);
  expect(callbacks.onDepartureLocal).toHaveBeenLastCalledWith(undefined);
  expect(screen.getByText('Choose a local departure date and time to see arrivals.')).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Pause (minutes): Start')).toHaveValue('20');
});
it.each(['', '-1', '1.5', 'Infinity', '10081'])('keeps invalid pause %s out of persisted state and shows an accessible error', (value) => {
  const callbacks = props();
  render(<RouteSchedule {...callbacks} />);
  const pause = screen.getByLabelText('Pause (minutes): Start');
  fireEvent.focus(pause);
  fireEvent.change(pause, { target: { value } });
  fireEvent.blur(pause);
  expect(callbacks.onWaypointPause).not.toHaveBeenCalled();
  expect(pause).toHaveAttribute('aria-invalid', 'true');
  const error = screen.getByRole('alert');
  expect(pause).toHaveAttribute('aria-describedby', error.id);
  expect(error).toHaveTextContent('Enter whole pause minutes from 0 to 10080.');
  fireEvent.focus(pause);
  fireEvent.change(pause, { target: { value: '0' } });
  fireEvent.blur(pause);
  expect(callbacks.onWaypointPause).toHaveBeenCalledWith('a', 0);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('rejects invalid calendar dates and native incomplete date input without committing a cleared departure', () => {
  const callbacks = props();
  const { rerender } = render(<RouteSchedule {...callbacks} departureLocal="2026-02-30T12:00" />);
  let departure = screen.getByLabelText('Local departure date and time');
  fireEvent.blur(departure);
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid local date and time.');
  expect(callbacks.onDepartureLocal).not.toHaveBeenCalled();
  rerender(<RouteSchedule {...callbacks} contextKey="new" />);
  departure = screen.getByLabelText('Local departure date and time');
  fireEvent.change(departure, { target: { value: '' } });
  Object.defineProperty(departure, 'validity', { configurable: true, value: { badInput: true } });
  fireEvent.blur(departure);
  expect(departure).toHaveAttribute('aria-invalid', 'true');
  expect(callbacks.onDepartureLocal).not.toHaveBeenCalled();
});
it('discards unfinished input on route switches and follows external undo values', () => {
  const callbacks = props();
  const { rerender } = render(<RouteSchedule {...callbacks} contextKey="one" />);
  fireEvent.focus(screen.getByLabelText('Pause (minutes): Start'));
  fireEvent.change(screen.getByLabelText('Pause (minutes): Start'), { target: { value: '999' } });
  rerender(<RouteSchedule {...callbacks} contextKey="two" departureLocal="2026-10-30T08:00" />);
  expect(screen.getByLabelText('Pause (minutes): Start')).toHaveValue('5');
  expect(screen.getByLabelText('Local departure date and time')).toHaveValue('2026-10-30T08:00');
  rerender(<RouteSchedule {...callbacks} contextKey="two" departureLocal="2026-10-31T08:00"
    waypoints={callbacks.waypoints.map((point) => ({ ...point, pauseMinutes: 0 }))} />);
  expect(screen.getByLabelText('Pause (minutes): Start')).toHaveValue('0');
  expect(screen.getByLabelText('Local departure date and time')).toHaveValue('2026-10-31T08:00');
});
it('does not show stale geometry arrivals, but still lets the user edit timing', () => {
  render(<RouteSchedule {...props()} geometryCurrent={false} />);
  expect(screen.getByText('Usable route geometry is needed for the schedule.')).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getAllByText('Unavailable')).toHaveLength(5);
  expect(screen.getByLabelText('Pause (minutes): Start')).toBeEnabled();
});
it('shows unavailable instead of guessed times for absent pins, off-route pins and disconnected geometry', () => {
  const callbacks = props();
  const { rerender } = render(<RouteSchedule {...callbacks} waypoints={[]} />);
  expect(screen.getByText('At least two ordered waypoints must match the route to show arrivals.')).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  rerender(<RouteSchedule {...callbacks} waypoints={[callbacks.waypoints[0],
    { id: 'wrong', name: 'Wrong', coordinate: [10, 10] }, callbacks.waypoints[1]]} />);
  expect(screen.getByText(i18n.t('This waypoint does not match the route; later arrivals are unavailable.'))).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getAllByRole('listitem')[2].querySelector('time')).toBeNull();
  rerender(<RouteSchedule {...callbacks} route={{ ...route, segments: [[[0, 0], [0.01, 0]], [[1, 0], [1.01, 0]]] }}
    waypoints={[callbacks.waypoints[0], { ...callbacks.waypoints[1], coordinate: [1.01, 0] }]} />);
  expect(screen.getByText(i18n.t('This track has a gap; arrival times across it are unavailable.'))).toBeVisible();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getAllByRole('listitem')[1].querySelector('time')).toBeNull();
});
