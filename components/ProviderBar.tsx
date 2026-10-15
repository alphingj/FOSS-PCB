'use client';
import { useState } from 'react';
import { useStore } from '../lib/store';
import { fetchOpenRouterModels, PRESETS } from '../lib/providers';
import { input, btnGhost } from '../lib/theme';

export default function ProviderBar() {
  const { provider, setProvider } = useStore();
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  const loadModels = async () => {
    setNotice('');
    if (provider.kind === 'anthropic') {
      setModels([]);
      setNotice('Anthropic has no list endpoint — type the model id.');
      return;
    }
    if (!provider.apiKey) {
      setNotice('Paste an API key first.');
      return;
    }
    setLoading(true);
    try {
      const list = await fetchOpenRouterModels(provider.apiKey, provider.baseUrl);
      setModels(list);
      if (!list.length) setNotice('No models returned — check key and base URL.');
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          aria-label="Provider"
          value={provider.kind}
          onChange={(e) => setProvider({ kind: e.target.value as any, baseUrl: PRESETS[e.target.value as keyof typeof PRESETS].baseUrl })}
          style={{ ...input, borderRadius: 980, fontWeight: 600 }}
        >
          <option value="openrouter">OpenRouter</option>
          <option value="anthropic">Anthropic</option>
          <option value="custom">Custom</option>
        </select>
        <input aria-label="API key" placeholder="API key" type="password" value={provider.apiKey} onChange={(e) => setProvider({ apiKey: e.target.value })} style={{ ...input, borderRadius: 980, width: 150 }} />
        <input aria-label="Model" placeholder="Model — type or pick" value={provider.model} onChange={(e) => setProvider({ model: e.target.value })} style={{ ...input, borderRadius: 980, width: 230, flex: '1 1 160px' }} list="foss-models" />
        {provider.kind === 'custom' && (
          <input aria-label="Base URL" placeholder="https://host/v1" value={provider.baseUrl} onChange={(e) => setProvider({ baseUrl: e.target.value })} style={{ ...input, borderRadius: 980, width: 200 }} />
        )}
        <datalist id="foss-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        <button type="button" onClick={loadModels} style={btnGhost}>{loading ? '…' : 'Models'}</button>
      </div>
      {notice && <div style={{ paddingTop: 4, fontSize: 12, color: 'var(--warning)' }}>{notice}</div>}
    </div>
  );
}
