'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { deflateRawSync } = require('node:zlib');
const XLSX = require('../src/files/vendor/xlsx.full.min.js');
const ctx = vm.createContext({ Blob, DecompressionStream, Uint8Array, DataView });
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../src/files/import-core.js'), 'utf8'), ctx);
const api = ctx.GD_IMPORT;
const file = bytes => ({ size: bytes.length, async arrayBuffer() { return Uint8Array.from(bytes).buffer; } });
function zipEntry(content, declared = content.length) {
  const zipped = deflateRawSync(content), name = Buffer.from('fictional.xml');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8); local.writeUInt32LE(zipped.length, 18); local.writeUInt32LE(declared, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(zipped.length, 20); central.writeUInt32LE(declared, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + zipped.length, 16);
  return Buffer.concat([local, name, zipped, central, name, end]);
}
test('file capacity is checked before reading or parsing', async () => {
  let touched = false;
  await assert.rejects(api.readWorkbook({ size: api.limits.fileBytes + 1, arrayBuffer() { touched = true; } }, XLSX), /上限/);
  assert.equal(touched, false);
  await assert.rejects(api.readWorkbook(file(Buffer.from('fictional text')), XLSX), /形式/);
});
test('normal compressed XLSX and legacy XLS preserve blanks and zero', async () => {
  for (const bookType of ['xlsx', 'biff8']) {
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['架空'], [0, '', 5]]), '入力');
    const result = await api.readWorkbook(file(XLSX.write(wb, { type: 'buffer', bookType, compression: true })), XLSX);
    assert.equal(result.Sheets['入力'].A2.v, 0); assert.equal(result.Sheets['入力'].C2.v, 5);
  }
});
test('ZIP expansion rejects declared oversize, forged sizes, truncation and ZIP64 markers', async () => {
  await api.inspectZip(zipEntry(Buffer.from('fictional')));
  for (const bytes of [zipEntry(Buffer.from('fictional'), api.limits.entryBytes + 1),
    zipEntry(Buffer.alloc(1024 * 1024), 1), zipEntry(Buffer.from('fictional')).subarray(0, -1)]) {
    await assert.rejects(api.inspectZip(bytes), /上限/);
  }
  const zip64 = zipEntry(Buffer.from('fictional')); zip64.writeUInt16LE(65535, zip64.length - 12);
  await assert.rejects(api.inspectZip(zip64), /上限/);
});
test('wide, tall, clipped and aggregate sheet ranges are rejected before conversion', () => {
  for (const ref of ['A1:XFD1048576', 'A1:IW1', 'A1:A10001', 'XFD1048576', 'A1:BAD']) {
    const wb = { SheetNames: ['入力'], Sheets: { '入力': { '!ref': ref } } };
    assert.throws(() => api.selectSheet(wb, { ...XLSX, utils: { ...XLSX.utils, sheet_to_json() { throw new Error('conversion must not run'); } } }, ['入力']), /上限/);
  }
  assert.throws(() => api.validateWorkbook({ SheetNames: ['入力'], Sheets: { '入力': { '!ref': 'A1', '!fullref': 'A1:A999999' } } }, XLSX), /上限/);
  const wb = { SheetNames: ['a', 'b'], Sheets: { a: { '!ref': 'A1:CV6000' }, b: { '!ref': 'A1:CV6000' } } };
  assert.throws(() => api.validateWorkbook(wb, XLSX), /上限/);
});
