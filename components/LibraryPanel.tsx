'use client';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { LIBRARY } from '../lib/library';
import {
  CATALOG_PROVIDERS,
  digikeySearchUrl,
  lcscProductUrl,
  lcscSearchUrl,
  matchLibraryMpn,
  mouserSearchUrl,
  searchCatalog,
  type CatalogCredentials,
  type CatalogProvider,
  type CatalogResult,
} from '../lib/catalog';
import { input, btnPrimary, btnGhost, table, muted, sectionLabel } from '../lib/theme';

// Keys live in this browser only and go straight to the distributor.
const LS_KEYS = { mouser: 'foss-cat-mouser', dkId: 'foss-cat-dk-id', dkSecret: 'foss-cat-dk-secret' };

function readSaved(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeSaved(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode — credentials stay in memory for this session */
  }
}

function lcscUrlOrNull(code?: string): string | null {
  if (!code) return null;
  try {
    return lcscProductUrl(code);
  } catch {
    return null;
  }
}

function money(value?: number, currency?: string): string {
  if (typeof value !== 'number') return '—';
  const cur = currency ? `${currency} ` : '';
  return `${cur}${value < 1 ? value.toFixed(4) : value.toFixed(2)}`;
}

// Two ways to find a part:
//  1. The curated library — verified MPNs, LCSC codes and land patterns; Add
//     drops one onto the board.
//  2. Live distributor search (BYOK DigiKey / Mouser) for everything else.
//     Live rows carry the distributor's data only, so they can be sent to the
//     AI Part Generator with their datasheet instead of pretending we know a
//     footprint for them. LCSC has no public API, so it is offered as links.
export default function LibraryPanel() {
  const { pcb, setPcb, setPartgenSeed } = useStore();
  const [q, setQ] = useState('');
  const [typeF, setTypeF] = useState('all');

  const [provider, setProvider] = useState<CatalogProvider>('mouser');
  const [mouserKey, setMouserKey] = useState('');
  const [dkId, setDkId] = useState('');
  const [dkSecret, setDkSecret] = useState('');
  const [remember, setRemember] = useState(true);
  const [liveQuery, setLiveQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [liveError, setLiveError] = useState('');
  const [liveResult, setLiveResult] = useState<CatalogResult | null>(null);
  const [lcscCode, setLcscCode] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    setMouserKey(readSaved(LS_KEYS.mouser));
    setDkId(readSaved(LS_KEYS.dkId));
    setDkSecret(readSaved(LS_KEYS.dkSecret));
  }, []);

  useEffect(() => {
    writeSaved(LS_KEYS.mouser, remember ? mouserKey : '');
    writeSaved(LS_KEYS.dkId, remember ? dkId : '');
    writeSaved(LS_KEYS.dkSecret, remember ? dkSecret : '');
  }, [remember, mouserKey, dkId, dkSecret]);

  const types = useMemo(() => ['all', ...Array.from(new Set(LIBRARY.map((p) => p.type)))], []);
  const results = useMemo(() => {
    const nq = q.trim().toLowerCase();
    return LIBRARY.filter(
      (p) =>
        (typeF === 'all' || p.type === typeF) &&
        (!nq || [p.mpn, p.value, p.footprint, p.role].some((f) => f.toLowerCase().includes(nq)))
    ).slice(0, 60);
  }, [q, typeF]);

  const add = (mpn: string) => {
    if (!pcb) return;
    const part = LIBRARY.find((p) => p.mpn === mpn)!;
    const nums = pcb.components
      .filter((c) => c.designator.startsWith(part.prefix))
      .map((c) => parseInt(c.designator.slice(part.prefix.length), 10))
      .filter((n) => Number.isFinite(n));
    const des = `${part.prefix}${(nums.length ? Math.max(...nums) : 0) + 1}`;
    const spec = pcb.project_metadata.pcb_specifications;
    const i = pcb.components.length;
    const pins: Record<string, string> = {};
    part.pins.forEach((p) => { pins[p] = 'GND'; });
    setPcb({
      ...pcb,
      components: [
        ...pcb.components,
        {
          designator: des,
          type: part.type,
          value: part.value,
          mpn: part.mpn,
          footprint: part.footprint,
          pins,
          schematic_pos: { x: 100 + (i % 8) * 80, y: 150 + Math.floor(i / 8) * 90, rotation: 0 },
          pcb_placement_mm: {
            x: Math.min(spec.board_width_mm / 2 + (i % 5) * 4, spec.board_width_mm - 2),
            y: Math.min(spec.board_height_mm / 2 + Math.floor(i / 5) * 4, spec.board_height_mm - 2),
            rotation: 0,
            layer: 'Top' as const,
          },
        },
      ],
    });
  };

  const sendToPartGen = (mpn: string) => {
    setPartgenSeed(mpn);
    document.getElementById('partgen')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const copyMpn = async (mpn: string) => {
    try {
      await navigator.clipboard.writeText(mpn);
      setCopied(mpn);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      /* clipboard blocked — the MPN is visible and selectable anyway */
    }
  };

  const runSearch = async () => {
    setBusy(true);
    setLiveError('');
    setLiveResult(null);
    try {
      const creds: CatalogCredentials =
        provider === 'mouser'
          ? { mouser: { apiKey: mouserKey.trim() } }
          : provider === 'digikey'
            ? { digikey: { clientId: dkId.trim(), clientSecret: dkSecret.trim() } }
            : {};
      setLiveResult(await searchCatalog({ provider, query: liveQuery, limit: 25 }, creds));
    } catch (e: any) {
      setLiveError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const openExternal = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const meta = CATALOG_PROVIDERS.find((p) => p.id === provider)!;
  const needsMouser = provider === 'mouser';
  const needsDigikey = provider === 'digikey';

  return (
    <div>
      <h3>Part library</h3>
      <div style={muted}>{LIBRARY.length} stocked parts — verified MPNs, LCSC codes and land patterns</div>
      <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
        <input aria-label="Search parts" placeholder="Search MPN / value / role…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...input, flex: 1 }} />
        <select aria-label="Type filter" value={typeF} onChange={(e) => setTypeF(e.target.value)} style={input}>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div style={{ maxHeight: 260, overflow: 'auto' }}>
        <table style={table}>
          <thead><tr>{['MPN', 'Value', 'Footprint', 'LCSC', ''].map((h) => <th key={h} style={lth}>{h}</th>)}</tr></thead>
          <tbody>
            {results.map((p) => {
              const url = lcscUrlOrNull(p.lcsc);
              return (
                <tr key={p.mpn} title={p.role}>
                  <td style={ltd}>{p.mpn}</td><td style={ltd}>{p.value}</td><td style={ltd}>{p.footprint}</td>
                  <td style={ltd}>
                    {url ? <a href={url} target="_blank" rel="noreferrer" style={link}>{p.lcsc}</a> : '—'}
                  </td>
                  <td style={ltd}><button type="button" disabled={!pcb} onClick={() => add(p.mpn)} style={btnPrimary}>Add</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!pcb && <div style={{ ...muted, marginTop: 8 }}>Load or generate a board first — new pins land on GND for you to rewire.</div>}

      <div style={{ marginTop: 18 }}>
        <div style={sectionLabel}>Live distributor search</div>
        <div style={{ ...muted, marginBottom: 8 }}>
          Search DigiKey or Mouser with your own API credentials. Live results are ordering data, not verified
          footprints: <strong>Add</strong> appears only for MPNs already in the stocked library above, and anything
          else is handed to the Part Generator with its datasheet.
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <select aria-label="Distributor" value={provider} onChange={(e) => { setProvider(e.target.value as CatalogProvider); setLiveResult(null); setLiveError(''); }} style={input}>
            {CATALOG_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {provider !== 'lcsc' && (
            <>
              <input
                aria-label={`Search ${meta.label}`}
                placeholder="MPN or keyword, e.g. NE555DR"
                value={liveQuery}
                onChange={(e) => setLiveQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !busy && liveQuery.trim()) void runSearch(); }}
                style={{ ...input, flex: 1, minWidth: 180 }}
              />
              <button type="button" onClick={() => void runSearch()} disabled={busy || !liveQuery.trim()} style={{ ...btnPrimary, opacity: busy || !liveQuery.trim() ? 0.6 : 1 }}>
                {busy ? 'Searching…' : `Search ${meta.label}`}
              </button>
            </>
          )}
          {provider === 'lcsc' && (
            <>
              <input aria-label="LCSC code" placeholder="C-number, e.g. C7593" value={lcscCode} onChange={(e) => setLcscCode(e.target.value)} style={{ ...input, width: 160 }} />
              <button
                type="button"
                disabled={!lcscCode.trim()}
                onClick={() => { const u = lcscUrlOrNull(lcscCode.trim().toUpperCase()); if (u) openExternal(u); else setLiveError('Not a valid LCSC stock code (expected e.g. C7593).'); }}
                style={{ ...btnPrimary, opacity: lcscCode.trim() ? 1 : 0.6 }}
              >
                Open code
              </button>
              <button type="button" disabled={!liveQuery.trim()} onClick={() => openExternal(lcscSearchUrl(liveQuery.trim()))} style={{ ...btnGhost, opacity: liveQuery.trim() ? 1 : 0.6 }}>
                Search on LCSC
              </button>
            </>
          )}
        </div>

        {needsMouser && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <input aria-label="Mouser API key" type="password" placeholder="Mouser API key" value={mouserKey} onChange={(e) => setMouserKey(e.target.value)} style={{ ...input, flex: 1, minWidth: 220 }} />
          </div>
        )}
        {needsDigikey && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <input aria-label="DigiKey client ID" placeholder="DigiKey client ID" value={dkId} onChange={(e) => setDkId(e.target.value)} style={{ ...input, flex: 1, minWidth: 160 }} />
            <input aria-label="DigiKey client secret" type="password" placeholder="DigiKey client secret" value={dkSecret} onChange={(e) => setDkSecret(e.target.value)} style={{ ...input, flex: 1, minWidth: 160 }} />
          </div>
        )}

        <div style={{ ...muted, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <a href={meta.docs} target="_blank" rel="noreferrer" style={link}>{provider === 'lcsc' ? 'LCSC parts' : `${meta.label} API keys`}</a>
          <span>{meta.note}</span>
          {provider !== 'lcsc' && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember on this device
            </label>
          )}
          {provider === 'mouser' && <span>Or open <a href={mouserSearchUrl('NE555')} target="_blank" rel="noreferrer" style={link}>Mouser search</a>.</span>}
          {provider === 'digikey' && <span>Or open <a href={digikeySearchUrl('NE555')} target="_blank" rel="noreferrer" style={link}>DigiKey search</a>.</span>}
        </div>

        {liveError && <div style={errBox}>{liveError}</div>}

        {liveResult && (
          <div>
            <div style={{ ...muted, marginBottom: 6 }}>
              {liveResult.parts.length} of {liveResult.total ?? liveResult.parts.length} {liveResult.total === 1 ? 'match' : 'matches'}
              {liveResult.note ? ` — ${liveResult.note}` : ''}
            </div>
            <div style={{ maxHeight: 240, overflow: 'auto' }}>
              <table style={table}>
                <thead>
                  <tr>{['MPN', 'Mfr', 'Package', 'Stock', 'Unit', 'Actions'].map((h) => <th key={h} style={lth}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {liveResult.parts.map((p, idx) => {
                    const inLib = matchLibraryMpn(p.mpn, LIBRARY);
                    return (
                      <tr key={`${p.mpn}-${p.distributorPart}-${idx}`} title={p.description}>
                        <td style={ltd}>{p.mpn}</td>
                        <td style={ltd}>{p.manufacturer || '—'}</td>
                        <td style={ltd}>{p.package || '—'}</td>
                        <td style={ltd}>{p.stockText || (typeof p.stock === 'number' ? p.stock.toLocaleString('en-US') : '—')}</td>
                        <td style={ltd}>{money(p.unitPrice, p.currency)}</td>
                        <td style={{ ...ltd, whiteSpace: 'nowrap' }}>
                          {inLib
                            ? <button type="button" disabled={!pcb} onClick={() => add(inLib)} style={{ ...btnPrimary, marginRight: 6 }}>Add</button>
                            : <button type="button" onClick={() => sendToPartGen(p.mpn)} style={{ ...btnGhost, marginRight: 6 }}>Generate footprint</button>}
                          <button type="button" onClick={() => void copyMpn(p.mpn)} style={{ ...btnGhost, marginRight: 6 }}>{copied === p.mpn ? 'Copied' : 'Copy'}</button>
                          {p.datasheetUrl && <a href={p.datasheetUrl} target="_blank" rel="noreferrer" style={{ ...link, marginRight: 6 }}>Datasheet</a>}
                          {p.productUrl && <a href={p.productUrl} target="_blank" rel="noreferrer" style={link}>Buy</a>}
                        </td>
                      </tr>
                    );
                  })}
                  {!liveResult.parts.length && (
                    <tr><td style={ltd} colSpan={6}>No matches returned. Try the manufacturer part number shown on the datasheet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const lth: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-3)', background: 'var(--table-head)', position: 'sticky', top: 0 };
const ltd: React.CSSProperties = { padding: '7px 10px', borderTop: '1px solid var(--card-border)' };
const link: React.CSSProperties = { color: 'var(--accent)', textDecoration: 'none' };
const errBox: React.CSSProperties = { background: 'var(--danger-soft)', color: 'var(--danger)', padding: '10px 14px', borderRadius: 10, marginBottom: 10, fontSize: 13 };
