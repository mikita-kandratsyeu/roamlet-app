import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';

function AppErrorFallback({
  onRetry,
  onReload,
}: {
  onRetry: () => void;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  return (
    <main className="app-error-fallback" role="alert">
      <p>{t('The app could not be displayed. Your saved routes remain in this browser.')}</p>
      <div className="app-error-fallback-actions">
        <Button variant="outline" onClick={onRetry}>
          {t('Try again')}
        </Button>
        <Button onClick={onReload}>{t('Reload app')}</Button>
      </div>
    </main>
  );
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; key: number }> {
  state = { failed: false, key: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <AppErrorFallback
          onRetry={() => this.setState({ failed: false, key: this.state.key + 1 })}
          onReload={() => window.location.reload()}
        />
      );
    }
    return <div key={this.state.key}>{this.props.children}</div>;
  }
}