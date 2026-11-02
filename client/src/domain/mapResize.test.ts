import { afterEach, expect, it, vi } from 'vitest';
import { observeSettledMapResize } from './mapResize';

let emit: ResizeObserverCallback;
let runFrame: FrameRequestCallback;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function observe(resize: () => void) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        emit = callback;
      }
      observe() {}
      disconnect = disconnectMock;
    },
  );
  const target = document.createElement('div');
  const cleanup = observeSettledMapResize(target, resize, 80);
  return { target, cleanup };
}
const disconnectMock = vi.fn();
function size(width: number, height: number): ResizeObserverEntry[] {
  return [
    {
      target: document.createElement('div'),
      contentRect: new DOMRectReadOnly(0, 0, width, height),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    },
  ];
}
function report(width: number, height: number) {
  emit(size(width, height), {} as ResizeObserver);
}

it('coalesces animated container changes into one redraw after layout settles', () => {
  vi.useFakeTimers();
  disconnectMock.mockClear();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      runFrame = callback;
      return 1;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const resize = vi.fn();
  const { cleanup } = observe(resize);
  report(300, 500);
  report(310, 490);
  vi.advanceTimersByTime(40);
  report(320, 480);
  vi.advanceTimersByTime(79);
  expect(resize).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(resize).not.toHaveBeenCalled();
  runFrame(120);
  expect(resize).toHaveBeenCalledOnce();
  report(320, 480);
  vi.advanceTimersByTime(200);
  expect(resize).toHaveBeenCalledOnce();
  cleanup();
  expect(disconnectMock).toHaveBeenCalledOnce();
});

it('redraws when a settled viewport changes again and cancels pending work on cleanup', () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      runFrame = callback;
      return 2;
    }),
  );
  const cancelFrame = vi.fn();
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  const resize = vi.fn();
  const { cleanup } = observe(resize);
  report(300, 500);
  report(320, 480);
  vi.advanceTimersByTime(80);
  runFrame(80);
  expect(resize).toHaveBeenCalledOnce();
  report(320, 470);
  vi.advanceTimersByTime(80);
  cleanup();
  expect(cancelFrame).toHaveBeenCalledWith(2);
  runFrame(160);
  expect(resize).toHaveBeenCalledOnce();
});
