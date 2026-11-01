import { useTranslation } from 'react-i18next';
import { useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import {
  Dialog as DialogRoot,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from './ui/dialog';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import '../i18n';
import './Dialog.css';

export function Dialog({
  title,
  mobileTitle,
  description,
  children,
  navigation,
  footer,
  onClose,
  wide = false,
  compact = false,
  initialFocusRef,
}: {
  title: string;
  mobileTitle?: string;
  description?: string;
  children: ReactNode;
  navigation?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  compact?: boolean;
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
        className={cn('dialog roamlet-dialog block', wide && 'wide', compact && 'compact')}
        showCloseButton={false}
        {...(!description && { 'aria-describedby': undefined })}
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
          <div className="dialog-heading">
            <DialogTitle aria-label={mobileTitle ? title : undefined}>
              {mobileTitle ? (
                <>
                  <span className="dialog-desktop-title">{title}</span>
                  <span className="dialog-mobile-title">{mobileTitle}</span>
                </>
              ) : (
                title
              )}
            </DialogTitle>
            {description && (
              <DialogDescription className="dialog-description">{description}</DialogDescription>
            )}
          </div>
          <DialogClose asChild>
            <Button variant="ghost" className="icon-button" aria-label={t('Close dialog')}>
              <X size={20} aria-hidden="true" />
            </Button>
          </DialogClose>
        </div>
        {navigation && <div className="dialog-navigation">{navigation}</div>}
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </DialogContent>
    </DialogRoot>
  );
}
