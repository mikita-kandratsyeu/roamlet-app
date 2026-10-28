import { useRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.querySelectorAll('[data-test-opener]').forEach((element) => element.remove());
});

function opener(className = '') {
  const button = document.createElement('button');
  button.className = className;
  button.dataset.testOpener = 'true';
  document.body.append(button);
  return button;
}
function FormDialog({
  title = 'Details',
  onClose = () => {},
}: {
  title?: string;
  onClose?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog title={title} onClose={onClose} initialFocusRef={input}>
      <label>
        Name
        <input ref={input} />
      </label>
    </Dialog>
  );
}

it('focuses the intended field after opening and returns focus without scrolling when closed', async () => {
  const previous = opener();
  previous.focus();
  const focus = vi.spyOn(previous, 'focus');
  const view = render(<FormDialog />);
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  view.rerender(<FormDialog title="Updated details" />);
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  view.unmount();
  await waitFor(() => expect(previous).toHaveFocus());
  expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
});

it.each(['removed', 'disabled'])(
  'uses a stable header target when the opener is %s',
  async (state) => {
    const fallback = opener('header-menu-trigger');
    const previous = opener();
    previous.focus();
    const view = render(<FormDialog />);
    if (state === 'removed') previous.remove();
    else previous.disabled = true;
    view.unmount();
    await waitFor(() => expect(fallback).toHaveFocus());
  },
);

it('keeps Escape cancellation bound to the latest callback without resetting focus', () => {
  const first = vi.fn();
  const latest = vi.fn();
  const view = render(<FormDialog onClose={first} />);
  view.rerender(<FormDialog onClose={latest} />);
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);
});

it('wraps Tab and Shift+Tab inside the dialog rather than losing focus to browser chrome', () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(0, 0, 10, 10),
  ] as unknown as DOMRectList);
  render(<FormDialog />);
  const input = screen.getByRole('textbox', { name: 'Name' });
  const close = screen.getByRole('button', { name: 'Close dialog' });
  fireEvent.keyDown(input, { key: 'Tab' });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
  expect(input).toHaveFocus();
});

it('gives each dialog its own accessible title association', () => {
  render(
    <Dialog title="First" onClose={() => {}}>
      First content
    </Dialog>,
  );
  const first = screen.getByRole('dialog', { name: 'First' });
  render(
    <Dialog title="Second" onClose={() => {}}>
      Second content
    </Dialog>,
  );
  const second = screen.getByRole('dialog', { name: 'Second' });
  expect(first.getAttribute('aria-labelledby')).not.toBe(second.getAttribute('aria-labelledby'));
});
