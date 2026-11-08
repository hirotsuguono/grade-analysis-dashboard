/* Teaching notes use creation-time targets; later roster/test edits do not retarget them. */
(function (root) {
  'use strict';
  const MAX_NOTES = 3000, MAX_TEXT = 4000, MAX_MEMBERS = 10000;
  const fields = ['date', 'observation', 'plan', 'reflection'];
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const label = v => typeof v === 'string' && !!v.trim() && v.length <= 500;
  function validDate(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || v.startsWith('0000')) return false;
    const d = new Date(v + 'T00:00:00Z');
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === v;
  }
  function validTime(v) {
    return typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)
      && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  }
  function values(note) {
    const source = note.editing || note;
    return Object.fromEntries(fields.map(k => [k, source[k]]));
  }
  function validate(notes) {
    const errors = [], add = text => { if (errors.length < 12) errors.push(text); };
    if (!Array.isArray(notes)) return ['指導メモは配列にしてください。'];
    if (notes.length > MAX_NOTES) return [`指導メモは${MAX_NOTES}件以内にしてください。`];
    const ids = new Set();
    function checkValues(v, recorded) {
      if (!object(v)) { add('指導メモの入力内容が不正です。'); return; }
      if (!(validDate(v.date) || (!recorded && v.date === ''))) add('指導メモの日付は実在する YYYY-MM-DD 形式にしてください。');
      for (const k of fields.slice(1)) if (typeof v[k] !== 'string' || v[k].length > MAX_TEXT) add(`指導メモの ${k} は${MAX_TEXT}文字以内の文字列にしてください。`);
      if (recorded && !fields.slice(1).some(k => typeof v[k] === 'string' && v[k].trim())) add('指導メモは少なくとも1欄を入力してください。');
    }
    for (const note of notes) {
      if (!object(note)) { add('指導メモはオブジェクトにしてください。'); continue; }
      if (!label(note.id) || ids.has(note.id)) add('指導メモのIDが不正、または重複しています。');
      ids.add(note.id);
      if (!['draft', 'recorded'].includes(note.status)) add('指導メモの状態が不正です。');
      if (!validTime(note.createdAt) || !validTime(note.updatedAt)) add('指導メモの作成・更新日時が不正です。');
      checkValues(note, note.status === 'recorded');
      if (note.editing !== undefined) {
        if (note.status !== 'recorded') add('下書きに編集中の内容を重ねることはできません。');
        checkValues(note.editing, false);
      }
      const t = note.target;
      if (!object(t)) { add('指導メモの対象が不正です。'); continue; }
      for (const k of ['subject', 'className']) if (!(t[k] === null || label(t[k]))) add('指導メモの教科・クラスは文字列または共通対象にしてください。');
      if (!((t.testId === null && t.testName === null) || (label(t.testId) && label(t.testName)))) add('指導メモの参考テストが不正です。');
      // IDs are a historical snapshot, so removed students/tests remain valid references here.
      if (!Array.isArray(t.studentIds) || t.studentIds.length > MAX_MEMBERS
          || t.studentIds.some(id => !label(id)) || new Set(t.studentIds).size !== t.studentIds.length) add('指導メモの記録時の対象生徒が不正です。');
    }
    return errors;
  }
  function assertValid(notes) {
    const errors = validate(notes);
    if (errors.length) throw new Error(errors[0]);
  }
  function target(dataset, subject, className, testId) {
    const test = testId ? dataset.tests.find(t => t.id === testId) : null;
    if (testId && !test) throw new Error('参考テストを選び直してください。');
    if (className !== null && !dataset.students.some(s => s.className === className)) throw new Error('現在の名簿にあるクラスを選んでください。');
    return { subject, className, testId: test?.id || null, testName: test ? test.name || '（名前未設定のテスト）' : null,
      studentIds: dataset.students.filter(s => className === null || s.className === className).map(s => s.id).sort() };
  }
  function key(t) { return JSON.stringify([t.subject, t.className, t.testId, [...t.studentIds].sort()]); }
  function find(dataset, id) {
    const note = (dataset.teachingNotes || []).find(n => n.id === id);
    if (!note) throw new Error('指導メモが見つかりません。対象を選び直してください。');
    return note;
  }
  function create(dataset, t, input, now, id) {
    const note = { id, target: JSON.parse(JSON.stringify(t)), status: 'draft',
      ...Object.fromEntries(fields.map(k => [k, input[k]])), createdAt: now, updatedAt: now };
    const next = [...(dataset.teachingNotes || []), note];
    assertValid(next);
    dataset.teachingNotes = next;
    return note;
  }
  function write(dataset, id, input, now) {
    const note = find(dataset, id), candidate = { ...note };
    const v = Object.fromEntries(fields.map(k => [k, input[k]]));
    if (note.status === 'recorded') candidate.editing = v;
    else Object.assign(candidate, v, { updatedAt: now });
    assertValid([candidate]);
    Object.assign(note, candidate);
    return note;
  }
  function record(dataset, id, now) {
    const note = find(dataset, id), candidate = { ...note, ...values(note), status: 'recorded', updatedAt: now };
    delete candidate.editing;
    assertValid([candidate]);
    Object.assign(note, candidate); delete note.editing;
    return note;
  }
  function discard(dataset, id) {
    const note = find(dataset, id);
    if (note.status === 'draft') dataset.teachingNotes = dataset.teachingNotes.filter(n => n.id !== id);
    else delete note.editing;
  }
  function remove(dataset, id) { find(dataset, id); dataset.teachingNotes = dataset.teachingNotes.filter(n => n.id !== id); }
  const api = { MAX_NOTES, MAX_TEXT, validDate, validate, values, target, key, create, write, record, discard, remove };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GD_TEACHING = api;
})(typeof window === 'object' ? window : globalThis);
