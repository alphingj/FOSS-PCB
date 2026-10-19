'use client';
import { useState } from 'react';
import { useStore } from '../lib/store';
import { chatDirect, type ChatAttachment } from '../lib/chat-direct';
import { generateKicadFootprint, generateKicadSymbol, padTable, type PartSpec } from '../lib/partgen';
import { parsePartSpec, partgenRequest } from '../lib/partgen-prompt';
import { btnGhost, btnPrimary, card, input, mono, muted, sectionLabel } from '../lib/theme';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function readBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });
}

/** Map the attached file to a provider attachment. PDFs are passed as documents
 *  (Anthropic only); images are sent with their real MIME type. */
async function readAttachment(file: File): Promise<ChatAttachment> {
  if (file.type === 'application/pdf')
    return { kind: 'document', mediaType: 'application/pdf', data: await readBase64(file) };
  if (IMAGE_TYPES.has(file.type))
    return { kind: 'image', mediaType: file.type, data: await readBase64(file) };
  throw new Error(`Unsupported file type "${file.type || 'unknown'}" — attach a PDF, PNG, JPEG, GIF or WebP.`);
}

// AI Part Generator: BYOK vision LLM reads a datasheet (part number + URL,
// PDF, or image), extracts the pinout and package geometry, and emits a linked
// KiCad .kicad_sym + .kicad_mod. The user reviews the pad table before use.
export default function PartGenerator() {
  const { provider } = useStore();
  const [mpn, setMpn] = useState('NE555DR');
  const [source, setSource] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [spec, setSpec] = useState<PartSpec | null>(null);
  const [sym, setSym] = useState('');
  const [mod, setMod] = useState('');

  const generate = async () => {
    setBusy(true); setError(''); setSpec(null);
    try {
      if (!provider.apiKey.trim()) throw new Error('Paste an API key in the provider bar first.');
      if (!file) throw new Error('Attach the datasheet PDF or a pinout image — a part number alone is not enough.');
      const { system, user } = partgenRequest(mpn, source || file.name);
      const attachment = await readAttachment(file);
      const raw = await chatDirect(provider, user, system, attachment);
      const parsed = parsePartSpec(raw);
      if (!parsed) throw new Error('The model did not return a usable part spec. Try a clearer image or the datasheet PDF.');
      setSpec(parsed);
      setSym(generateKicadSymbol(parsed));
      setMod(generateKicadFootprint(parsed));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const download = (name: string, text: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div style={card}>
      <h3>AI Part Generator</h3>
      <div style={{ ...muted, marginBottom: 12 }}>
        Turn a datasheet (PDF or pinout image) into a linked KiCad symbol + footprint. Uses your BYOK model; it cannot fetch URLs, so attach the document. Supports dual-row (SOIC/TSSOP), inline (SIP) and SOT-23 packages; quad/no-lead packages are rejected. Review the pad table before production use.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <input aria-label="Part number" value={mpn} onChange={(e) => setMpn(e.target.value)} placeholder="Part number, e.g. NE555DR" style={{ ...input, width: 240 }} />
        <input aria-label="Datasheet URL" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Datasheet URL (recorded, not fetched)" style={{ ...input, width: 240 }} />
        <label style={{ ...btnGhost, cursor: 'pointer' }}>
          {file ? file.name : 'Attach PDF / image'}
          <input type="file" accept=".pdf,image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        </label>
        <button type="button" onClick={() => void generate()} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Generating…' : 'Generate part'}
        </button>
      </div>

      {error && <div style={{ background: 'var(--danger-soft)', color: 'var(--danger)', padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {spec && (
        <>
          <div style={sectionLabel}>Extracted spec</div>
          <pre style={{ ...mono, background: 'var(--bg-soft)', padding: 12, borderRadius: 10, maxHeight: 200, overflow: 'auto', margin: '0 0 12px' }}>{JSON.stringify(spec, null, 2)}</pre>
          <div style={sectionLabel}>Pad table (verify against the datasheet)</div>
          <pre style={{ ...mono, background: 'var(--bg-soft)', padding: 12, borderRadius: 10, maxHeight: 160, overflow: 'auto', margin: '0 0 12px' }}>{padTable(spec)}</pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => download(`${spec.mpn}.kicad_sym`, sym)} style={btnGhost}>Download .kicad_sym</button>
            <button type="button" onClick={() => download(`${spec.mpn}.kicad_mod`, mod)} style={btnGhost}>Download .kicad_mod</button>
          </div>
        </>
      )}
    </div>
  );
}