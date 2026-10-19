'use client';
import React, { createContext, useContext, useState } from 'react';
import type { FossPcb } from './foss-schema';
import type { ProviderConfig } from './providers';
import { PRESETS } from './providers';

interface Store {
  provider: ProviderConfig;
  setProvider: (p: Partial<ProviderConfig>) => void;
  rawText: string;
  setRawText: (s: string) => void;
  pcb: FossPcb | null;
  setPcb: (p: FossPcb | null) => void;
  error: string;
  setError: (s: string) => void;
  projectId: string;
  setProjectId: (s: string) => void;
  projectName: string;
  setProjectName: (s: string) => void;
  dirty: boolean;
  markSaved: () => void;
  /** MPN handed from the library/catalog panel to the AI Part Generator. */
  partgenSeed: string;
  setPartgenSeed: (s: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [provider, setProviderState] = useState<ProviderConfig>({
    kind: 'openrouter',
    apiKey: typeof window !== 'undefined' ? localStorage.getItem('foss-key') ?? '' : '',
    baseUrl: PRESETS.openrouter.baseUrl,
    model: PRESETS.openrouter.model,
    extraHeaders: {},
  });
  const [rawText, setRawText] = useState('');
  const [pcbState, setPcbState] = useState<FossPcb | null>(null);
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState('local-default');
  const [projectName, setProjectName] = useState('Untitled board');
  const [dirty, setDirty] = useState(false);
  const [partgenSeed, setPartgenSeed] = useState('');

  const setPcb = (p: FossPcb | null) => {
    setPcbState(p);
    setDirty(true);
  };
  const markSaved = () => setDirty(false);

  const setProvider = (p: Partial<ProviderConfig>) => {
    if (p.apiKey !== undefined) {
      try {
        localStorage.setItem('foss-key', p.apiKey);
      } catch {
        /* private mode — key stays in memory only */
      }
    }
    setProviderState((prev) => {
      const next = { ...prev, ...p };
      if (p.kind && !p.baseUrl) next.baseUrl = PRESETS[p.kind].baseUrl;
      return next;
    });
  };

  return (
    <Ctx.Provider value={{ provider, setProvider, rawText, setRawText, pcb: pcbState, setPcb, error, setError, projectId, setProjectId, projectName, setProjectName, dirty, markSaved, partgenSeed, setPartgenSeed }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}
