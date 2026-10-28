import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import './MapLoader.css';

export function MapLoader() {
  const { t } = useTranslation();
  const overlay = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const focused = document.activeElement;
    const overflow = document.body.style.overflow;
    const elements = [...document.body.children].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== overlay.current,
    );
    const previous = elements.map((element) => element.inert);
    elements.forEach((element) => {
      element.inert = true;
    });
    document.body.style.overflow = 'hidden';
    overlay.current?.focus({ preventScroll: true });
    return () => {
      elements.forEach((element, index) => {
        element.inert = previous[index];
      });
      document.body.style.overflow = overflow;
      if (focused instanceof HTMLElement && focused.isConnected)
        focused.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      className="global-map-loader"
      ref={overlay}
      tabIndex={-1}
      data-testid="global-map-loader"
      aria-busy="true"
    >
      <div className="global-map-loader__glow" aria-hidden="true" />
      <div className="global-map-loader__content" role="status" aria-live="polite">
        <div className="global-map-loader__mark" aria-hidden="true">
          <div className="global-map-loader__orbit" />
          <img src="/icon.svg" alt="" width="72" height="72" />
        </div>
        <span className="global-map-loader__brand" aria-hidden="true">
          Roamlet
        </span>
        <h2>{t('Loading your map…')}</h2>
        <p>{t('Preparing the map for your next route.')}</p>
        <div className="global-map-loader__track" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>,
    document.body,
  );
}
