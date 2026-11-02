const RESIZE_IDLE_MS = 80;

/** Coalesces CSS/viewport ResizeObserver bursts into one map redraw after layout settles. */
export function observeSettledMapResize(
  target: Element,
  resize: () => void,
  idleMs = RESIZE_IDLE_MS,
): () => void {
  let width = Number.NaN;
  let height = Number.NaN;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  let disposed = false;

  const observer = new ResizeObserver((entries) => {
    const bounds = entries.at(-1)?.contentRect;
    if (!bounds || (bounds.width === width && bounds.height === height)) return;
    width = bounds.width;
    height = bounds.height;
    if (width <= 0 || height <= 0) return;

    if (timer !== undefined) clearTimeout(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    timer = setTimeout(() => {
      timer = undefined;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (!disposed) resize();
      });
    }, idleMs);
  });
  observer.observe(target);

  return () => {
    disposed = true;
    observer.disconnect();
    if (timer !== undefined) clearTimeout(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}
