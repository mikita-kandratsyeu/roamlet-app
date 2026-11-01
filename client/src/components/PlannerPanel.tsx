import { useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, Maximize2, Minimize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';

export function PlannerPanel({
  title,
  summary,
  collapsed,
  onCollapsedChange,
  inert,
  children,
}: {
  title: string;
  summary?: ReactNode;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  inert?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const full = expanded && !collapsed;
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  function resize(nextCollapsed: boolean, nextExpanded = false) {
    setExpanded(nextExpanded);
    onCollapsedChange(nextCollapsed);
  }
  return (
    <aside
      id="route-planner"
      className="planner"
      aria-label={t('Route planner')}
      data-sheet-state={collapsed ? 'compact' : full ? 'expanded' : 'planning'}
      inert={inert}
      onFocusCapture={(event) => {
        if (
          window.matchMedia?.('(max-width: 700px)').matches &&
          event.target instanceof HTMLElement &&
          event.target.matches(
            'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, select',
          )
        )
          setExpanded(true);
      }}
    >
      <div className="mobile-sheet-header">
        <Button
          variant="ghost"
          className="mobile-sheet-toggle"
          aria-label={t(collapsed ? 'Show planner' : 'Hide planner')}
          title={t(collapsed ? 'Show planner' : 'Hide planner')}
          aria-describedby={
            summary ? 'planner-sheet-title planner-sheet-summary' : 'planner-sheet-title'
          }
          aria-controls="planner-scroll"
          aria-expanded={!collapsed}
          onClick={(event) => {
            if (suppressClick.current && event.detail > 0) {
              suppressClick.current = false;
              return;
            }
            resize(!collapsed);
          }}
          onPointerDown={(event) => {
            suppressClick.current = false;
            if (!event.isPrimary || event.button !== 0) return;
            gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            gesture.current = null;
          }}
          onLostPointerCapture={() => {
            gesture.current = null;
          }}
          onPointerUp={(event) => {
            const start = gesture.current;
            gesture.current = null;
            if (!start || start.id !== event.pointerId) return;
            const delta = event.clientY - start.y;
            if (Math.abs(delta) < 48 || Math.abs(delta) <= Math.abs(event.clientX - start.x))
              return;
            suppressClick.current = true;
            if (delta < 0) resize(false, !collapsed);
            else resize(!full);
          }}
        >
          <span className="sheet-identity">
            <strong id="planner-sheet-title">{title}</strong>
            {summary && <small id="planner-sheet-summary">{summary}</small>}
          </span>
          <span className="mobile-sheet-collapse-icon" aria-hidden="true">
            {collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </span>
        </Button>
        <Button
          variant="ghost"
          className="mobile-sheet-resize icon-button"
          aria-label={t(full ? 'Restore planner view' : 'Expand planner view')}
          title={t(full ? 'Restore planner view' : 'Expand planner view')}
          aria-controls="planner-scroll"
          aria-pressed={full}
          onClick={() => resize(false, !full)}
        >
          {full ? (
            <Minimize2 size={18} aria-hidden="true" />
          ) : (
            <Maximize2 size={18} aria-hidden="true" />
          )}
        </Button>
      </div>
      {children}
    </aside>
  );
}
