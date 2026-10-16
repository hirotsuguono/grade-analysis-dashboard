'use strict';

// A separate, local-only first-use action. No user files are read automatically.
document.getElementById('demoBtn').onclick = () => {
  const button = document.getElementById('demoBtn');
  const status = document.getElementById('loadStatus');
  button.disabled = true;
  status.textContent = '架空データを読み込んでいます…';
  try {
    if (!window.GRADE_DASHBOARD_SAMPLE) throw new Error('sample');
    applyJsonText(JSON.stringify(window.GRADE_DASHBOARD_SAMPLE), 'sample-data.json', null);
    status.textContent = '';
    document.querySelector('.tab-btn.is-active').focus();
  } catch {
    status.textContent = 'サンプルを開けませんでした。ZIPをすべて展開し直すか、「体験用 JSON」を保存して「JSONを開く」で選んでください。';
  } finally {
    button.disabled = false;
  }
};

// Expose exact chart series as text, including box-plot quartiles and scatter pairs.
window.updateChartData = (el, option) => {
  let details = document.getElementById(el.id + '-data');
  if (!details) {
    details = document.createElement('details');
    details.id = el.id + '-data';
    details.className = 'chart-data';
    const summary = document.createElement('summary');
    summary.textContent = 'グラフのデータを表で確認';
    details.append(summary, document.createElement('div'));
    details.lastElementChild.className = 'table-wrap';
    el.after(details);
  }
  const table = document.createElement('table');
  const caption = table.createCaption();
  caption.className = 'sr-only';
  caption.textContent = el.closest('.card')?.querySelector('h3')?.textContent || 'グラフのデータ';
  const head = table.createTHead().insertRow();
  for (const label of ['系列', '項目', '値']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    head.append(th);
  }
  const body = table.createTBody();
  for (const series of (option.series || [])) {
    if (!Array.isArray(series.data)) continue;
    series.data.forEach((point, index) => {
      const row = body.insertRow();
      const raw = point?.value ?? point;
      const axes = option.xAxis || [];
      const category = axes[series.xAxisIndex || 0]?.data?.[index];
      const label = point?.name ?? category?.value ?? category ?? index + 1;
      const value = Array.isArray(raw) ? raw.join(' / ') : raw;
      [series.name || 'データ', label, value ?? '未入力'].forEach(text => {
        row.insertCell().textContent = String(text);
      });
    });
  }
  details.lastElementChild.replaceChildren(table);
  el.setAttribute('aria-describedby', details.id);
};

const tabs = [...document.querySelectorAll('.tab-btn')];
tabs.forEach((tab, index) => {
  tab.id = 'tab-' + tab.dataset.tab;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', 'panel-' + tab.dataset.tab);
  const panel = document.getElementById('panel-' + tab.dataset.tab);
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', tab.id);
  tab.addEventListener('keydown', event => {
    const direction = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    let target;
    if (direction) target = tabs[(index + direction + tabs.length) % tabs.length];
    if (event.key === 'Home') target = tabs[0];
    if (event.key === 'End') target = tabs.at(-1);
    if (!target) return;
    event.preventDefault();
    target.click();
    target.focus();
  });
  tab.addEventListener('click', () => { resizeCharts(); enhance(); });
});

for (const dialog of document.querySelectorAll('dialog')) {
  const heading = dialog.querySelector('h2');
  if (heading) {
    heading.id ||= dialog.id + '-title';
    dialog.setAttribute('aria-labelledby', heading.id);
  }
}

function enhance() {
  const sampleNote = document.getElementById('sampleAssociationNote');
  if (sampleNote) sampleNote.hidden = data?.samplePurpose !== 'fabricated-association-demo';
  tabs.forEach(tab => {
    const selected = tab.classList.contains('is-active');
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  for (const region of document.querySelectorAll('.table-wrap')) {
    region.tabIndex = 0;
    region.setAttribute('role', 'region');
    const heading = region.closest('.card, dialog')?.querySelector('h2,h3');
    region.setAttribute('aria-label', (heading?.textContent || 'データ表') + '：横にスクロールできます');
  }
  for (const input of document.querySelectorAll('table input, table select')) {
    if (input.getAttribute('aria-label')) continue;
    const cell = input.closest('td');
    const row = input.closest('tr');
    const heading = input.closest('table').tHead?.rows[0]?.cells[cell?.cellIndex]?.textContent || '値';
    const name = row?.querySelector('.cell-name')?.textContent || input.dataset.sid || '';
    input.setAttribute('aria-label', `${name} ${heading}`.trim());
  }
  for (const li of document.querySelectorAll('#studentList li')) {
    li.tabIndex = 0;
    li.setAttribute('role', 'checkbox');
    li.setAttribute('aria-checked', String(li.classList.contains('is-checked')));
    li.setAttribute('aria-label', li.textContent.trim().replace(/\s+/g, ' '));
    li.querySelector('input')?.setAttribute('aria-hidden', 'true');
  }
  for (const th of document.querySelectorAll('.list-table th[data-key]')) {
    const sorted = ui.listSort?.key === th.dataset.key;
    th.setAttribute('aria-sort', sorted ? (ui.listSort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    if (!th.querySelector('button')) {
      const button = document.createElement('button');
      button.className = 'sort-button';
      button.type = 'button';
      button.innerHTML = th.innerHTML;
      button.setAttribute('aria-label', th.textContent.trim() + 'で並べ替え');
      th.replaceChildren(button);
    }
  }
  for (const link of document.querySelectorAll('.es-link')) {
    link.tabIndex = 0;
    link.setAttribute('role', 'button');
  }
  for (const row of document.querySelectorAll('.iv-row')) {
    if (row.querySelector('.iv-view-btn')) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-ghost btn-sm iv-view-btn';
    button.textContent = '推移を表示';
    button.setAttribute('aria-label', `${row.querySelector('.cell-name')?.textContent || ''}の支援後の推移を表示`);
    row.lastElementChild.prepend(button);
  }
}

document.addEventListener('keydown', event => {
  if (![' ', 'Enter'].includes(event.key)) return;
  const target = event.target.closest('#studentList li, .es-link');
  if (!target || event.target.closest('button')) return;
  event.preventDefault();
  const sid = target.dataset.sid;
  target.click();
  if (sid) {
    enhance();
    [...document.querySelectorAll('#studentList li')].find(li => li.dataset.sid === sid)?.focus();
  }
});

document.addEventListener('click', event => {
  const button = event.target.closest('.sort-button');
  if (!button) return;
  const key = button.closest('th').dataset.key;
  queueMicrotask(() => {
    enhance();
    [...document.querySelectorAll('.list-table th')].find(th => th.dataset.key === key)?.querySelector('button')?.focus();
  });
});

new MutationObserver(enhance).observe(document.body, { childList: true, subtree: true });
enhance();
