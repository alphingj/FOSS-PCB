'use client';
import React from 'react';

// Shared Apple-style primitives. All colors flow through CSS vars so the
// light/dark toggle in the toolbar re-themes the whole app instantly.
export const card: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--card-border)',
  borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow)',
  padding: 16,
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
};

export const input: React.CSSProperties = {
  background: 'var(--input)',
  color: 'var(--text)',
  border: '1px solid var(--input-border)',
  borderRadius: 'var(--radius-s)',
  padding: '8px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};

export const btnPrimary: React.CSSProperties = {
  background: 'var(--accent)',
  color: '#fff',
  border: 0,
  borderRadius: 980,
  padding: '8px 18px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export const btnGhost: React.CSSProperties = {
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  border: 0,
  borderRadius: 980,
  padding: '7px 15px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export const btnPlain: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-2)',
  border: '1px solid var(--input-border)',
  borderRadius: 980,
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

export const seg = (on: boolean): React.CSSProperties => ({
  background: on ? 'var(--accent)' : 'transparent',
  color: on ? '#fff' : 'var(--text-2)',
  border: 0,
  borderRadius: 980,
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: on ? 600 : 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

export const table: React.CSSProperties = {
  width: '100%',
  fontSize: 12.5,
  borderCollapse: 'separate' as const,
  borderSpacing: 0,
  background: 'var(--table-row)',
  border: '1px solid var(--card-border)',
  borderRadius: 'var(--radius-s)',
  overflow: 'hidden',
};

export const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'var(--text-3)',
  marginBottom: 8,
};

export const muted: React.CSSProperties = { fontSize: 12.5, color: 'var(--text-2)' };
export const mono: React.CSSProperties = { fontFamily: 'var(--mono)', fontSize: 12 };
