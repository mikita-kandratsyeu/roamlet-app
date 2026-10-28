import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Button } from './button';
import { Input } from './input';
import { Textarea } from './textarea';
import { Label } from './label';
import { Slider } from './slider';
import { cn } from '../../lib/utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('preserves explicit classes, forwarded refs and props, and defaults buttons to non-submit', () => {
  const button = createRef<HTMLButtonElement>();
  const input = createRef<HTMLInputElement>();
  const textarea = createRef<HTMLTextAreaElement>();
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(
    <form onSubmit={submit}>
      <Button ref={button} className="existing-layout h-12" aria-label="Action">
        Action
      </Button>
      <Button type="submit">Save</Button>
      <Label htmlFor="name">Name</Label>
      <Input ref={input} id="name" className="existing-input" defaultValue="Route" />
      <Label htmlFor="notes">Notes</Label>
      <Textarea ref={textarea} id="notes" className="existing-textarea" rows={6} />
    </form>,
  );
  expect(button.current).toBe(screen.getByRole('button', { name: 'Action' }));
  expect(button.current).toHaveAttribute('type', 'button');
  expect(button.current).toHaveClass('existing-layout', 'h-12');
  expect(button.current).not.toHaveClass('h-9');
  expect(input.current).toBe(screen.getByRole('textbox', { name: 'Name' }));
  expect(input.current).toHaveValue('Route');
  expect(textarea.current).toBe(screen.getByRole('textbox', { name: 'Notes' }));
  expect(textarea.current).toHaveAttribute('rows', '6');
  fireEvent.click(button.current!);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(submit).toHaveBeenCalledTimes(1);
});

it('puts slider accessible names on the interactive thumb and forwards range values and callbacks', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const change = vi.fn();
  const ref = createRef<HTMLSpanElement>();
  render(
    <Slider
      ref={ref}
      aria-label="Target distance"
      defaultValue={[25]}
      min={5}
      max={100}
      step={5}
      onValueChange={change}
      className="target-slider"
    />,
  );
  const slider = screen.getByRole('slider', { name: 'Target distance' });
  expect(slider).toHaveAttribute('aria-valuenow', '25');
  expect(slider).toHaveAttribute('aria-valuemin', '5');
  expect(slider).toHaveAttribute('aria-valuemax', '100');
  expect(ref.current).toHaveClass('target-slider');
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(change).toHaveBeenCalledWith([30]);
  expect(slider).toHaveAttribute('aria-valuenow', '30');
});

it('merges conditional classes and keeps caller Tailwind overrides last', () => {
  expect(cn('p-2', false, { layout: true }, ['p-4'])).toBe('layout p-4');
});
