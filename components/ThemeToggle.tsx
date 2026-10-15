'use client';
import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState('dark');
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme || 'dark');
  }, []);
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('foss-theme', next);
    } catch {}
  };
  return (
    <button
      type="button"
      onClick={flip}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      style={{
        background: 'var(--input)',
        border: '1px solid var(--input-border)',
        borderRadius: 980,
        width: 34,
        height: 34,
        fontSize: 16,
        cursor: 'pointer',
        lineHeight: 1,
      }}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}
