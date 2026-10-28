import { useTranslation } from 'react-i18next';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
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
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement;
    dialog.showModal();
    initialFocusRef?.current?.focus();
    const cancel = (event: Event) => {
      event.preventDefault();
      closeRef.current();
    };
    dialog.addEventListener('cancel', cancel);
    return () => {
      dialog.removeEventListener('cancel', cancel);
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected && !previous.matches(':disabled') && !previous.closest('dialog:not([open])')) {
        previous.focus({ preventScroll: true });
      }
      if (document.activeElement === document.body || !document.activeElement?.isConnected || document.activeElement?.closest('dialog:not([open])')) {
        document.querySelector<HTMLElement>('.header-menu-trigger, .brand')?.focus({ preventScroll: true });
      }
    };
  }, [initialFocusRef]);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'wide' : ''}`}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label={t('Close dialog')}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
