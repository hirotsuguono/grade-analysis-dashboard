'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const test = require('node:test');
const root = path.join(__dirname, '..');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grade-package-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'src'), output = path.join(dir, 'grade-analysis-dashboard.zip');
  fs.cpSync(path.join(root, 'src'), source, { recursive: true });
  return { source, output };
}
function run(f, ...extra) {
  return cp.spawnSync(process.env.PYTHON || 'python3', ['scripts/package.py', '--source', f.source, '--output', f.output, ...extra], { cwd: root, encoding: 'utf8' });
}
function passes(f, ...extra) { const r = run(f, ...extra); assert.equal(r.status, 0, r.stderr); }
function fails(f, pattern, ...extra) { const r = run(f, ...extra); assert.notEqual(r.status, 0); assert.match(r.stderr, pattern); }

test('offline ZIP is deterministic and check-only does not rewrite it', t => {
  const f = fixture(t);
  passes(f); const original = fs.readFileSync(f.output), stat = fs.statSync(f.output);
  passes(f, '--check'); assert.equal(fs.statSync(f.output).mtimeMs, stat.mtimeMs);
  passes(f); assert.deepEqual(fs.readFileSync(f.output), original);
});
test('unallowlisted source files refuse the build and preserve the existing artifact', t => {
  const f = fixture(t);
  fs.writeFileSync(f.output, 'previous artifact');
  fs.writeFileSync(path.join(f.source, 'private-roster.json'), '{}');
  fails(f, /allowlist/); assert.equal(fs.readFileSync(f.output, 'utf8'), 'previous artifact');
});
test('missing application license and altered vendor license refuse packaging', t => {
  const f = fixture(t), license = path.join(f.source, 'LICENSE');
  const saved = fs.readFileSync(license); fs.unlinkSync(license); fails(f, /allowlist/);
  fs.writeFileSync(license, saved);
  fs.appendFileSync(path.join(f.source, 'files/vendor/sheetjs.LICENSE'), '\nchanged');
  fails(f, /Vendor checksum/); assert.ok(!fs.existsSync(f.output));
});
test('broken local assets and mismatched sample pair are rejected', t => {
  const f = fixture(t), html = path.join(f.source, 'Index.html');
  const saved = fs.readFileSync(html, 'utf8'); fs.writeFileSync(html, saved.replace('files/style.css', 'files/missing.css'));
  fails(f, /reference/); fs.writeFileSync(html, saved);
  const p = path.join(f.source, 'files/sample-data.json'), sample = JSON.parse(fs.readFileSync(p)); sample.name += '（架空）'; fs.writeFileSync(p, JSON.stringify(sample));
  fails(f, /JSON\/JS mismatch/);
});
test('symlinks cannot introduce files outside the source allowlist', t => {
  const f = fixture(t), p = path.join(f.source, 'files/style.css');
  fs.unlinkSync(p); fs.symlinkSync(path.join(root, 'src/files/style.css'), p);
  fails(f, /symlink/); assert.ok(!fs.existsSync(f.output));
});
test('check-only detects a stale artifact after an intentional source edit', t => {
  const f = fixture(t); passes(f); const old = fs.readFileSync(f.output);
  fs.appendFileSync(path.join(f.source, 'files/style.css'), '\n/* fictional test edit */\n');
  fails(f, /Stale or changed/, '--check'); assert.deepEqual(fs.readFileSync(f.output), old);
});
