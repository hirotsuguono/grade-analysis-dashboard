'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const test = require('node:test');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
// Reviewed original files from the ECharts 6.1.0 and ZRender 6.1.0 tags.
const echartsComponentLicenses = {
  'files/vendor/echarts.LICENSE-d3': 'e1211892da0b0e0585b7aebe8f98c1274fba15bafe47fa1f4ee8a7a502c06304',
  'files/vendor/zrender.LICENSE': 'a681e9d183c72b4af4856935893805eb48c08f0f5a3f260203db7444c20fb98a',
};
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
test('ECharts component licenses retain upstream bytes and are included in the ZIP', t => {
  const f = fixture(t);
  passes(f);
  const notices = fs.readFileSync(path.join(f.source, 'files/licenses/THIRD-PARTY-NOTICES.md'), 'utf8');
  const readZip = cp.spawnSync(process.env.PYTHON || 'python3', ['-c',
    'import json, sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); print(json.dumps({n: z.read(n).hex() for n in sys.argv[2:]}))',
    f.output, ...Object.keys(echartsComponentLicenses).map(name => 'grade-analysis-dashboard/' + name)], { encoding: 'utf8' });
  assert.equal(readZip.status, 0, readZip.stderr);
  const entries = JSON.parse(readZip.stdout);
  for (const [name, digest] of Object.entries(echartsComponentLicenses)) {
    const source = fs.readFileSync(path.join(f.source, name));
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), digest);
    assert.deepEqual(Buffer.from(entries['grade-analysis-dashboard/' + name], 'hex'), source);
    assert.ok(notices.includes('../vendor/' + path.basename(name)), 'Notice must identify ' + name);
  }
});
for (const name of Object.keys(echartsComponentLicenses)) {
  test('missing or modified ' + name + ' refuses packaging and preserves the artifact', t => {
    const f = fixture(t), license = path.join(f.source, name);
    passes(f);
    const artifact = fs.readFileSync(f.output), original = fs.readFileSync(license);
    fs.unlinkSync(license);
    fails(f, /allowlist/);
    assert.deepEqual(fs.readFileSync(f.output), artifact);
    fs.writeFileSync(license, Buffer.concat([original, Buffer.from('\nchanged')]));
    fails(f, /Vendor checksum/);
    assert.deepEqual(fs.readFileSync(f.output), artifact);
  });
  for (const mutation of ['remove', 'change']) {
    test('check-only rejects a ZIP with ' + mutation + 'd ' + name, t => {
      const f = fixture(t);
      passes(f);
      const changeZip = cp.spawnSync(process.env.PYTHON || 'python3', ['-c',
        'import sys, zipfile; p, target, mode = sys.argv[1:]; z = zipfile.ZipFile(p); entries = [(i, z.read(i)) for i in z.infolist()]; z.close(); z = zipfile.ZipFile(p, "w"); [z.writestr(i, b"changed" if i.filename == target else data) for i, data in entries if mode != "remove" or i.filename != target]; z.close()',
        f.output, 'grade-analysis-dashboard/' + name, mutation], { encoding: 'utf8' });
      assert.equal(changeZip.status, 0, changeZip.stderr);
      const altered = fs.readFileSync(f.output);
      fails(f, mutation === 'remove' ? /ZIP allowlist/ : /Stale or changed/, '--check');
      assert.deepEqual(fs.readFileSync(f.output), altered);
    });
  }
}
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
