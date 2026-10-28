import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HeaderMenu } from './HeaderMenu';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, THEME_STORAGE_KEY } from '../theme';
import { useRef, useState } from 'react';
import { Dialog } from './Dialog';

afterEach(cleanup);

function setup() {
  const actions = { onNewRoute: vi.fn(), onLibrary: vi.fn(), onHelp: vi.fn() };
  render(
    <ThemeProvider>
      <HeaderMenu {...actions} />
    </ThemeProvider>,
  );
  return {
    user: userEvent.setup(),
    actions,
    trigger: screen.getByRole('button', { name: 'Menu' }),
  };
}

it('groups the direct route action and menu trigger, and focuses the first menu action', async () => {
  const { user, trigger } = setup();
  expect(screen.getAllByRole('button')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'New route' })).toBeInTheDocument();
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  await user.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menu')).toHaveAttribute('id', trigger.getAttribute('aria-controls'));
  expect(screen.getByRole('menuitem', { name: 'My routes' })).toHaveFocus();
  expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

it('supports arrows, wrapping, Home/End, type-ahead and Escape with focus restoration', async () => {
  const { user, trigger } = setup();
  trigger.focus();
  await user.keyboard('{ArrowUp}');
  const first = screen.getByRole('menuitem', { name: 'My routes' });
  const last = screen.getByRole('menuitem', { name: 'Help and data sources' });
  await waitFor(() => expect(last).toHaveFocus());
  await user.keyboard('{ArrowDown}');
  await waitFor(() => expect(first).toHaveFocus());
  await user.keyboard('{ArrowUp}');
  expect(last).toHaveFocus();
  await user.keyboard('{Home}');
  expect(first).toHaveFocus();
  await user.keyboard('{End}');
  expect(last).toHaveFocus();
  await user.keyboard('m');
  expect(screen.getByRole('menuitem', { name: 'My routes' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('closes on Tab or an outside pointer and allows toggling the trigger', async () => {
  const { user, trigger } = setup();
  trigger.focus();
  await user.keyboard('{ArrowDown}');
  await user.keyboard('{Tab}');
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  await user.click(trigger);
  fireEvent.pointerDown(document.body);
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  await user.click(trigger);
  await user.click(trigger);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it.each([
  ['My routes', 'onLibrary'],
  ['Help and data sources', 'onHelp'],
] as const)('closes and restores focus before performing %s', async (label, action) => {
  const { user, trigger, actions } = setup();
  actions[action].mockImplementation(() => expect(trigger).toHaveFocus());
  await user.click(trigger);
  await user.click(screen.getByRole('menuitem', { name: label }));
  expect(actions[action]).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('keeps new route a direct action and closes an open menu without invoking another action', async () => {
  const { user, trigger, actions } = setup();
  await user.click(trigger);
  const primary = screen.getByRole('button', { name: 'New route' });
  await user.click(primary);
  expect(primary).toHaveFocus();
  expect(actions.onNewRoute).toHaveBeenCalledTimes(1);
  expect(actions.onLibrary).not.toHaveBeenCalled();
  expect(actions.onHelp).not.toHaveBeenCalled();
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('switches language and shows the selected language after reopening', async () => {
  const { user, trigger } = setup();
  await user.click(trigger);
  await user.click(screen.getByRole('menuitemradio', { name: 'Русский' }));
  expect(document.documentElement.lang).toBe('ru');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Меню' }));
  expect(screen.getByRole('menuitemradio', { name: 'Русский' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(screen.getByRole('menuitem', { name: 'Мои маршруты' })).toBeInTheDocument();
});

it('offers accessible light, dark and system choices, applying and persisting selection', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  try {
    const { user, trigger } = setup();
    await user.click(trigger);
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(values.get(THEME_STORAGE_KEY)).toBe('dark');
    await user.click(trigger);
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    expect(document.documentElement).not.toHaveClass('dark');
    await user.click(trigger);
    await user.click(screen.getByRole('menuitemradio', { name: 'System' }));
    expect(values.get(THEME_STORAGE_KEY)).toBe('system');
    expect(trigger).toHaveFocus();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('does not steal focus from a dialog opened by a menu action and restores its trigger on close', async () => {
  function Navigation() {
    const [open, setOpen] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    return (
      <>
        <HeaderMenu
          onNewRoute={() => setOpen(true)}
          onLibrary={() => setOpen(true)}
          onHelp={() => setOpen(true)}
        />
        {open && (
          <Dialog title="Routes" onClose={() => setOpen(false)} initialFocusRef={input}>
            <input ref={input} aria-label="Route name" />
          </Dialog>
        )}
      </>
    );
  }
  render(<Navigation />);
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: 'Menu' });
  await user.click(trigger);
  await user.click(screen.getByRole('menuitem', { name: 'My routes' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Route name' })).toHaveFocus());
  await user.keyboard('{Escape}');
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
