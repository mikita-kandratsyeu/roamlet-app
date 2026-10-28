import { useTranslation } from 'react-i18next';
import { useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { Dialog as DialogRoot, DialogContent, DialogTitle, DialogClose } from './ui/dialog';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import '../i18n';

export function Dialog({
  title,
  children,
  onClose,
  wide = false,
  initialFocusRef,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  const previous = useRef<HTMLElement | null>(null);

  return (
    <DialogRoot
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={cn('dialog block', wide && 'wide')}
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          previous.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          if (initialFocusRef?.current) {
            event.preventDefault();
            initialFocusRef.current.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = previous.current;
          if (
            target?.isConnected &&
            !target.matches(':disabled') &&
            !target.closest('[hidden], [inert], [aria-hidden="true"]')
          ) {
            target.focus({ preventScroll: true });
          } else {
            document
              .querySelector<HTMLElement>('.header-menu-trigger, .brand')
              ?.focus({ preventScroll: true });
          }
        }}
      >
        <div className="dialog-header">
          <DialogTitle>{title}</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" className="icon-button" aria-label={t('Close dialog')}>
              <X size={20} aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>
        {children}
      </DialogContent>
    </DialogRoot>
  );
}
