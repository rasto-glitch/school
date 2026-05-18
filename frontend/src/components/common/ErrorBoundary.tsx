import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Last-resort boundary. A render-time throw anywhere in the tree would
 * otherwise white-screen the entire app with no recovery. This catches it,
 * shows a recoverable fallback, and logs to the console (picked up by
 * Vercel/browser tooling). The fallback is intentionally English-only and
 * dependency-free — i18n or the store may be the thing that crashed, so the
 * boundary must not rely on them.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
          fontFamily: '-apple-system,BlinkMacSystemFont,Inter,sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 800 }}>Something went wrong</div>
        <div style={{ fontSize: 14, color: '#64748b', maxWidth: 420 }}>
          The page hit an unexpected error. Reloading usually fixes it. If it
          keeps happening, please contact your school administrator.
        </div>
        <button
          onClick={this.handleReload}
          style={{
            background: '#6366F1',
            color: '#fff',
            border: 'none',
            padding: '10px 18px',
            borderRadius: 10,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
