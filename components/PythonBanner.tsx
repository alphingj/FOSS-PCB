'use client';
import { useEffect, useState } from 'react';
import { Desktop, isTauri } from '../lib/tauri-bridge';

// Desktop-only banner: names the missing interpreter + fix instead of letting
// plugin/KiCad/STEP features silently fall back to stubs.
export default function PythonBanner() {
  const [state, setState] = useState<{ checked: boolean; ok: boolean; version: string }>({
    checked: false,
    ok: true,
    version: '',
  });

  useEffect(() => {
    if (!isTauri()) {
      setState({ checked: true, ok: true, version: '' });
      return;
    }
    Desktop.pythonStatus()
      .then((r) => setState({ checked: true, ok: !!r?.ok, version: r?.version ?? '' }))
      .catch(() => setState({ checked: true, ok: false, version: '' }));
  }, []);

  if (!state.checked || state.ok) return null;
  return (
    <div style={{ background: 'var(--danger-soft)', borderBottom: '1px solid var(--card-border)', padding: '8px 18px', fontSize: 13 }}>
      <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Python not found.</span>{' '}
      <span style={{ color: 'var(--text-2)' }}>
        Plugin, KiCad and STEP features are running on stubs. Install Python 3.11+ from python.org/downloads, restart the app
        {state.version ? ` (saw: ${state.version})` : ''}.
      </span>
    </div>
  );
}
