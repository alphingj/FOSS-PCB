// Preload for *check-run.cjs: pin module resolution to the repo's
// node_modules regardless of NODE_PATH env handling on the runner.
// Usage: node -r ./scripts/node-path.cjs <check>-run.cjs
const path = require('path');
module.paths.unshift(path.join(process.cwd(), 'node_modules'));
