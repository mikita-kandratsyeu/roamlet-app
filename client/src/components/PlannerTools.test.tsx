import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlannerTools } from './PlannerTools';
import i18n from '../i18n';
it('localizes the personal-time heading and concise validation message in Russian', async () => {
  await act(async () => {
    await i18n.changeLanguage('ru');
  });
  render(<PlannerTools speed={18} stops={0} onSpeed={vi.fn()} onStops={vi.fn()} />);
  expect(screen.getByText('Оценка времени')).toBeInTheDocument();
  const speed = screen.getByLabelText('Личная скорость (км/ч)');
  fireEvent.focus(speed);
  fireEvent.change(speed, { target: { value: '0' } });
  fireEvent.blur(speed);
  expect(screen.getByRole('alert')).toHaveTextContent('Укажите скорость больше 0.');
});
afterEach(cleanup);
function controlledTools() {
  const onSpeed = vi.fn(),
    onStops = vi.fn();
  function Controlled() {
    const [speed, setSpeed] = useState(18),
      [stops, setStops] = useState(5);
    return (
      <PlannerTools
        speed={speed}
        stops={stops}
        onSpeed={(value) => {
          onSpeed(value);
          setSpeed(value);
        }}
        onStops={(value) => {
          onStops(value);
          setStops(value);
        }}
      />
    );
  }
  const view = render(<Controlled />);
  return {
    ...view,
    onSpeed,
    onStops,
    speed: screen.getByLabelText('Personal speed (km/h)'),
    stops: screen.getByLabelText('Stops (minutes)'),
  };
}
it('groups accessible text controls without duplicate history buttons', () => {
  const { container, speed, stops } = controlledTools();
  expect(container.querySelector('.personal-time-section')).toHaveAttribute('open');
  expect(container.querySelectorAll('.personal-time-field')).toHaveLength(4);
  expect(screen.getByRole('button', { name: 'Fitness level' })).toHaveTextContent('Regular');
  expect(screen.getByRole('button', { name: 'Surface' })).toHaveTextContent('Unknown');
  expect(container.querySelectorAll('.personal-time-row')).toHaveLength(2);
  expect(container.querySelectorAll('.personal-time-error')).toHaveLength(0);
  expect(speed).toHaveValue('18');
  expect(stops).toHaveValue('5');
  expect(speed).toHaveAttribute('inputmode', 'decimal');
  expect(speed).toHaveAttribute('type', 'text');
  expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Redo' })).not.toBeInTheDocument();
});
it('allows clearing and intermediate decimals, then commits on Enter or blur with decimal comma support', () => {
  const { speed, stops, onSpeed, onStops } = controlledTools();
  fireEvent.focus(speed);
  fireEvent.change(speed, { target: { value: '' } });
  expect(speed).toHaveValue('');
  expect(onSpeed).not.toHaveBeenCalled();
  fireEvent.change(speed, { target: { value: '12.' } });
  expect(speed).toHaveValue('12.');
  expect(onSpeed).not.toHaveBeenCalled();
  fireEvent.change(speed, { target: { value: '12,5' } });
  fireEvent.keyDown(speed, { key: 'Enter' });
  expect(onSpeed).toHaveBeenCalledWith(12.5);
  expect(speed).toHaveValue('12.5');
  fireEvent.blur(speed);
  expect(onSpeed).toHaveBeenCalledTimes(1);
  fireEvent.focus(stops);
  fireEvent.change(stops, { target: { value: '' } });
  expect(stops).toHaveValue('');
  expect(onStops).not.toHaveBeenCalled();
  fireEvent.change(stops, { target: { value: '2,5' } });
  fireEvent.blur(stops);
  expect(onStops).toHaveBeenCalledWith(2.5);
  expect(stops).toHaveValue('2.5');
});
it('rejects empty, zero, negative and nonfinite speeds only on commit and clears compact errors while correcting', () => {
  const { speed, onSpeed } = controlledTools();
  for (const value of ['', '0', '-1', 'NaN', 'Infinity', '-Infinity', '1,2.3']) {
    fireEvent.focus(speed);
    fireEvent.change(speed, { target: { value } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.keyDown(speed, { key: 'Enter' });
    expect(speed).toHaveAttribute('aria-invalid', 'true');
    expect(speed).toHaveAttribute('aria-describedby', 'personal-speed-error');
    expect(screen.getByRole('alert')).toHaveClass(
      'personal-time-error',
      'text-xs',
      'leading-[18px]',
    );
    expect(speed.closest('.personal-time-row')).toHaveAttribute('data-errors', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a speed greater than 0.');
    expect(speed).toHaveValue(value);
  }
  expect(onSpeed).not.toHaveBeenCalled();
  fireEvent.change(speed, { target: { value: '6' } });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.blur(speed);
  expect(onSpeed).toHaveBeenCalledWith(6);
  expect(speed).not.toHaveAttribute('aria-invalid', 'true');
  expect(speed).toHaveClass('aria-invalid:border-destructive');
  expect(document.getElementById('personal-speed-error')).toBeNull();
  expect(speed.closest('.personal-time-row')).not.toHaveAttribute('data-errors');
});
it('rejects empty, negative and nonfinite stops while accepting zero minutes', () => {
  const { stops, onStops } = controlledTools();
  for (const value of ['', '-1', 'NaN', 'Infinity', '-Infinity']) {
    fireEvent.focus(stops);
    fireEvent.change(stops, { target: { value } });
    fireEvent.blur(stops);
    expect(stops).toHaveAttribute('aria-invalid', 'true');
    expect(stops).toHaveAttribute('aria-describedby', 'stops-minutes-error');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter 0 or more minutes.');
  }
  expect(onStops).not.toHaveBeenCalled();
  fireEvent.focus(stops);
  fireEvent.change(stops, { target: { value: '0' } });
  fireEvent.keyDown(stops, { key: 'Enter' });
  expect(onStops).toHaveBeenCalledWith(0);
  expect(stops).toHaveValue('0');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('syncs external settings and sessions without overwriting a focused edit', () => {
  const onSpeed = vi.fn(),
    onStops = vi.fn();
  const { rerender } = render(
    <PlannerTools speed={18} stops={0} contextKey="cycling" onSpeed={onSpeed} onStops={onStops} />,
  );
  const speed = screen.getByLabelText('Personal speed (km/h)'),
    stops = screen.getByLabelText('Stops (minutes)');
  fireEvent.focus(speed);
  fireEvent.change(speed, { target: { value: '12,5' } });
  rerender(
    <PlannerTools speed={5} stops={10} contextKey="hiking" onSpeed={onSpeed} onStops={onStops} />,
  );
  expect(speed).toHaveValue('12,5');
  expect(stops).toHaveValue('10');
  fireEvent.blur(speed);
  expect(onSpeed).toHaveBeenCalledWith(12.5);
  fireEvent.focus(speed);
  fireEvent.change(speed, { target: { value: '' } });
  fireEvent.blur(speed);
  expect(speed).toHaveAttribute('aria-invalid', 'true');
  rerender(
    <PlannerTools speed={5} stops={10} contextKey="restored" onSpeed={onSpeed} onStops={onStops} />,
  );
  expect(speed).toHaveValue('5');
  expect(speed).not.toHaveAttribute('aria-invalid', 'true');
});
it('does not write a stale focused value over an external reset when it was not edited', () => {
  const onSpeed = vi.fn();
  const { rerender } = render(
    <PlannerTools speed={18} stops={0} contextKey="before" onSpeed={onSpeed} onStops={vi.fn()} />,
  );
  const speed = screen.getByLabelText('Personal speed (km/h)');
  fireEvent.focus(speed);
  rerender(
    <PlannerTools speed={5} stops={0} contextKey="reset" onSpeed={onSpeed} onStops={vi.fn()} />,
  );
  expect(speed).toHaveValue('18');
  fireEvent.blur(speed);
  expect(speed).toHaveValue('5');
  expect(onSpeed).not.toHaveBeenCalled();
});

it('edits hiking min/km as a string buffer and commits converted km/h with comma decimals', () => {
  const onSpeed = vi.fn();
  render(
    <PlannerTools activity="hiking" speed={5} stops={0} onSpeed={onSpeed} onStops={vi.fn()} />,
  );
  const pace = screen.getByLabelText('Walking pace (min/km)');
  expect(pace).toHaveValue('12');
  fireEvent.focus(pace);
  fireEvent.change(pace, { target: { value: '' } });
  expect(onSpeed).not.toHaveBeenCalled();
  fireEvent.change(pace, { target: { value: '12,5' } });
  fireEvent.keyDown(pace, { key: 'Enter' });
  expect(onSpeed).toHaveBeenCalledWith(4.8);
  fireEvent.blur(pace);
  expect(onSpeed).toHaveBeenCalledTimes(1);
  fireEvent.change(pace, { target: { value: '0' } });
  fireEvent.blur(pace);
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a pace greater than 0.');
  expect(onSpeed).toHaveBeenCalledTimes(1);
});
it('offers explicit accessible fitness and surface choices without committing numeric buffers', async () => {
  const onFitness = vi.fn(),
    onSurface = vi.fn(),
    onSpeed = vi.fn();
  render(
    <PlannerTools
      speed={18}
      stops={0}
      onSpeed={onSpeed}
      onStops={vi.fn()}
      onFitness={onFitness}
      onSurface={onSurface}
    />,
  );
  fireEvent.keyDown(screen.getByRole('button', { name: 'Fitness level' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Trained' }));
  expect(onFitness).toHaveBeenCalledWith('trained');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Surface' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Rough surface' }));
  expect(onSurface).toHaveBeenCalledWith('rough');
  expect(onSpeed).not.toHaveBeenCalled();
});
it('localizes hiking pace and explicit choices in Russian', async () => {
  await act(async () => {
    await i18n.changeLanguage('ru');
  });
  render(
    <PlannerTools activity="hiking" speed={5} stops={0} onSpeed={vi.fn()} onStops={vi.fn()} />,
  );
  expect(screen.getByLabelText('Темп ходьбы (мин/км)')).toHaveValue('12');
  expect(screen.getByRole('button', { name: 'Подготовка' })).toHaveTextContent('Обычная');
  expect(screen.getByRole('button', { name: 'Покрытие' })).toHaveTextContent('Неизвестно');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Покрытие' }), { key: 'Enter' });
  expect(
    await screen.findByRole('menuitemradio', { name: 'Неизвестное покрытие' }),
  ).toBeInTheDocument();
});
