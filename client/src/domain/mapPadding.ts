interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export function mapPadding({
  viewport,
  planner,
  stylePicker,
  controls,
  elevation,
  editingToolbar,
  compactPlanner,
}: {
  viewport?: Bounds;
  planner?: Bounds;
  stylePicker?: Bounds;
  controls?: Bounds;
  elevation?: Bounds;
  editingToolbar?: Bounds;
  compactPlanner: boolean;
}): number | { top: number; bottom: number; left: number; right: number } {
  if (!viewport?.width || !viewport.height) return 65;
  const intersects = (bounds?: Bounds): bounds is Bounds => Boolean(
    bounds?.width && bounds.height && bounds.left < viewport.right &&
    bounds.right > viewport.left && bounds.top < viewport.bottom && bounds.bottom > viewport.top,
  );
  let top = 65, bottom = 65, left = 65, right = 65;
  if (intersects(stylePicker)) {
    if (stylePicker.top >= viewport.top + viewport.height / 2)
      bottom = Math.max(bottom, viewport.bottom - stylePicker.top + 12);
    else top = Math.max(top, stylePicker.bottom - viewport.top + 12);
  }
  if (intersects(elevation)) bottom = Math.max(bottom, viewport.bottom - elevation.top + 24);
  if (intersects(editingToolbar)) bottom = Math.max(bottom, viewport.bottom - editingToolbar.top + 32);
  if (intersects(planner)) {
    if (compactPlanner) bottom = Math.max(bottom, viewport.bottom - planner.top + 24);
    else left = Math.max(left, Math.min(planner.right - viewport.left + 24, viewport.width - 140));
  }
  if (intersects(controls)) {
    if (controls.width > viewport.width / 2)
      bottom = Math.max(bottom, viewport.bottom - controls.top + 24);
    else if (controls.left >= viewport.left + viewport.width / 2)
      right = Math.max(right, viewport.right - controls.left + 24);
  }
  // Leave usable map space even when overlays cover most of a compact viewport.
  const verticalBudget = Math.max(0, viewport.height - 48);
  if (top + bottom > verticalBudget) {
    const scale = verticalBudget / (top + bottom);
    top *= scale;
    bottom *= scale;
  }
  const horizontalBudget = Math.max(0, viewport.width - 96);
  if (left + right > horizontalBudget) {
    const scale = horizontalBudget / (left + right);
    left *= scale;
    right *= scale;
  }
  return { top, bottom, left, right };
}
