import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { PlannerPanel } from './PlannerPanel';

function Planner({ initiallyCollapsed = false }: { initiallyCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  return (
    <PlannerPanel
      title="Weekend ride"
      summary="10 km · 1 h"
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
    >
      <div id="planner-scroll">
        <label>
          Latitude
          <input />
        </label>
      </div>
    </PlannerPanel>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('supports all three sizes with named keyboard controls', async () => {
  const user = userEvent.setup();
  render(<Planner initiallyCollapsed />);
  const panel = screen.getByRole('complementary', { name: 'Route planner' });
  const toggle = screen.getByRole('button', { name: 'Show planner' });
  expect(toggle).toHaveAttribute('aria-controls', 'planner-scroll');
  expect(toggle).toHaveTextContent('Weekend ride');
  expect(toggle).toHaveTextContent('10 km · 1 h');
  expect(panel).toHaveAttribute('data-sheet-state', 'compact');
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(panel).toHaveAttribute('data-sheet-state', 'planning');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await user.tab();
  await user.keyboard(' ');
  expect(panel).toHaveAttribute('data-sheet-state', 'expanded');
  expect(screen.getByRole('button', { name: 'Restore planner view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await user.keyboard('{Enter}');
  expect(panel).toHaveAttribute('data-sheet-state', 'planning');
  toggle.focus();
  await user.keyboard(' ');
  expect(panel).toHaveAttribute('data-sheet-state', 'compact');
});

function pointer(element: HTMLElement, type: string, x: number, y: number) {
  fireEvent(
    element,
    Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }), {
      pointerId: 1,
      isPrimary: true,
    }),
  );
}

it('swipes one size at a time without triggering the following click', () => {
  render(<Planner initiallyCollapsed />);
  const panel = screen.getByRole('complementary');
  const handle = screen.getByRole('button', { name: 'Show planner' });
  handle.setPointerCapture = vi.fn();
  function swipe(delta: number) {
    pointer(handle, 'pointerdown', 100, 100);
    pointer(handle, 'pointerup', 100, 100 + delta);
    fireEvent.click(handle, { detail: 1 });
  }
  swipe(-60);
  expect(panel).toHaveAttribute('data-sheet-state', 'planning');
  swipe(-60);
  expect(panel).toHaveAttribute('data-sheet-state', 'expanded');
  swipe(60);
  expect(panel).toHaveAttribute('data-sheet-state', 'planning');
  swipe(60);
  expect(panel).toHaveAttribute('data-sheet-state', 'compact');
  pointer(handle, 'pointerdown', 100, 100);
  pointer(handle, 'pointerup', 100, 110);
  fireEvent.click(handle, { detail: 1 });
  expect(panel).toHaveAttribute('data-sheet-state', 'planning');
});

it('ignores cancelled gestures and does not treat horizontal movement as resizing', () => {
  render(<Planner />);
  const panel = screen.getByRole('complementary');
  const handle = screen.getByRole('button', { name: 'Hide planner' });
  handle.setPointerCapture = vi.fn();
  pointer(handle, 'pointerdown', 100, 100);
  pointer(handle, 'pointercancel', 100, 20);
  pointer(handle, 'pointerup', 100, 20);
  expect(panel).toHaveAttribute('data-sheet-state', 'planning');
  pointer(handle, 'pointerdown', 100, 100);
  pointer(handle, 'pointerup', 200, 40);
  expect(panel).toHaveAttribute('data-sheet-state', 'planning');
});

it.each([true, false])('gives focused fields more room only on mobile (mobile: %s)', (mobile) => {
  vi.stubGlobal('matchMedia', () => ({ matches: mobile }));
  render(<Planner />);
  fireEvent.focus(screen.getByRole('textbox', { name: 'Latitude' }));
  expect(screen.getByRole('complementary')).toHaveAttribute(
    'data-sheet-state',
    mobile ? 'expanded' : 'planning',
  );
});
