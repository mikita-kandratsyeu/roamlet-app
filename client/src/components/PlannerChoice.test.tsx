import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlannerChoice } from './PlannerChoice';
import i18n from '../i18n';

const options = [
  { value: 'automatic', label: 'Road/path routing' },
  { value: 'direct', label: 'Direct line — unverified' },
] as const;
afterEach(cleanup);

it('uses the shared accessible menu and returns only listed choices', () => {
  const change = vi.fn();
  render(
    <PlannerChoice label="Section mode" value="automatic" options={options} onChange={change} />,
  );
  fireEvent.keyDown(screen.getByRole('button', { name: 'Section mode' }), { key: 'ArrowDown' });
  expect(screen.getByRole('menu')).toHaveClass('planner-choice-menu');
  expect(screen.getByRole('menuitemradio', { name: 'Road/path routing' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Direct line — unverified' }));
  expect(change).toHaveBeenCalledWith('direct');
});

it('restores focus after Escape without changing the selected value', async () => {
  const change = vi.fn();
  render(
    <PlannerChoice label="Section mode" value="automatic" options={options} onChange={change} />,
  );
  const trigger = screen.getByRole('button', { name: 'Section mode' });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(change).not.toHaveBeenCalled();
});

it('offers a contextual action without changing the selected routing mode', () => {
  const change = vi.fn(), draw = vi.fn();
  render(<PlannerChoice label="Section mode" value="automatic" options={options}
    onChange={change} action={{ label: 'Draw a detour', onSelect: draw }} />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Section mode' }), { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Draw a detour' }));
  expect(draw).toHaveBeenCalledOnce();
  expect(change).not.toHaveBeenCalled();
});

it('keeps disabled choices inert and translates the visible selected value', async () => {
  await i18n.changeLanguage('ru');
  const change = vi.fn();
  render(
    <PlannerChoice
      label="Режим участка"
      value="direct"
      options={options}
      onChange={change}
      disabled
    />,
  );
  const trigger = screen.getByRole('button', { name: 'Режим участка' });
  expect(trigger).toBeDisabled();
  expect(trigger).toHaveTextContent('Прямая линия — без проверки');
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();
});
