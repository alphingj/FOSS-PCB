'use client';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { isTauri } from '../lib/tauri-bridge';
import {
  blankBoard, clearSnapshots, deleteProject, deleteSnapshot, getProject, listProjects, parseProjectFile,
  putProject, snapshot, toFileText, type ProjectFile,
} from '../lib/projects';
import { download } from '../lib/kicad-io';
import { input, btnGhost, btnPlain } from '../lib/theme';

// Project persistence: autosave to localStorage, .foss.json files,
// snapshot history. Tauri shell uses native dialogs + fs; browser uses
// download/upload. Unsaved changes survive refresh via autosave.
export default function ProjectBar() {
  const { pcb, setPcb, projectId, setProjectId, projectName, setProjectName, dirty, markSaved, setError } = useStore();
  const [projects, setProjects] = useState<ProjectFile[]>([]);
  const [historyT, setHistoryT] = useState<number | ''>('');
  const [status, setStatus] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = () => setProjects(listProjects());

  useEffect(() => {
    refresh();
    // restore autosave of the default slot on first load
    const auto = getProject('local-default');
    if (auto) {
      setProjectId(auto.id);
      setProjectName(auto.name);
      setPcb(auto.pcb);
      markSaved();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // debounced autosave of current board into its project slot
  useEffect(() => {
    if (!pcb) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const prev = getProject(projectId);
      putProject({
        id: projectId,
        name: projectName,
        updatedAt: Date.now(),
        pcb,
        snaps: prev?.snaps ?? [{ t: Date.now(), pcb }],
      });
      refresh();
    }, 800);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pcb, projectId, projectName]);

  const current: ProjectFile | null = pcb
    ? { id: projectId, name: projectName, updatedAt: Date.now(), pcb, snaps: getProject(projectId)?.snaps ?? [] }
    : null;

  const doNew = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    const id = `proj-${Date.now()}`;
    const pcb0 = blankBoard('Untitled board');
    setProjectId(id);
    setProjectName('Untitled board');
    setPcb(pcb0);
    putProject({ id, name: 'Untitled board', updatedAt: Date.now(), pcb: pcb0, snaps: [{ t: Date.now(), pcb: pcb0 }] });
    markSaved();
    refresh();
  };

  const doSave = async () => {
    if (!current) return;
    const saved = snapshot(current);
    putProject(saved);
    markSaved();
    refresh();
    const text = toFileText(saved);
    const fname = `${saved.name.replace(/[^\w.-]+/g, '_')}.foss.json`;
    if (isTauri()) {
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        const path = await save({ defaultPath: fname, filters: [{ name: 'FOSS-PCB', extensions: ['foss.json', 'json'] }] });
        if (path) {
          await writeTextFile(path, text);
          setStatus(`saved to ${path}`);
        }
      } catch (e: any) {
        setError(`Save failed: ${e.message}`);
      }
    } else {
      download(fname, text);
      setStatus('saved locally + downloaded .foss.json');
    }
  };

  const openProject = (p: ProjectFile) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setProjectId(p.id);
    setProjectName(p.name);
    setPcb(p.pcb);
    markSaved();
    setHistoryT('');
  };

  const doOpenFile = async (f: File) => {
    try {
      const p = parseProjectFile(await f.text(), f.name.replace(/\.foss\.json$/i, ''));
      if (dirty && !window.confirm('Discard unsaved changes?')) return;
      putProject(p);
      openProject(p);
      setStatus(`opened ${f.name}`);
    } catch (e: any) {
      setError(`Open failed: ${e.message}`);
    }
  };

  const doOpenNative = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const path = await open({ multiple: false, filters: [{ name: 'FOSS-PCB', extensions: ['foss.json', 'json'] }] });
      if (typeof path === 'string') {
        const p = parseProjectFile(await readTextFile(path), path);
        if (dirty && !window.confirm('Discard unsaved changes?')) return;
        putProject(p);
        openProject(p);
        setStatus(`opened ${path}`);
      }
    } catch (e: any) {
      setError(`Open failed: ${e.message}`);
    }
  };

  const doRestore = () => {
    const snap = getProject(projectId)?.snaps.find((s) => s.t === historyT);
    if (!snap) return;
    setPcb(snap.pcb);
    setStatus(`restored snapshot ${new Date(snap.t).toLocaleTimeString()}`);
  };

  const snaps = getProject(projectId)?.snaps ?? [];

  const doDeleteSnapshot = () => {
    if (historyT === '') return;
    if (!window.confirm('Delete this backup? The current board is not affected.')) return;
    if (deleteSnapshot(projectId, Number(historyT))) {
      setHistoryT('');
      setStatus('backup deleted');
      refresh();
    }
  };

  const doClearSnaps = () => {
    if (!snaps.length) return;
    if (!window.confirm(`Delete all ${snaps.length} backups for "${projectName}"? The current board is not affected.`)) return;
    clearSnapshots(projectId);
    setHistoryT('');
    setStatus(`${snaps.length} backups deleted`);
    refresh();
  };

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '8px 18px', maxWidth: 1280, margin: '0 auto' }}>
      <input aria-label="Project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} style={{ ...input, width: 190, borderRadius: 980, fontWeight: 600 }} />
      <span style={{ fontSize: 12, color: dirty ? 'var(--warning)' : 'var(--success)' }}>{dirty ? '● Unsaved' : '● Saved'}</span>
      <button type="button" onClick={doNew} style={btnPlain}>New</button>
      <button type="button" onClick={() => void doSave()} disabled={!pcb} style={btnGhost}>Save</button>
      {isTauri() ? (
        <button type="button" onClick={() => void doOpenNative()} style={btnPlain}>Open…</button>
      ) : (
        <label style={{ ...btnPlain, cursor: 'pointer' }}>
          Open…
          <input type="file" accept=".foss.json,.json" hidden onChange={(e) => { if (e.target.files?.[0]) void doOpenFile(e.target.files[0]); e.target.value = ''; }} />
        </label>
      )}
      <select aria-label="Recent projects" value="" onChange={(e) => { const p = getProject(e.target.value); if (p) openProject(p); }} style={{ ...input, borderRadius: 980 }}>
        <option value="">Recents</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({new Date(p.updatedAt).toLocaleString()})</option>)}
      </select>
      {snaps.length > 0 && (
        <select aria-label="Snapshot history" value={historyT} onChange={(e) => setHistoryT(e.target.value ? Number(e.target.value) : '')} style={{ ...input, borderRadius: 980 }}>
          <option value="">History</option>
          {snaps.map((s) => <option key={s.t} value={s.t}>{new Date(s.t).toLocaleString()}</option>)}
        </select>
      )}
      {historyT !== '' && <button type="button" onClick={doRestore} style={btnGhost}>Restore</button>}
      {historyT !== '' && <button type="button" onClick={doDeleteSnapshot} style={{ ...btnPlain, color: 'var(--danger)' }}>Delete backup</button>}
      {snaps.length > 0 && <button type="button" onClick={doClearSnaps} style={{ ...btnPlain, color: 'var(--danger)' }}>Clear backups</button>}
      {status && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{status}</span>}
      {projects.length > 1 && (
        <button
          type="button"
          onClick={() => {
            if (!window.confirm(`Delete project "${projectName}" and its backups? This cannot be undone.`)) return;
            deleteProject(projectId);
            const rest = listProjects();
            setProjects(rest);
            if (rest[0]) openProject(rest[0]);
          }}
          style={{ ...btnPlain, color: 'var(--danger)' }}
        >
          Delete project
        </button>
      )}
    </div>
  );
}
