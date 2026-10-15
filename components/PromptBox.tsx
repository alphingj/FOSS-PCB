'use client';
import { useState } from 'react';
import { useStore } from '../lib/store';
import { SYSTEM_PROMPT } from '../lib/providers';
import { chatDirect } from '../lib/chat-direct';
import { parseFossPcb } from '../lib/foss-schema';
import { validationErrors, repairPrompt } from '../lib/repair';
import { SAMPLE_BUCKBOOST, SAMPLE_MARKDOWN } from '../lib/sample-buckboost';
import { input, btnPrimary, btnPlain, muted } from '../lib/theme';

export default function PromptBox() {
  const { provider, setRawText, setPcb, setError } = useStore();
  const [prompt, setPrompt] = useState('build a simple buck boost, 5-15V in, -12V 1A out, 50x35mm 2-layer');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const ask = async (userText: string): Promise<string> => {
    // 1) Next dev-server proxy (keeps keys off CORS preflights)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...provider,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userText },
          ],
        }),
      });
      const j = await res.json();
      if (!j.error && j.text) return j.text as string;
    } catch {
      /* fall through to direct */
    }
    // 2) Direct browser→provider (static export / Tauri path)
    return chatDirect(provider, userText);
  };

  const send = async () => {
    setBusy(true); setError(''); setStatus('');
    if (!provider.apiKey.trim()) { setError('Paste an API key in the provider bar first (or load the demo).'); setBusy(false); return; }
    if (!provider.model.trim()) { setError('Enter a model id first (or Fetch models to pick one).'); setBusy(false); return; }
    try {
      let text = await ask(prompt);
      // validator-repair loop: parse + machine checks, at most 3 repairs
      for (let attempt = 0; attempt <= 3; attempt++) {
        let problems: string[] = [];
        try {
          const pcb = parseFossPcb(text);
          problems = validationErrors(pcb);
          setRawText(text);
          setPcb(pcb);
          if (!problems.length) {
            setStatus(attempt === 0 ? '' : `Clean after ${attempt} repair${attempt === 1 ? '' : 's'}.`);
            return;
          }
        } catch (e: any) {
          problems = [`Unparseable output: ${e.message}`];
        }
        if (attempt === 3) {
          setError(`Still failing after 3 repairs: ${problems.slice(0, 4).join(' · ')} — kept last output for manual fix.`);
          return;
        }
        setStatus(`Repair ${attempt + 1}/3: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ''}`);
        text = await ask(repairPrompt(prompt, problems.slice(0, 8)));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
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
      {status && <div style={{ ...muted, marginTop: 8 }}>{status}</div>}
    </div>
  );
}
