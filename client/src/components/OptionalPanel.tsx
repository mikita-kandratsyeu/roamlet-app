import { Component, Suspense, lazy, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import { MapLoader } from './MapLoader';
import { Dialog } from './Dialog';
type PanelKind = 'screen' | 'statistics' | 'dialog';
function PanelFallback({
  kind,
  failed = false,
  onRetry,
  onClose,
  title,
  ariaLabel,
  closeLabel,
}: {
  kind: PanelKind;
  failed?: boolean;
  onRetry?: () => void;
  onClose?: () => void;
  title?: string;
  ariaLabel?: string;
  closeLabel?: string;
}) {
  const { t } = useTranslation();
  if (kind === 'screen' && !failed)
    return (
      <MapLoader
        purpose="library"
        title={t(title ?? 'Loading your routes…')}
        ariaLabel={t(ariaLabel ?? 'Saved routes')}
        cancelLabel={closeLabel ? t(closeLabel) : undefined}
        onCancel={onClose}
      />
    );
  const content = (
    <div
      className={`panel-loading-overlay ${failed ? 'panel-loading-error' : ''}`}
      data-testid="panel-loader"
    >
      <div role={failed ? 'alert' : 'status'}>
        {!failed && <LoaderCircle size={20} className="spin" aria-hidden="true" />}
        <p>
          {t(failed ? 'This panel could not be loaded. Try again when online.' : 'Loading panel…')}
        </p>
        {failed && (
          <Button variant="outline" onClick={onRetry}>
            {t('Retry panel')}
          </Button>
        )}
      </div>
    </div>
  );
  if (kind === 'statistics') return content;
  if (kind === 'dialog')
    return (
      <Dialog
        title={t(title ?? 'Loading panel…')}
        onClose={() => {
          if (!onClose) throw new Error('A lazy dialog requires an onClose handler.');
          onClose();
        }}
      >
        {content}
      </Dialog>
    );
  return createPortal(
    <section
      className="optional-screen-overlay"
      role="region"
      aria-label={t(ariaLabel ?? 'Saved routes')}
    >
      <header>
        <Button variant="ghost" className="back-to-map-button" onClick={onClose} autoFocus>
          <ArrowLeft size={18} aria-hidden="true" />
          {t('Back to map')}
        </Button>
      </header>
      {content}
    </section>,
    document.body,
  );
}
export function optionalLazy<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>,
  kind: PanelKind = 'statistics',
  title?: string,
  ariaLabel?: string,
  closeLabel?: string,
) {
  return function LazyPanel(props: P) {
    const [attempt, setAttempt] = useState(0);
    const [{ Panel }, setPanel] = useState(() => ({ Panel: lazy(loader) }));
    const panel = (
      <OptionalPanel
        key={attempt}
        kind={kind}
        onClose={(props as { onClose?: () => void }).onClose}
        title={title}
        ariaLabel={ariaLabel}
        closeLabel={closeLabel}
        onRetry={() => {
          setPanel({ Panel: lazy(loader) });
          setAttempt((value) => value + 1);
        }}
      >
        <Panel {...props} />
      </OptionalPanel>
    );
    return kind === 'statistics' ? <div className="optional-statistics-slot">{panel}</div> : panel;
  };
}
export class OptionalPanel extends Component<
  {
    children: ReactNode;
    kind?: PanelKind;
    onRetry?: () => void;
    onClose?: () => void;
    title?: string;
    ariaLabel?: string;
    closeLabel?: string;
  },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    const kind = this.props.kind ?? 'statistics';
    if (this.state.failed)
      return (
        <PanelFallback
          kind={kind}
          failed
          onClose={this.props.onClose}
          title={this.props.title}
          ariaLabel={this.props.ariaLabel}
          closeLabel={this.props.closeLabel}
          onRetry={() => {
            this.props.onRetry?.();
            this.setState({ failed: false });
          }}
        />
      );
    return (
      <Suspense
        fallback={
          <PanelFallback
            kind={kind}
            onClose={this.props.onClose}
            title={this.props.title}
            ariaLabel={this.props.ariaLabel}
            closeLabel={this.props.closeLabel}
          />
        }
      >
        {this.props.children}
      </Suspense>
    );
  }
}
