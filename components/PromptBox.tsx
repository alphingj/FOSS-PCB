'use client';
import { useState } from 'react';
import { useStore } from '../lib/store';
import { SYSTEM_PROMPT } from '../lib/providers';
import { chatDirect } from '../lib/chat-direct';
import { parseFossPcb } from '../lib/foss-schema';
import { SAMPLE_BUCKBOOST, SAMPLE_MARKDOWN } from '../lib/sample-buckboost';
import { input, btnPrimary, btnPlain, muted } from '../lib/theme';

export default function PromptBox() {
  const { provider, setRawText, setPcb, setError } = useStore();
  const [prompt, setPrompt] = useState('build a simple buck boost, 5-15V in, -12V 1A out, 50x35mm 2-layer');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true); setError('');
    if (!provider.apiKey.trim()) { setError('Paste an API key in the provider bar first (or load the demo).'); setBusy(false); return; }
    if (!provider.model.trim()) { setError('Enter a model id first (or Fetch models to pick one).'); setBusy(false); return; }
    const apply = (text: string) => {
      setRawText(text);
      try {
        setPcb(parseFossPcb(text));
      } catch (e: any) {
        setError('AI returned invalid JSON: ' + e.message + ' — fix manually or retry.');
      }
    };
    try {
      // 1) Next dev-server proxy (keeps keys off CORS preflights)
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...provider,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
        }),
      });
      const j = await res.json();
      if (!j.error && j.text) { apply(j.text); return; }
      throw new Error(j.error ?? 'proxy unavailable — trying direct');
    } catch {
      try {
        // 2) Direct browser→provider (static export / Tauri path)
        apply(await chatDirect(provider, prompt));
      } catch (e: any) { setError(e.message); }
    } finally { setBusy(false); }
  };

  const loadDemo = () => { setRawText(SAMPLE_MARKDOWN); setPcb(SAMPLE_BUCKBOOST); setError(''); };

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>Describe your board.</div>
      <div style={{ ...muted, marginBottom: 12 }}>AI returns a bill of materials, netlist, and full PCB geometry — then you refine it below.</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          aria-label="Board description"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
          placeholder="e.g. USB-C PD trigger board, 20V 3A out…"
          style={{ ...input, flex: '1 1 280px', padding: '12px 16px', fontSize: 14, borderRadius: 14 }}
        />
        <button type="button" onClick={() => void send()} disabled={busy} style={{ ...btnPrimary, padding: '12px 24px', fontSize: 14, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Generating…' : 'Generate PCB'}
        </button>
        <button type="button" onClick={loadDemo} style={btnPlain}>Try the demo</button>
      </div>
    </div>
  );
}
