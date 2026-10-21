// Minimal typing for the OpenCASCADE STEP/WASM importer. The package ships no
// types; only the API we use is declared.
declare module 'occt-import-js' {
  export interface OcctMesh {
    name?: string;
    color?: number[];
    attributes?: { position?: { array: ArrayLike<number> } };
    index?: { array: ArrayLike<number> };
  }
  export interface OcctResult {
    success: boolean;
    meshes: OcctMesh[];
    root?: unknown;
  }
  export interface OcctModule {
    ReadStepFile(bytes: Uint8Array, params: unknown): OcctResult;
    ReadBrepFile(bytes: Uint8Array, params: unknown): OcctResult;
    ReadIgesFile(bytes: Uint8Array, params: unknown): OcctResult;
  }
  const factory: (opts?: { locateFile?: (file: string) => string }) => Promise<OcctModule>;
  export default factory;
}
