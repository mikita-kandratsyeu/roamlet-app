import { useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Button } from './ui/button';
import { MapLoadingIndicator } from './MapLoadingIndicator';
import './MapLoader.css';

interface Props {
  purpose?: 'map' | 'library';
  ariaLabel?: string;
  title?: string;
  description?: string;
  onCancel?: () => void;
}
interface Request extends Props {
  id: string;
}
const requests = new Map<string, Request>();
const listeners = new Set<() => void>();
let unlock: (() => void) | undefined;
const snapshot = () =>
  [...requests.values()].find((request) => request.purpose === 'library') ??
  requests.values().next().value ??
  null;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const publish = () => listeners.forEach((listener) => listener());

function lockBackground() {
  const focused = document.activeElement;
  const overflow = document.body.style.overflow;
  const previous = new Map<HTMLElement, boolean>();
  const protect = () => {
    for (const element of document.body.children) {
      if (!(element instanceof HTMLElement) || element.matches('[data-global-loader-portal]'))
        continue;
      if (!previous.has(element)) previous.set(element, element.inert);
      element.inert = true;
    }
  };
  protect();
  const observer = new MutationObserver(protect);
  observer.observe(document.body, { childList: true });
  document.body.style.overflow = 'hidden';
  return () => {
    observer.disconnect();
    previous.forEach((inert, element) => {
      element.inert = inert;
    });
    document.body.style.overflow = overflow;
    if (focused instanceof HTMLElement && focused.isConnected && !focused.closest('[inert]'))
      focused.focus({ preventScroll: true });
  };
}

export function MapLoader(props: Props = {}) {
  const { t } = useTranslation();
  const id = useId();
  const initial = useRef(props);
  const overlay = useRef<HTMLDivElement>(null);
  const selected = useSyncExternalStore(subscribe, snapshot, () => null);
  useLayoutEffect(() => {
    requests.set(id, { ...initial.current, id });
    if (requests.size === 1) unlock = lockBackground();
    publish();
    return () => {
      requests.delete(id);
      publish();
      if (!requests.size) {
        unlock?.();
        unlock = undefined;
      }
    };
  }, [id]);
  const { purpose, ariaLabel, title, description, onCancel } = props;
  useLayoutEffect(() => {
    const current = requests.get(id);
    if (
      current &&
      (current.purpose !== purpose ||
        current.ariaLabel !== ariaLabel ||
        current.title !== title ||
        current.description !== description ||
        current.onCancel !== onCancel)
    ) {
      requests.set(id, { id, purpose, ariaLabel, title, description, onCancel });
      publish();
    }
  }, [id, purpose, ariaLabel, title, description, onCancel]);
  useLayoutEffect(() => {
    if (selected?.id === id) overlay.current?.focus({ preventScroll: true });
  }, [id, selected?.id]);
  if (!selected || selected.id !== id) return null;
  const library = selected.purpose === 'library';
  const heading = selected.title ?? t(library ? 'Loading your routes…' : 'Loading your map…');
  const content = (
    <div
      className="global-map-loader map-loading-surface"
      ref={overlay}
      tabIndex={-1}
      data-global-loader-portal
      data-testid="global-map-loader"
      data-purpose={library ? 'library' : 'map'}
      aria-busy="true"
      aria-label={selected.ariaLabel ?? heading}
    >
      <div
        className="global-map-loader__content"
        role="status"
        aria-live="polite"
        aria-label={selected.ariaLabel ?? heading}
      >
        <MapLoadingIndicator />
        <h2>{heading}</h2>
        {selected.description && <p>{selected.description}</p>}
        {library && selected.onCancel && (
          <Button variant="ghost" className="back-to-map-button" onClick={selected.onCancel}>
            <ArrowLeft size={18} aria-hidden="true" />
            {t('Back to map')}
          </Button>
        )}
      </div>
    </div>
  );
  return createPortal(
    library ? (
      <div className="global-panel-loader" data-global-loader-portal data-testid="panel-loader">
        {content}
      </div>
    ) : (
      content
    ),
    document.body,
  );
}
