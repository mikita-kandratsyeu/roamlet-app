import { Component, Suspense, lazy, useState, type ComponentType, type ReactNode } from 'react';
import i18n from '../i18n';
export function optionalLazy<P extends object>(loader: () => Promise<{ default: ComponentType<P> }>) {
  return function LazyPanel(props: P) {
    const [attempt, setAttempt] = useState(0);
    const [{ Panel }, setPanel] = useState(() => ({ Panel: lazy(loader) }));
    return <OptionalPanel key={attempt} onRetry={() => { setPanel({ Panel: lazy(loader) }); setAttempt(value => value + 1); }}><Panel {...props} /></OptionalPanel>;
  };
}
export class OptionalPanel extends Component<{ children: ReactNode; onRetry?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert"><p>{i18n.t('This panel could not be loaded. Try again when online.')}</p><button onClick={() => { this.props.onRetry?.(); this.setState({ failed: false }); }}>{i18n.t('Retry panel')}</button></div>;
    return <Suspense fallback={<p role="status">{i18n.t('Loading panel…')}</p>}>{this.props.children}</Suspense>;
  }
}
