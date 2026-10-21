// Real component bodies for the 3D view.
//
// Official KiCad 3D models are fetched on demand from KiCad's kicad-packages3d
// repository and tessellated in the browser with OpenCASCADE (occt-import-js,
// WASM). The resolver mirrors python/foss_pcb/models3d.py exactly: same library
// prefixes, same verified aliases, same "missing is missing" policy (no
// lookalike models). Downloads are cached in memory for the session.
import { isTauri } from './tauri-bridge';

export const MODEL_RAW_BASE = 'https://raw.githubusercontent.com/KiCad/kicad-packages3d/master/';

/** Footprint renames between this app/older KiCad and the official 3D library.
 *  Only verified renames; never map one part onto a different part. */
export const MODEL_ALIASES: Record<string, [string, string]> = {
  'TerminalBlock_Phoenix_MKDS-1,5-2_5.08mm': [
    'TerminalBlock_Phoenix',
    'TerminalBlock_Phoenix_MKDS-1,5-2-5.08_1x02_P5.08mm_Horizontal',
  ],
  'TerminalBlock_Phoenix_MKDS-1,5-2_5.08mm_Horizontal': [
    'TerminalBlock_Phoenix',
    'TerminalBlock_Phoenix_MKDS-1,5-2-5.08_1x02_P5.08mm_Horizontal',
  ],
  'TerminalBlock_Phoenix_MKDS-1,5-3_5.08mm_Horizontal': [
    'TerminalBlock_Phoenix',
    'TerminalBlock_Phoenix_MKDS-1,5-3-5.08_1x03_P5.08mm_Horizontal',
  ],
  'TerminalBlock_Phoenix_MKDS-1,5-4_5.08mm_Horizontal': [
    'TerminalBlock_Phoenix',
    'TerminalBlock_Phoenix_MKDS-1,5-4-5.08_1x04_P5.08mm_Horizontal',
  ],
  'TerminalBlock_Phoenix_MKDS-1,5-5_5.08mm_Horizontal': [
    'TerminalBlock_Phoenix',
    'TerminalBlock_Phoenix_MKDS-1,5-5-5.08_1x05_P5.08mm_Horizontal',
  ],
};

/** Footprint-name prefix → official library. Order matters (first match wins).
 *  Keep in sync with LIBRARY_PREFIXES in python/foss_pcb/models3d.py. */
export const MODEL_LIBRARY_PREFIXES: [string, string][] = [
  ['TerminalBlock_Phoenix_', 'TerminalBlock_Phoenix'],
  ['Connector_Phoenix_', 'Connector_Phoenix_MC'],
  ['SOIC-', 'Package_SO'],
  ['TSSOP-', 'Package_SO'],
  ['SSOP-', 'Package_SO'],
  ['MSOP-', 'Package_SO'],
  ['SOT-23', 'Package_TO_SOT_SMD'],
  ['SOT-223', 'Package_TO_SOT_SMD'],
  ['SOD-', 'Diode_SMD'],
  ['D_SMA', 'Diode_SMD'],
  ['D_SMB', 'Diode_SMD'],
  ['D_SMC', 'Diode_SMD'],
  ['CP_Elec', 'Capacitor_SMD'],
  ['CP_', 'Capacitor_SMD'],
  ['C_', 'Capacitor_SMD'],
  ['R_', 'Resistor_SMD'],
  ['L_', 'Inductor_SMD'],
  ['Crystal_', 'Crystal'],
  ['USB_', 'Connector_USB'],
  ['PinHeader_', 'Connector_PinHeader_2.54mm'],
];

export interface ModelRef {
  library: string;
  name: string;
  url: string;
}

function splitFootprint(fp: string): [string | null, string] {
  const clean = String(fp ?? '').trim();
  const i = clean.indexOf(':');
  if (i < 0) return [null, clean];
  return [clean.slice(0, i).trim() || null, clean.slice(i + 1).trim()];
}

export function guessModelLibrary(name: string): string | null {
  for (const [prefix, library] of MODEL_LIBRARY_PREFIXES) if (name.startsWith(prefix)) return library;
  return null;
}

/** Official STEP model for a footprint, or null when KiCad has no exact model.
 *  Pure/offline so checks can assert the mapping without touching the network. */
export function resolveModelForFootprint(footprint: string): ModelRef | null {
  let [lib, name] = splitFootprint(footprint);
  if (!name) return null;
  const alias = MODEL_ALIASES[name];
  if (alias) [lib, name] = alias;
  const target = lib || guessModelLibrary(name);
  if (!target) return null;
  const path = `${target}.3dshapes/${name}.step`;
  const url = MODEL_RAW_BASE + path.split('/').map((p) => encodeURIComponent(p)).join('/');
  return { library: target, name, url };
}

// --------------------------------------------------------------- transport
const stepBytes = new Map<string, ArrayBuffer>();

async function getUrl(url: string): Promise<Response> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url) as unknown as Promise<Response>;
  }
  return fetch(url);
}

/** Download a STEP model once per session. Throws a readable error. */
export async function fetchStepBytes(url: string): Promise<ArrayBuffer> {
  const hit = stepBytes.get(url);
  if (hit) return hit;
  let res: Response;
  try {
    res = await getUrl(url);
  } catch (e: any) {
    throw new Error(`Could not reach the KiCad 3D library (${e?.message ?? e}).`);
  }
  if (!res.ok) throw new Error(`KiCad 3D library returned HTTP ${res.status} for ${url.split('/').pop()}.`);
  const buf = await res.arrayBuffer();
  const head = new TextDecoder().decode(buf.slice(0, 32));
  if (!head.trimStart().startsWith('ISO-10303-21')) throw new Error(`${url.split('/').pop()} is not a STEP file.`);
  stepBytes.set(url, buf);
  return buf;
}

// --------------------------------------------------------------- tessellation
export interface StepMesh {
  positions: Float32Array;
  indices: Uint32Array;
  /** Per-mesh linear RGB colour from the STEP file, when present. */
  color?: [number, number, number];
  triangles: number;
}

let occtPromise: Promise<any> | null = null;

/** Load the OpenCASCADE WASM kernel once. The binary is copied to public/ by
 *  scripts/copy-occt-wasm.cjs (npm install/dev/build all run it). */
async function getOcct(): Promise<any> {
  if (!occtPromise) {
    occtPromise = (async () => {
      const mod: any = await import('occt-import-js');
      const factory = mod?.default ?? mod;
      return factory({ locateFile: (file: string) => `/${file}` });
    })().catch((e) => {
      occtPromise = null;
      throw new Error(`OpenCASCADE failed to start (${e?.message ?? e}). Rebuild so public/occt-import-js.wasm exists.`);
    });
  }
  return occtPromise;
}

const meshCache = new Map<string, StepMesh[]>();

/** Parsed meshes for one STEP model (cached by URL). */
export async function loadStepMeshes(url: string): Promise<StepMesh[]> {
  const hit = meshCache.get(url);
  if (hit) return hit;
  const bytes = new Uint8Array(await fetchStepBytes(url));
  const occt = await getOcct();
  let result: any;
  try {
    result = occt.ReadStepFile(bytes, null);
  } catch (e: any) {
    throw new Error(`OpenCASCADE could not read ${url.split('/').pop()} (${e?.message ?? e}).`);
  }
  if (!result?.success || !Array.isArray(result.meshes)) throw new Error(`No geometry in ${url.split('/').pop()}.`);

  const meshes: StepMesh[] = [];
  for (const m of result.meshes) {
    const pos = m?.attributes?.position?.array;
    const idx = m?.index?.array;
    if (!pos || !idx || !pos.length || !idx.length) continue;
    const positions = pos instanceof Float32Array ? pos : new Float32Array(pos);
    const indices = idx instanceof Uint32Array ? idx : new Uint32Array(idx);
    const c = Array.isArray(m.color) && m.color.length >= 3 ? m.color : undefined;
    meshes.push({
      positions,
      indices,
      color: c ? [Number(c[0]), Number(c[1]), Number(c[2])] : undefined,
      triangles: Math.floor(indices.length / 3),
    });
  }
  if (!meshes.length) throw new Error(`OpenCASCADE returned no triangles for ${url.split('/').pop()}.`);
  meshCache.set(url, meshes);
  return meshes;
}

/** Test hook — forget downloaded/parsed models. */
export function clearModelCache(): void {
  stepBytes.clear();
  meshCache.clear();
}
