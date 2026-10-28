'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/files/script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');
const fixture = () => ({ version: 3, name: '架空のPIN互換性確認', students: [], tests: [], scores: [], metrics: [], interventions: [], settings: { rti: { tier2: 60, tier3: 40 }, adminPinHash: null } });
function harness(mode) {
  const elements = new Map(), alerts = [];
  const crypto = mode === 'available' ? webcrypto : mode === 'failed' ? { subtle: { async digest() { throw new Error('synthetic digest failure'); } } } : {};
  const context = vm.createContext({ crypto, TextEncoder, alert: message => alerts.push(message), confirm: () => true,
    window: { addEventListener() {} }, document: { addEventListener() {}, getElementById(id) {
      if (!elements.has(id)) elements.set(id, { value: '', close() {} });
      return elements.get(id);
    } } });
  vm.runInContext(source + `
    renderAll=()=>{};updateRoleUI=()=>{};updateSaveStatus=()=>{};canPickSaveFile=()=>true;
    globalThis.api={applyJsonText,validateDataset,validPinHash,isLegacyPinHash,legacyPinHash,sha256Hex,saveJson,
      async enterPin(pin) { $('adminPinInput').value=pin; await submitAdminDialog({preventDefault(){}}); },
      getData:()=>data,isAdmin:()=>isAdmin,isDirty:()=>dirty};`, context);
  return { api: context.api, alerts };
}
function memoryFile(initial) {
  let text = initial, writes = 0;
  return { name: 'synthetic-pin.json', getFile: async () => ({ text: async () => text }),
    createWritable: async () => ({ write: async value => { text = value; writes++; }, close: async () => {} }),
    read: () => text, writes: () => writes };
}
test('PIN hash validation accepts only SHA-256 or the canonical legacy uint32-pair representation', () => {
  const { api } = harness('unavailable');
  for (const value of [null, undefined, {}, [], false, 1, '', 'a', 'g'.repeat(16), 'A'.repeat(16), '0'.repeat(16), '0123456789abcdef', 'a'.repeat(17), 'a'.repeat(63), 'a'.repeat(65), 'a\nb']) assert.equal(api.validPinHash(value), false);
  for (const value of ['00', '01', '1a0', '123456789abcdef', '6800f65beecd2423', 'a'.repeat(64), 'A'.repeat(64)]) assert.equal(api.validPinHash(value), true);
  assert.equal(api.legacyPinHash('gd-v2:1234'), '6800f65beecd2423');
});
for (const mode of ['available', 'unavailable', 'failed']) {
  test('PIN setup, actual save path and JSON reload remain compatible: ' + mode, async () => {
    const first = harness(mode), initial = JSON.stringify(fixture()), file = memoryFile(initial);
    assert.equal(first.api.applyJsonText(initial, file.name, file), true);
    await first.api.enterPin('1234');
    assert.equal(first.api.isAdmin(), true);
    assert.equal(first.api.isDirty(), true);
    await first.api.saveJson('overwrite');
    assert.equal(file.writes(), 1);
    assert.equal(first.api.isDirty(), false);
    const saved = JSON.parse(file.read()), hash = saved.settings.adminPinHash;
    assert.equal(hash.length, mode === 'available' ? 64 : 16);
    const second = harness(mode);
    assert.equal(second.api.applyJsonText(file.read(), 'synthetic-reopened.json', file), true);
    assert.equal(JSON.stringify(second.api.getData()), JSON.stringify(saved));
    assert.equal(second.api.isAdmin(), false);
    await second.api.enterPin('9999'); assert.equal(second.api.isAdmin(), false);
    await second.api.enterPin('1234'); assert.equal(second.api.isAdmin(), true);
    assert.equal(second.api.getData().settings.adminPinHash, hash);
  });
}
test('legacy PINs, including unpadded shorter hashes, also unlock after moving to Web Crypto', async () => {
  const producer = harness('unavailable');
  const pin = Array.from({ length: 1000 }, (_, i) => String(1000 + i)).find(p => producer.api.legacyPinHash('gd-v2:' + p).length < 16);
  assert.ok(pin, 'synthetic fixture must exercise an unpadded hash');
  for (const mode of ['available', 'unavailable', 'failed']) {
    const reader = harness(mode), saved = fixture(); saved.settings.adminPinHash = producer.api.legacyPinHash('gd-v2:' + pin);
    assert.equal(reader.api.applyJsonText(JSON.stringify(saved), 'synthetic-legacy.json', null), true);
    await reader.api.enterPin(pin); assert.equal(reader.api.isAdmin(), true);
  }
});
