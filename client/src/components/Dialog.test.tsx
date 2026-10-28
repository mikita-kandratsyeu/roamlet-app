import { useRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

const originalShowModal = HTMLDialogElement.prototype.showModal;
const originalClose = HTMLDialogElement.prototype.close;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
    this.querySelector<HTMLButtonElement>('button')?.focus();
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalShowModal) HTMLDialogElement.prototype.showModal = originalShowModal;
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) HTMLDialogElement.prototype.close = originalClose;
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
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

it('focuses the intended field after opening and returns focus without scrolling when closed', () => {
  const previous = opener();
  previous.focus();
  const focus = vi.spyOn(previous, 'focus');
  const view = render(<FormDialog />);
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  view.rerender(<FormDialog title="Updated details" />);
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  view.unmount();
  expect(previous).toHaveFocus();
  expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
});

it.each(['removed', 'disabled'])('uses a stable header target when the opener is %s', (state) => {
  const fallback = opener('header-menu-trigger');
  const previous = opener();
  previous.focus();
  const view = render(<FormDialog />);
  if (state === 'removed') previous.remove();
  else previous.disabled = true;
  view.unmount();
  expect(fallback).toHaveFocus();
});

it('keeps Escape cancellation bound to the latest callback without resetting focus', () => {
  const first = vi.fn();
  const latest = vi.fn();
  const view = render(<FormDialog onClose={first} />);
  view.rerender(<FormDialog onClose={latest} />);
  expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  const event = new Event('cancel', { cancelable: true });
  fireEvent(screen.getByRole('dialog'), event);
  expect(event.defaultPrevented).toBe(true);
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
    <>
      <Dialog title="First" onClose={() => {}}>
        First content
      </Dialog>
      <Dialog title="Second" onClose={() => {}}>
        Second content
      </Dialog>
    </>,
  );
  const first = screen.getByRole('dialog', { name: 'First' });
  const second = screen.getByRole('dialog', { name: 'Second' });
  expect(first.getAttribute('aria-labelledby')).not.toBe(second.getAttribute('aria-labelledby'));
});
