import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, Check, CircleHelp, Library, Monitor, Moon, Plus, Sun } from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { isTheme, useTheme } from '../theme';
import { Dialog } from './Dialog';
import { loadPreferences, resetPreferences, PREFERENCES_ERROR_EVENT } from '../domain/preferences';

interface Props {
  onNewRoute: () => void;
  onLibrary: () => void;
  onHelp: () => void;
}

export function HeaderMenu({ onNewRoute, onLibrary, onHelp }: Props) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [preferencesError, setPreferencesError] = useState(false);
  const cancelReset = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const failed = () => setPreferencesError(true);
    window.addEventListener(PREFERENCES_ERROR_EVENT, failed);
    loadPreferences();
    return () => {
      window.removeEventListener(PREFERENCES_ERROR_EVENT, failed);
    };
  }, []);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 700px)');
    if (!media) return;
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<'first' | 'last'>('first');
  const closedWithTab = useRef(false);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attachPanel = useCallback((node: HTMLDivElement | null) => {
    panel.current = node;
    clearTimeout(focusTimer.current);
    if (node) {
      // Radix first runs its own focus scope; preserve pointer-open and ArrowUp entry afterward.
      focusTimer.current = setTimeout(() => {
        const items = node.querySelectorAll<HTMLElement>('[role^="menuitem"]');
        items[initialFocus.current === 'last' ? items.length - 1 : 0]?.focus();
      }, 0);
    }
  }, []);

  function activate(action: () => void) {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
    action();
  }

  function exitWithTab(backward: boolean) {
    closedWithTab.current = true;
    clearTimeout(focusTimer.current);
    setOpen(false);
    const tabbable = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href], area[href], iframe, object, embed, [tabindex], [contenteditable="true"]',
      ),
    )
      .filter((element) => {
        if (
          element.tabIndex < 0 ||
          element.matches(':disabled') ||
          element.closest('[hidden], [inert], [aria-hidden="true"]') ||
          panel.current?.contains(element)
        )
          return false;
        for (
          let ancestor: HTMLElement | null = element;
          ancestor;
          ancestor = ancestor.parentElement
        ) {
          const style = getComputedStyle(ancestor);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.visibility === 'collapse'
          )
            return false;
        }
        return true;
      })
      .sort((left, right) => (left.tabIndex || Infinity) - (right.tabIndex || Infinity));
    const index = tabbable.indexOf(trigger.current!);
    const next = tabbable[index + (backward ? -1 : 1)];
    if (next) next.focus({ preventScroll: true });
    else trigger.current?.blur();
  }

  return (
    <div className="header-menu">
      <Button
        variant="ghost"
        className="header-menu-action"
        aria-label={t('New route')}
        onClick={(event) => {
          setOpen(false);
          event.currentTarget.focus();
          onNewRoute();
        }}
      >
        <Plus size={19} aria-hidden="true" />
        <span className="header-action-label-full">{t('New route')}</span>
        <span className="header-action-label-short" aria-hidden="true">
          {t('Route')}
        </span>
      </Button>
      <DropdownMenu
        open={open}
        onOpenChange={(value) => {
          if (value) closedWithTab.current = false;
          setOpen(value);
        }}
        modal={false}
      >
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            variant="ghost"
            className="header-menu-trigger"
            aria-label={t('Menu')}
            onPointerDown={() => {
              setKeyboardNavigation(false);
              initialFocus.current = 'first';
            }}
            onKeyDown={(event) => {
              setKeyboardNavigation(true);
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                initialFocus.current = 'last';
                closedWithTab.current = false;
                setOpen(true);
              } else initialFocus.current = 'first';
            }}
          >
            <Menu size={19} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          ref={attachPanel}
          align="end"
          sideOffset={22}
          loop
          className="header-menu-panel"
          data-keyboard-navigation={keyboardNavigation}
          style={{ position: 'relative', top: 'auto', right: 'auto' }}
          aria-label={t('Main navigation')}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (closedWithTab.current) return;
            if (
              document.activeElement === document.body ||
              panel.current?.contains(document.activeElement)
            ) {
              trigger.current?.focus({ preventScroll: true });
            }
          }}
          onKeyDown={(event) => {
            setKeyboardNavigation(true);
            if (event.key === 'Tab') {
              event.preventDefault();
              exitWithTab(event.shiftKey);
            }
          }}
        >
          {compact && (
            <DropdownMenuItem
              className="header-menu-item mobile-new-route"
              onSelect={() => activate(onNewRoute)}
            >
              <Plus size={18} aria-hidden="true" />
              <span>{t('New route')}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="header-menu-item header-menu-action-item"
            onSelect={() => activate(onLibrary)}
          >
            <Library size={18} aria-hidden="true" />
            <span>{t('My routes')}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="header-menu-separator" />
          <DropdownMenuLabel className="header-menu-label">
            {t('Language / LANGUAGE')}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            aria-label={t('Language')}
            value={i18n.resolvedLanguage}
            onValueChange={(language) =>
              activate(() => {
                void i18n.changeLanguage(language);
              })
            }
          >
            <DropdownMenuRadioItem className="header-menu-item header-menu-language" value="ru">
              <span>Русский</span>
              {i18n.resolvedLanguage === 'ru' && (
                <Check className="preference-check" size={18} aria-hidden="true" />
              )}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem className="header-menu-item header-menu-language" value="en">
              <span>English</span>
              {i18n.resolvedLanguage === 'en' && (
                <Check className="preference-check" size={18} aria-hidden="true" />
              )}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator className="header-menu-separator" />
          <div className="header-menu-theme-row">
            <DropdownMenuLabel className="header-menu-label">{t('Theme')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              className="header-menu-theme-options"
              aria-label={t('Theme')}
              value={theme}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                event.stopPropagation();
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
                );
                const index = items.indexOf(document.activeElement as HTMLElement);
                const direction = event.key === 'ArrowRight' ? 1 : -1;
                items[(index + direction + items.length) % items.length]?.focus();
              }}
              onValueChange={(value) => {
                if (isTheme(value)) activate(() => setTheme(value));
              }}
            >
              {([
                ['light', 'Light', Sun],
                ['dark', 'Dark', Moon],
                ['system', 'System', Monitor],
              ] as const).map(([value, label, Icon]) => (
                <DropdownMenuRadioItem
                  key={value}
                  className="header-menu-item header-menu-theme-option"
                  value={value}
                  aria-label={t(label)}
                  title={t(label)}
                  textValue={t(label)}
                >
                  <Icon size={18} aria-hidden="true" />
                  {theme === value && (
                    <Check className="preference-check" size={18} aria-hidden="true" />
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </div>
          <p className="header-menu-note">
            {t('System theme follows OS settings. Language and theme are saved locally.')}
          </p>
          <DropdownMenuSeparator className="header-menu-separator" />
          <DropdownMenuItem
            className="header-menu-item"
            onSelect={() => activate(() => setResetOpen(true))}
          >
            {t('Reset settings')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="header-menu-item header-menu-action-item"
            onSelect={() => activate(onHelp)}
          >
            <CircleHelp size={18} aria-hidden="true" />
            <span>{t('Help and data sources')}</span>
          </DropdownMenuItem>
          <p className="header-menu-note">
            {t('Theme and language do not change the route, calculation or map position.')}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      {preferencesError && !resetOpen && (
        <div role="alert">
          {t(
            'Settings could not be loaded or saved. Safe defaults are used when needed. Your routes and drafts are unchanged.',
          )}
          <Button variant="ghost" onClick={() => setPreferencesError(false)}>
            {t('Dismiss settings notice')}
          </Button>
        </div>
      )}
      {resetOpen && (
        <Dialog
          title={t('Reset settings')}
          description={t(
            'Reset planning, library, language, theme and map settings? Saved routes and drafts will not be deleted.',
          )}
          onClose={() => setResetOpen(false)}
          initialFocusRef={cancelReset}
        >
          {preferencesError && (
            <p role="alert">
              {t(
                'Settings could not be loaded or saved. Safe defaults are used when needed. Your routes and drafts are unchanged.',
              )}
            </p>
          )}
          <div className="button-row dialog-actions">
            <Button ref={cancelReset} variant="outline" onClick={() => setResetOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button
              onClick={() => {
                if (resetPreferences()) {
                  setPreferencesError(false);
                  setResetOpen(false);
                }
              }}
            >
              {t('Reset settings')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
