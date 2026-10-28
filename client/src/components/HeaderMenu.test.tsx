import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HeaderMenu } from './HeaderMenu';

afterEach(cleanup);

function setup() {
  const actions = { onNewRoute: vi.fn(), onLibrary: vi.fn(), onHelp: vi.fn() };
  render(<HeaderMenu {...actions} />);
  return { actions, trigger: screen.getByRole('button', { name: 'Menu' }) };
}

it('groups the direct route action and menu trigger, and focuses the first menu action', () => {
  const { trigger } = setup();
  expect(screen.getAllByRole('button')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'New route' })).toBeInTheDocument();
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menu')).toHaveAttribute('id', trigger.getAttribute('aria-controls'));
  expect(screen.getByRole('menuitem', { name: 'My routes' })).toHaveFocus();
  expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
});

it('supports arrows, wrapping, Home/End, type-ahead and Escape with focus restoration', () => {
  const { trigger } = setup();
  fireEvent.keyDown(trigger, { key: 'ArrowUp' });
  const menu = screen.getByRole('menu');
  const first = screen.getByRole('menuitem', { name: 'My routes' });
  const last = screen.getByRole('menuitem', { name: 'Help and data sources' });
  expect(last).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'ArrowUp' });
  expect(last).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'Home' });
  expect(first).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'End' });
  expect(last).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'm' });
  expect(screen.getByRole('menuitem', { name: 'My routes' })).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('closes on Tab or an outside pointer and allows toggling the trigger', () => {
  const { trigger } = setup();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  fireEvent.click(trigger);
  fireEvent.click(trigger);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it.each([
  ['My routes', 'onLibrary'],
  ['Help and data sources', 'onHelp'],
] as const)('closes and restores focus before performing %s', (label, action) => {
  const { trigger, actions } = setup();
  actions[action].mockImplementation(() => expect(trigger).toHaveFocus());
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
  expect(actions[action]).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('switches language and shows the selected language after reopening', () => {
  const { trigger } = setup();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Русский' }));
  expect(document.documentElement.lang).toBe('ru');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Меню' }));
  expect(screen.getByRole('menuitemradio', { name: 'Русский' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('menuitem', { name: 'Мои маршруты' })).toBeInTheDocument();
});
