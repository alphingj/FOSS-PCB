'use client';
import React from 'react';

// Isolates panel crashes (notably WebGL/3D failures in some WebViews) so one
// bad panel shows an inline error instead of blanking the entire app.
export default class ErrorBoundary extends React.Component<
  { name: string; children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  componentDidCatch(e: unknown) {
    console.error(`[FOSS-PCB:${this.props.name}]`, e);
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" style={{ padding: 12, background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 8, fontSize: 13 }}>
          {this.props.name} crashed: {this.state.error}
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{ marginLeft: 8, background: 'var(--input)', color: 'var(--text)', border: '1px solid var(--input-border)', borderRadius: 980, padding: '4px 12px', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
