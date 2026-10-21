// Project persistence: localStorage autosave + .foss.json files.
// Snapshot history (last 20 saves) doubles as lightweight version history.
import { FossPcbJson, type FossPcb } from './foss-schema';

export interface Snapshot {
  t: number;
  pcb: FossPcb;
}

export interface ProjectFile {
  id: string;
  name: string;
  updatedAt: number;
  pcb: FossPcb;
  snaps: Snapshot[];
}

const KEY = 'foss-projects-v1';
const MAX_SNAPS = 20;

export function blankBoard(name: string): FossPcb {
  return FossPcbJson.parse({
    project_metadata: {
      design_name: name,
      revision: '1.0.0',
      topology: '',
      assumed_parameters: {},
      pcb_specifications: { board_width_mm: 50, board_height_mm: 35, layers: 2, copper_weight_oz: 1, surface_finish: 'HASL_Lead_Free' },
    },
    components: [],
    nets: [{ net_name: 'GND', nodes: [], trace_width_mm: 2, clearance_mm: 0.3, routing_type: 'Solid_Bottom_Ground_Plane' }],
    schematic_wires: [],
    pcb_traces: [],
    pcb_layout_zones: [],
  });
}

function readStore(): Record<string, ProjectFile> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, ProjectFile>;
  } catch {
    return {};
  }
}

function writeStore(s: Record<string, ProjectFile>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Quota exceeded: shed snapshot history (oldest first) and retry once
    // before giving up to session-only. Never silently keep everything.
    for (const p of Object.values(s)) p.snaps = p.snaps.slice(0, 3);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* still failing — session-only */
    }
  }
}

export function listProjects(): ProjectFile[] {
  return Object.values(readStore()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id: string): ProjectFile | null {
  return readStore()[id] ?? null;
}

export function putProject(p: ProjectFile) {
  const s = readStore();
  s[p.id] = p;
  writeStore(s);
}

export function deleteProject(id: string) {
  const s = readStore();
  delete s[id];
  writeStore(s);
}

export function snapshot(p: ProjectFile): ProjectFile {
  const snaps = [{ t: Date.now(), pcb: p.pcb }, ...p.snaps].slice(0, MAX_SNAPS);
  return { ...p, snaps, updatedAt: Date.now() };
}

/** Remove one backup snapshot. Returns false when the project or snapshot is gone. */
export function deleteSnapshot(id: string, t: number): boolean {
  const s = readStore();
  const p = s[id];
  if (!p) return false;
  const before = p.snaps.length;
  p.snaps = p.snaps.filter((snap) => snap.t !== t);
  if (p.snaps.length === before) return false;
  writeStore(s);
  return true;
}

/** Remove every backup snapshot for a project. Returns false when it is gone. */
export function clearSnapshots(id: string): boolean {
  const s = readStore();
  const p = s[id];
  if (!p) return false;
  if (!p.snaps.length) return true;
  p.snaps = [];
  writeStore(s);
  return true;
}

/** Accept a .foss.json envelope ({app, pcb}) or a bare FOSS board. */
export function parseProjectFile(text: string, fallbackName: string): ProjectFile {
  const obj = JSON.parse(text);
  const raw = obj && typeof obj === 'object' && 'pcb' in obj ? (obj as { pcb: unknown }).pcb : obj;
  const pcb = FossPcbJson.parse(raw);
  return {
    id: `proj-${Date.now()}`,
    name: (obj?.name as string) || pcb.project_metadata.design_name || fallbackName,
    updatedAt: Date.now(),
    pcb,
    snaps: [{ t: Date.now(), pcb }],
  };
}

export function toFileText(p: ProjectFile): string {
  return JSON.stringify({ app: 'foss-pcb', version: 1, name: p.name, updatedAt: p.updatedAt, pcb: p.pcb }, null, 2);
}
