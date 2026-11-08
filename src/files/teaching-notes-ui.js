(function () {
  'use strict';
  const core = window.GD_TEACHING;
  if (!core) return;
  const byId = id => document.getElementById(id);
  const ids = {date:'teachingDate',observation:'teachingObservation',plan:'teachingPlan',reflection:'teachingReflection'};
  let state = {signature:null,target:null,id:null,page:0,filter:'all'};
  const list = () => data?.teachingNotes || [];
  const selected = () => list().find(n => n.id === state.id);
  const stamp = () => new Date().toISOString();
  const clone = v => JSON.parse(JSON.stringify(v));
  const message = text => { byId('teachingStatus').textContent = text; };
  const input = () => Object.fromEntries(Object.entries(ids).map(([k,id]) => [k,byId(id).value]));
  function element(tag, text, className) {
    const el = document.createElement(tag); if (text !== undefined) el.textContent = text;
    if (className) el.className = className; return el;
  }
  function defaultTarget() {
    const t = testById(ui.ovTest);
    const subject = ui.ovSubject !== 'all' ? ui.ovSubject : t?.subject || null;
    const klass = classList().includes(ui.ovClass) ? ui.ovClass : null;
    return core.target(data,subject,klass,t?.id || null);
  }
  function choose(t) {
    state.target = t;
    const drafts = list().filter(n => n.status === 'draft' && core.key(n.target) === core.key(t));
    state.id = drafts.at(-1)?.id || null;
    if (state.id) state.target = selected().target;
    state.page = 0;
  }
  function options(id, entries, value) {
    const select = byId(id); select.replaceChildren();
    for (const [key,text] of entries) { const option = element('option',text); option.value = key; select.append(option); }
    select.value = value || '';
  }
  function controls() {
    const t = state.target, note = selected();
    const subjects = [...new Set([...subjectList(),...(t.subject ? [t.subject] : [])])].sort();
    const classes = [...new Set([...classList(),...(t.className ? [t.className] : [])])].sort();
    options('teachingSubject',[['','全教科共通'],...subjects.map(s => [s,s])],t.subject);
    options('teachingClass',[['','全クラス共通'],...classes.map(c => [c,c])],t.className);
    const tests = data.tests.filter(test => t.subject === null || test.subject === t.subject);
    const entries = tests.map(test => [test.id,`${test.name}（${test.subject}）`]);
    if (t.testId && !tests.some(test => test.id === t.testId)) entries.push([t.testId,`${t.testName}（記録時のテスト）`]);
    options('teachingTest',[['','関連付けなし'],...entries],t.testId);
    for (const id of ['teachingSubject','teachingClass','teachingTest']) byId(id).disabled = note?.status === 'recorded';
    byId('teachingTarget').textContent = `${t.subject || '全教科共通'} ／ ${t.className || '全クラス共通'} ／ 参考：${t.testName || 'なし'} ／ 記録時の対象 ${t.studentIds.length}名`;
  }
  function label() {
    const note = selected();
    byId('teachingEditorTitle').textContent = note?.status === 'recorded' ? 'メモを追記・編集する' : 'メモを書く';
    const badge = byId('teachingEditorLabel');
    badge.textContent = !note ? (list().length >= core.MAX_NOTES ? '件数上限' : '新しい記録')
      : note.status === 'draft' ? '書きかけ' : note.editing ? '追記・編集中' : '記録済み';
    badge.dataset.kind = !note ? 'new' : note.status === 'draft' ? 'draft' : note.editing ? 'editing' : 'recorded';
    byId('teachingRecord').textContent = note?.status === 'recorded' ? '変更を記録' : '記録する';
    byId('teachingRecord').disabled = !Object.entries(input()).some(([k,v]) => k !== 'date' && v.trim());
    byId('teachingDiscard').disabled = !note || (note.status === 'recorded' && !note.editing);
    byId('teachingDiscard').textContent = note?.status === 'draft' ? 'この下書きを破棄' : '編集中の内容を破棄';
    byId('teachingCount').textContent = `（記録 ${list().filter(n => n.status === 'recorded').length}件・書きかけ ${list().filter(n => n.status === 'draft' || n.editing).length}件）`;
  }
  function editor() {
    controls();
    const v = selected() ? core.values(selected()) : {date:localDateString(),observation:'',plan:'',reflection:''};
    const full = !selected() && list().length >= core.MAX_NOTES;
    for (const [k,id] of Object.entries(ids)) { byId(id).value = v[k]; byId(id).disabled = full; }
    if (full) message(`指導メモは最大${core.MAX_NOTES}件です。既存の記録を整理してから追加してください。`);
    label();
  }
  function button(text, action, noteId) {
    const b = element('button',text,'btn btn-ghost'), note = list().find(n => n.id === noteId);
    b.type = 'button'; b.dataset.noteId = noteId; b.onclick = action;
    b.setAttribute('aria-label',`${note.date || '日付未入力'}・${note.target.subject || '全教科共通'}・${note.target.className || '全クラス共通'}の指導メモ：${text}`);
    return b;
  }
  function history() {
    const rows = list().filter(n => state.filter !== 'current' || core.key(n.target) === core.key(state.target))
      .slice().sort((a,b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    const pages = Math.max(1,Math.ceil(rows.length / 20)); state.page = Math.min(state.page,pages-1);
    const wrap = byId('teachingHistory'); wrap.replaceChildren();
    byId('teachingHistoryHelp').textContent = state.filter === 'current'
      ? '入力欄と同じ教科・クラス・参考テストのメモを表示しています。'
      : '選択中のテストに関係なく、これまでのメモを表示しています。';
    if (!rows.length) wrap.append(element('p',state.filter === 'current' ? 'この対象の記録はまだありません。' : 'まだ記録はありません。上の入力欄から最初のメモを残せます。','teaching-empty'));
    for (const note of rows.slice(state.page*20,state.page*20+20)) {
      const item = element('article',undefined,'teaching-note'); item.dataset.noteId = note.id;
      item.dataset.active = String(note.id === state.id);
      const heading = element('div',undefined,'teaching-note-heading');
      heading.append(element('h4',`${note.date || '日付未入力'} ／ ${note.target.subject || '全教科共通'} ／ ${note.target.className || '全クラス共通'}`));
      const badge = element('span',note.status === 'draft' ? '書きかけ' : note.editing ? '追記・編集中' : '記録済み','teaching-badge');
      badge.dataset.kind = note.status === 'draft' ? 'draft' : note.editing ? 'editing' : 'recorded';
      heading.append(badge); item.append(heading);
      item.append(element('p',`参考テスト：${note.target.testName || '関連付けなし'} ／ 記録時 ${note.target.studentIds.length}名`,'teaching-note-meta'));
      const preview = [note.observation,note.plan,note.reflection].find(text => text.trim());
      if (preview) item.append(element('p',preview,'teaching-note-preview'));
      const dl = element('dl');
      for (const [k,title] of [['observation','気づいたこと'],['plan','次の指導'],['reflection','振り返り']]) if (note[k]) {
        dl.append(element('dt',title),element('dd',note[k]));
      }
      if (dl.childElementCount) {
        const body = element('details'); body.append(element('summary','本文を表示'),dl); item.append(body);
      }
      const actions = element('div',undefined,'teaching-note-actions');
      actions.append(button(note.status === 'draft' || note.editing ? '書きかけを再開' : '追記・編集',() => {
        state.id = note.id; state.target = note.target; editor(); message('記録時の対象を表示しています。別の対象には「新しい記録」を使ってください。');
        history();
        byId('teachingDate').focus();
      },note.id));
      const remove = button('削除',() => {
        if (!confirm('この指導メモを削除しますか？編集中の内容も削除します。JSONへ保存する前なら、保存済みのJSONから戻せます。')) return;
        core.remove(data,note.id); markDirty();
        if (state.id === note.id) { state.id = null; state.target = defaultTarget(); editor(); }
        history(); label(); message('メモを削除しました。'); byId('teachingNew').focus();
      },note.id);
      remove.classList.add('teaching-delete'); actions.append(remove); item.append(actions);
      wrap.append(item);
    }
    byId('teachingPage').textContent = `${state.page+1} / ${pages}ページ（${rows.length}件）`;
    byId('teachingPrev').disabled = state.page === 0; byId('teachingNext').disabled = state.page >= pages-1;
  }
  function render() {
    byId('teachingNotesCard').hidden = !data;
    if (!data) return;
    const t = defaultTarget(), signature = JSON.stringify([activeDataToken,ui.ovSubject,ui.ovClass,ui.ovTest,core.key(t)]);
    if (signature !== state.signature) {
      state.signature = signature; choose(t); message('');
    }
    if (state.id && !selected()) state.id = null;
    if (!state.target) state.target = t;
    byId('teachingHistoryScope').value = state.filter;
    editor(); history();
  }
  function write() {
    if (!data) return false;
    const v = input();
    try {
      if (!state.id) {
        if (![v.observation,v.plan,v.reflection].some(s => s.trim())) { label(); return true; }
        const id = 'tn-' + (globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(16).slice(2));
        state.id = core.create(data,state.target,v,stamp(),id).id;
      } else core.write(data,state.id,v,stamp());
      markDirty(); label(); history();
      message(selected()?.status === 'recorded' ? '記録済みの本文を残して、編集内容をアプリ内に保持しています。' : '書きかけをアプリ内に保持しています。');
      return true;
    } catch (error) { message(error.message); return false; }
  }
  function changeTarget(event) {
    if (!data) return;
    try {
      const subject = byId('teachingSubject').value || null, klass = byId('teachingClass').value || null;
      let testId = event.target.id === 'teachingSubject' ? null : byId('teachingTest').value || null;
      if (testId && !testById(testId)) testId = null;
      choose(core.target(data,subject,klass,testId)); editor(); history();
      message('対象を切り替えました。前の対象の書きかけは履歴に保持しています。');
    } catch (error) { controls(); message(error.message); }
  }
  for (const id of Object.values(ids)) byId(id).addEventListener('input',write);
  for (const id of ['teachingSubject','teachingClass','teachingTest']) byId(id).addEventListener('change',changeTarget);
  byId('teachingForm').onsubmit = event => {
    event.preventDefault(); if (!write()) return;
    if (!state.id) return;
    try { core.record(data,state.id,stamp()); markDirty(); editor(); history(); message('アプリ内に記録しました。'); }
    catch (error) { message(error.message); }
  };
  byId('teachingNew').onclick = () => {
    if (!data) return;
    const t = state.target;
    state.target = t && (t.className === null || classList().includes(t.className))
      ? core.target(data,t.subject,t.className,testById(t.testId)?.id || null) : defaultTarget();
    state.id = null; editor(); history(); message('新しい記録です。前の書きかけは履歴に残しています。'); byId('teachingDate').focus();
  };
  byId('teachingDiscard').onclick = () => {
    const note = selected(); if (!note || !confirm('編集中の内容を破棄しますか？記録済みの本文は保持します。')) return;
    core.discard(data,note.id); if (note.status === 'draft') state.id = null;
    markDirty(); editor(); history(); message('編集中の内容を破棄しました。');
  };
  byId('teachingHistoryScope').onchange = event => { state.filter = event.target.value; state.page = 0; history(); };
  byId('teachingPrev').onclick = () => { state.page = Math.max(0,state.page-1); history(); };
  byId('teachingNext').onclick = () => { state.page++; history(); };
  window.GD_TEACHING_UI = {
    render, snapshot:() => clone(state), restore(value) { if (value) state = clone(value); }
  };
  document.documentElement.dataset.teachingNotesInitialized = 'true';
  render();
})();
