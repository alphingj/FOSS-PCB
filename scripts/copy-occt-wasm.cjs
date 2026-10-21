// Copies OpenCASCADE's WASM kernel (used by the real 3D-body viewer) next to
// the static build. The 7.6 MB binary is not committed; npm install/build
// places it in public/ so both `npm run dev` and the Tauri bundle can fetch it.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'occt-import-js', 'dist', 'occt-import-js.wasm');
const destDir = path.join(__dirname, '..', 'public');
const dest = path.join(destDir, 'occt-import-js.wasm');

if (!fs.existsSync(src)) {
  console.error('occt-import-js is not installed — run `npm install` first.');
  process.exit(1);
}
fs.mkdirSync(destDir, { recursive: true });
const same = fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size;
if (!same) {
  fs.copyFileSync(src, dest);
  console.log('copied occt-import-js.wasm → public/');
} else {
  console.log('occt-import-js.wasm already up to date');
}
