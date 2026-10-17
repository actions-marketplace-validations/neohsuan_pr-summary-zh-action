const { execFileSync } = require('node:child_process');
const { mkdtempSync, readdirSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, relative } = require('node:path');
const { strict: assert } = require('node:assert');
const temp = mkdtempSync(join(tmpdir(), 'pr-summary-build-'));
function files(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path, base) : [relative(base, path)];
  }).sort();
}
try {
  execFileSync(process.execPath, ['node_modules/@vercel/ncc/dist/ncc/cli.js', 'build', 'src/index.js', '-o', temp, '--license', 'licenses.txt'], { stdio: 'inherit' });
  assert.deepEqual(files('dist'), files(temp), 'dist file list differs; run npm run build');
  for (const file of files(temp)) assert.ok(readFileSync(join('dist', file)).equals(readFileSync(join(temp, file))), `${file} differs; run npm run build`);
  console.log('dist matches source.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
