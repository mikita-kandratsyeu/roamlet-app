import { useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
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
      className="global-map-loader"
      ref={overlay}
      tabIndex={-1}
      data-global-loader-portal
      data-testid="global-map-loader"
      data-purpose={library ? 'library' : 'map'}
      aria-busy="true"
      aria-label={selected.ariaLabel ?? heading}
    >
      <div className="global-map-loader__glow" aria-hidden="true" />
      <div
        className="global-map-loader__content"
        role="status"
        aria-live="polite"
        aria-label={selected.ariaLabel ?? heading}
      >
        <div className="global-map-loader__mark" aria-hidden="true">
          <div className="global-map-loader__orbit" />
          <img src="/icon.svg" alt="" width="72" height="72" />
        </div>
        <span className="global-map-loader__brand" aria-hidden="true">
          Roamlet
        </span>
        <h2>{heading}</h2>
        <p>
          {selected.description ??
            t(library ? 'Preparing your saved routes.' : 'Preparing the map for your next route.')}
        </p>
        <div className="global-map-loader__track" aria-hidden="true">
          <span />
        </div>
        {library && selected.onCancel && (
          <Button variant="outline" onClick={selected.onCancel}>
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
