import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlannerTools } from './PlannerTools';
afterEach(cleanup);
it('groups personal-time controls in an expanded compact section without duplicate history buttons', () => {
  const { container } = render(
    <PlannerTools speed={18} stops={0} onSpeed={vi.fn()} onStops={vi.fn()} />,
  );
  expect(container.querySelector('.personal-time-section')).toHaveAttribute('open');
  expect(container.querySelectorAll('.personal-time-field')).toHaveLength(2);
  expect(screen.getByLabelText('Personal speed (km/h)')).toHaveValue(18);
  expect(screen.getByLabelText('Stops (minutes)')).toHaveValue(0);
  expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Redo' })).not.toBeInTheDocument();
});
it('accepts only positive speed and nonnegative stop duration', () => {
  const onSpeed = vi.fn(),
    onStops = vi.fn();
  render(<PlannerTools speed={18} stops={0} onSpeed={onSpeed} onStops={onStops} />);
  const speed = screen.getByLabelText('Personal speed (km/h)'),
    stops = screen.getByLabelText('Stops (minutes)');
  for (const value of ['0', '-1', '']) fireEvent.change(speed, { target: { value } });
  for (const value of ['-1', '']) fireEvent.change(stops, { target: { value } });
  expect(onSpeed).not.toHaveBeenCalled();
  expect(onStops).not.toHaveBeenCalled();
  fireEvent.change(speed, { target: { value: '12.5' } });
  fireEvent.change(stops, { target: { value: '15' } });
  expect(onSpeed).toHaveBeenCalledWith(12.5);
  expect(onStops).toHaveBeenCalledWith(15);
});
