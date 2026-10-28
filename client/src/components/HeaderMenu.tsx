import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, Globe, Info, Library, Monitor, Moon, Plus, Sun } from 'lucide-react';
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

interface Props {
  onNewRoute: () => void;
  onLibrary: () => void;
  onHelp: () => void;
}

export function HeaderMenu({ onNewRoute, onLibrary, onHelp }: Props) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
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
              initialFocus.current = 'first';
            }}
            onKeyDown={(event) => {
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
          sideOffset={10}
          loop
          className="header-menu-panel"
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
          <DropdownMenuItem className="header-menu-item" onSelect={() => activate(onLibrary)}>
            <Library size={19} aria-hidden="true" />
            <span>{t('My routes')}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="header-menu-separator" />
          <DropdownMenuLabel className="header-menu-label">
            <Globe size={15} aria-hidden="true" />
            {t('Language')}
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
            <DropdownMenuRadioItem className="header-menu-item header-menu-language" value="en">
              English
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem className="header-menu-item header-menu-language" value="ru">
              Русский
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator className="header-menu-separator" />
          <DropdownMenuLabel className="header-menu-label">
            <Monitor size={15} aria-hidden="true" />
            {t('Theme')}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            aria-label={t('Theme')}
            value={theme}
            onValueChange={(value) => {
              if (isTheme(value)) activate(() => setTheme(value));
            }}
          >
            <DropdownMenuRadioItem className="header-menu-item" value="light">
              <Sun aria-hidden="true" />
              {t('Light')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem className="header-menu-item" value="dark">
              <Moon aria-hidden="true" />
              {t('Dark')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem className="header-menu-item" value="system">
              <Monitor aria-hidden="true" />
              {t('System')}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator className="header-menu-separator" />
          <DropdownMenuItem className="header-menu-item" onSelect={() => activate(onHelp)}>
            <Info size={19} aria-hidden="true" />
            <span>{t('Help and data sources')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
