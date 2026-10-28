import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Globe, Info, Library, Plus } from 'lucide-react';

interface Props {
  onNewRoute: () => void;
  onLibrary: () => void;
  onHelp: () => void;
}

export function HeaderMenu({ onNewRoute, onLibrary, onHelp }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<'first' | 'last'>('first');
  const typed = useRef({ text: '', time: 0 });

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const items = panel.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]');
    items?.[initialFocus.current === 'last' ? items.length - 1 : 0]?.focus();
    typed.current = { text: '', time: 0 };
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function activate(action: () => void) {
    close(true);
    action();
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      panel.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') || [],
    );
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | undefined;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      close(true);
      return;
    }
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      event.key !== ' '
    ) {
      const now = Date.now();
      const text = now - typed.current.time > 500 ? event.key : typed.current.text + event.key;
      typed.current = { text: text.toLocaleLowerCase(), time: now };
      const match = items.findIndex(
        (item, index) =>
          index > current &&
          item.textContent?.trim().toLocaleLowerCase().startsWith(typed.current.text),
      );
      const wrapped = items.findIndex((item) =>
        item.textContent?.trim().toLocaleLowerCase().startsWith(typed.current.text),
      );
      next = match >= 0 ? match : wrapped >= 0 ? wrapped : undefined;
    }
    if (next !== undefined) {
      event.preventDefault();
      items[next]?.focus();
    }
  }

  return (
    <div className="header-menu" ref={root}>
      <button
        type="button"
        className="header-menu-action"
        aria-label={t('New route')}
        onClick={(event) => {
          close();
          event.currentTarget.focus();
          onNewRoute();
        }}
      >
        <Plus size={19} aria-hidden="true" />
        <span className="header-action-label-full">{t('New route')}</span>
        <span className="header-action-label-short" aria-hidden="true">
          {t('Route')}
        </span>
      </button>
      <button
        ref={trigger}
        type="button"
        className="header-menu-trigger"
        aria-label={t('Menu')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          initialFocus.current = 'first';
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first';
            setOpen(true);
          }
        }}
      >
        <ChevronDown size={19} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={id}
          ref={panel}
          className="header-menu-panel"
          role="menu"
          aria-label={t('Main navigation')}
          onKeyDown={navigate}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="header-menu-item"
            onClick={() => activate(onLibrary)}
          >
            <Library size={19} aria-hidden="true" />
            <span>{t('My routes')}</span>
          </button>
          <div role="separator" className="header-menu-separator" />
          <div role="group" aria-label={t('Language')}>
            <div className="header-menu-label">
              <Globe size={15} aria-hidden="true" />
              {t('Language')}
            </div>
            {(
              [
                ['en', 'English'],
                ['ru', 'Русский'],
              ] as const
            ).map(([language, label]) => (
              <button
                key={language}
                type="button"
                role="menuitemradio"
                aria-checked={i18n.resolvedLanguage === language}
                tabIndex={-1}
                className="header-menu-item header-menu-language"
                onClick={() =>
                  activate(() => {
                    void i18n.changeLanguage(language);
                  })
                }
              >
                <span>{label}</span>
                {i18n.resolvedLanguage === language && <Check size={17} aria-hidden="true" />}
              </button>
            ))}
          </div>
          <div role="separator" className="header-menu-separator" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="header-menu-item"
            onClick={() => activate(onHelp)}
          >
            <Info size={19} aria-hidden="true" />
            <span>{t('Help and data sources')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
