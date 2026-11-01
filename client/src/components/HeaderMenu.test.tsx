import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HeaderMenu } from './HeaderMenu';
import { Toaster } from './ui/sonner';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, THEME_STORAGE_KEY } from '../theme';
import { useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { savePreferences, loadPreferences, PREFERENCES_KEY } from '../domain/preferences';

beforeEach(() => {
  render(<Toaster />);
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const actions = { onNewRoute: vi.fn(), onLibrary: vi.fn(), onHelp: vi.fn(), onConnections: vi.fn() };
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
  expect(screen.getByRole('menu')).toHaveAttribute('data-keyboard-navigation', 'false');
  expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

it('shows Figma preference order, selected checks and explanatory notes', async () => {
  const { user, trigger } = setup();
  await user.click(trigger);
  const choices = screen.getAllByRole('menuitemradio');
  expect(choices.map((choice) => choice.getAttribute('aria-label') ?? choice.textContent)).toEqual([
    'Русский',
    'English',
    'Light',
    'Dark',
    'System',
  ]);
  for (const choice of choices) {
    expect(choice.querySelector('.preference-check') !== null).toBe(
      !choice.classList.contains('header-menu-theme-option') &&
        choice.getAttribute('aria-checked') === 'true',
    );
  }
  expect(screen.getByText('LANGUAGE / ЯЗЫК')).toBeInTheDocument();
  expect(
    screen.getByText('System theme follows OS settings. Language and theme are saved locally.'),
  ).toBeInTheDocument();
  expect(
    screen.getByText('Theme and language do not change the route, calculation or map position.'),
  ).toBeInTheDocument();
});

it('uses matching left-aligned icon actions for library, reset and help', async () => {
  const { user, trigger } = setup();
  await user.click(trigger);
  for (const name of ['My routes', 'Reset settings', 'Help and data sources']) {
    const item = screen.getByRole('menuitem', { name });
    expect(item).toHaveClass('header-menu-item');
    expect(item).not.toHaveClass('header-menu-action-item');
    expect(item.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(item.querySelector('span')?.textContent).toBe(name);
  }
});

it('uses labeled icon choices with horizontal keyboard navigation without changing theme on focus', async () => {
  const { user, trigger } = setup();
  await user.click(trigger);
  const light = screen.getByRole('menuitemradio', { name: 'Light' });
  const dark = screen.getByRole('menuitemradio', { name: 'Dark' });
  const system = screen.getByRole('menuitemradio', { name: 'System' });
  for (const choice of [light, dark, system]) {
    expect(choice).toHaveAttribute('title', choice.getAttribute('aria-label'));
    expect(choice).toHaveTextContent('');
    expect(choice).toHaveClass('header-menu-theme-option');
    expect(choice.parentElement).toBe(light.parentElement);
  }
  light.focus();
  await user.keyboard('{ArrowRight}');
  expect(dark).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  expect(system).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  expect(light).toHaveFocus();
  await user.keyboard('{ArrowLeft}');
  expect(system).toHaveFocus();
  expect(system).toHaveAttribute('aria-checked', 'true');
  expect(light).toHaveAttribute('aria-checked', 'false');
  await user.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'Reset settings' })).toHaveFocus();
  await user.keyboard('d');
  expect(dark).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(document.documentElement).toHaveClass('dark');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('supports arrows, wrapping, Home/End, type-ahead and Escape with focus restoration', async () => {
  const { user, trigger } = setup();
  trigger.focus();
  await user.keyboard('{ArrowUp}');
  const first = screen.getByRole('menuitem', { name: 'My routes' });
  const last = screen.getByRole('menuitem', { name: 'Help and data sources' });
  await waitFor(() => expect(last).toHaveFocus());
  expect(screen.getByRole('menu')).toHaveAttribute('data-keyboard-navigation', 'true');
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

it('closes on an outside pointer and allows toggling the trigger', async () => {
  const { user, trigger } = setup();
  await user.click(trigger);
  fireEvent.pointerDown(document.body);
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  await user.click(trigger);
  await user.click(trigger);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it.each([false, true])(
  'Tab exits to the next page control or the direct route action (shift: %s)',
  async (backward) => {
    render(
      <ThemeProvider>
        <button>Previous page control</button>
        <HeaderMenu onNewRoute={vi.fn()} onLibrary={vi.fn()} onHelp={vi.fn()} onConnections={vi.fn()} />
        <button disabled>Disabled control</button>
        <button hidden>Hidden control</button>
        <div style={{ display: 'none' }}>
          <button>Invisible control</button>
        </div>
        <button tabIndex={-1}>Non-tabbable control</button>
        <input aria-label="Next page control" />
      </ThemeProvider>,
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Menu' });
    const destination = backward
      ? screen.getByRole('button', { name: 'New route' })
      : screen.getByRole('textbox', { name: 'Next page control' });
    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'My routes' })).toHaveFocus();
    await user.tab({ shift: backward });
    expect(destination).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(destination).toHaveFocus();

    await user.click(trigger);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  },
);

it.each([
  ['My routes', 'onLibrary'],
  ['Connections', 'onConnections'],
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
          onConnections={() => setOpen(true)}
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

it('requires local confirmation before resetting settings and leaves routes and drafts intact', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  try {
    savePreferences({ targetKm: 37, theme: 'dark', panelHidden: true });
    values.set('routes', 'saved routes');
    values.set('draft', 'draft');
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Reset settings' }));
    expect(screen.getByRole('dialog', { name: 'Reset settings' })).toHaveClass('compact');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('secondary');
    expect(screen.getByRole('button', { name: 'Reset settings' })).toHaveClass('primary');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    const actions = screen.getByRole('button', { name: 'Cancel' }).parentElement;
    expect(actions).toHaveClass('button-row', 'dialog-actions');
    expect(screen.getByRole('button', { name: 'Reset settings' }).parentElement).toBe(actions);
    expect(loadPreferences().targetKm).toBe(37);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(loadPreferences().targetKm).toBe(37);
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Reset settings' }));
    await user.click(screen.getByRole('button', { name: 'Reset settings' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(values.has(PREFERENCES_KEY)).toBe(false);
    expect(values.get('routes')).toBe('saved routes');
    expect(values.get('draft')).toBe('draft');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(loadPreferences().panelHidden).toBe(false);
    await waitFor(() => expect(trigger).toHaveFocus());
  } finally {
    vi.unstubAllGlobals();
  }
});
it('notifies about unavailable preference storage and keeps reset confirmation open on failure', async () => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  });
  try {
    const { user, trigger } = setup();
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Reset settings' }));
    await user.click(screen.getByRole('button', { name: 'Reset settings' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Settings could not be loaded or saved.');
  } finally {
    vi.unstubAllGlobals();
  }
});
