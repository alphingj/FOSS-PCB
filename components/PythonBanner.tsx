'use client';
import { useEffect, useState } from 'react';
import { Desktop, isTauri } from '../lib/tauri-bridge';

// Desktop-only banner: names the missing interpreter + fix instead of letting
// plugin/KiCad/STEP features silently fall back to stubs.
export default function PythonBanner() {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    Desktop.pythonStatus()
      .then((r) => setMissing(!r?.ok))
      .catch(() => setMissing(true));
  }, []);

  if (!missing) return null;
  return (
    <div style={{ background: 'var(--danger-soft)', borderBottom: '1px solid var(--card-border)', padding: '8px 18px', fontSize: 13 }}>
      <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Python not found.</span>{' '}
      <span style={{ color: 'var(--text-2)' }}>
        Plugin, KiCad and STEP features are running on stubs. Install Python 3.11+ from python.org/downloads, then restart the app.
      </span>
    </div>
  );
}
