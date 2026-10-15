// Tauri bridge with web fallback so `npm run dev` still works without desktop shell.
export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export async function invokeCmd<T>(cmd: string, args: any): Promise<T | null> {
  if (!isTauri()) return null; // browser dev mode — caller uses TS fallback
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<T>(cmd, args); // throws on command failure — caller must surface it
}

export const Desktop = {
  parseKicad: (text: string) => invokeCmd('parse_kicad_pcb', { text }),
  writeKicad: (fossJson: string) => invokeCmd<string>('write_kicad_pcb', { fossJson }),
  drc: (boardW: number, boardH: number, placements: [string, number, number][]) =>
    invokeCmd('run_drc', { boardW, boardH, placements }),
  autoroute: (nets: string[]) => invokeCmd<string[]>('autoroute', { nets }),
  plugin: (plugin: string, argsJson: string) => invokeCmd<string>('run_python_plugin', { plugin, argsJson }),
  step: (fossJson: string) => invokeCmd<string>('export_step', { fossJson }),
};
