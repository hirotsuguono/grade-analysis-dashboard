/* Update metadata only: this module never reads the application's data or file state. */
(function () {
  'use strict';
  const UPDATE_ENDPOINT = 'https://api.github.com/repos/hirotsuguono/grade-analysis-dashboard/releases/latest';
  const RELEASE_BASE = 'https://github.com/hirotsuguono/grade-analysis-dashboard/releases/download/';
  const ZIP_NAME = 'grade-analysis-dashboard.zip';
  const PREFERENCE_KEY = 'grade-dashboard-auto-update-check';

  function parseVersion(value) {
    if (typeof value !== 'string' || value.length > 48 || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
    const parts = value.replace(/^v/, '').split('.').map(Number);
    return parts.every(Number.isSafeInteger) ? parts : null;
  }

  function releaseStatus(current, release) {
    const local = parseVersion(current), remote = parseVersion(release?.tag_name);
    if (!local || !remote || release.draft !== false || release.prerelease !== false || !Array.isArray(release.assets)) throw new Error('Invalid release');
    const zipURL = RELEASE_BASE + release.tag_name + '/' + ZIP_NAME;
    if (!release.assets.some(asset => asset && asset.name === ZIP_NAME && asset.state === 'uploaded' && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.browser_download_url === zipURL)) throw new Error('Distribution unavailable');
    let comparison = 0;
    for (let i = 0; i < 3; i++) {
      if (local[i] !== remote[i]) { comparison = local[i] < remote[i] ? -1 : 1; break; }
    }
    const version = 'v' + remote.join('.');
    if (comparison < 0) return { state: 'available', text: '新しいバージョンがリリースされています（' + version + '）。配布ページで変更内容をご確認ください。' };
    if (comparison > 0) return { state: 'ahead', text: '正式リリースより新しい版をご利用中です（確認できた正式版：' + version + '）。' };
    return { state: 'current', text: 'ご利用中のアプリは最新の正式リリースと同じ版です（' + version + '）。' };
  }

  async function checkRelease(current, controller = new AbortController()) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Update check timed out')); }, 8000);
    });
    try {
      return await Promise.race([(async () => {
        const response = await fetch(UPDATE_ENDPOINT, {
          method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
          redirect: 'error', cache: 'no-store', headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Update check unavailable');
        return releaseStatus(current, await response.json());
      })(), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  function mount() {
    const status = document.getElementById('updateStatus');
    const button = document.getElementById('checkUpdateBtn');
    const auto = document.getElementById('autoUpdateCheck');
    const current = document.getElementById('appVersion')?.dataset.version;
    if (!status || !button || !auto || !current) return;
    let active = null;
    try { auto.checked = localStorage.getItem(PREFERENCE_KEY) !== 'off'; } catch (_) { /* Storage is optional. */ }
    function show(state, text) { status.dataset.state = state; status.textContent = text; }
    async function run() {
      if (active) return;
      const controller = new AbortController();
      active = controller;
      button.setAttribute('aria-disabled', 'true');
      status.setAttribute('aria-busy', 'true');
      show('checking', '正式リリースを確認しています…');
      try {
        const result = await checkRelease(current, controller);
        if (active === controller) show(result.state, result.text);
      } catch (_) {
        if (active === controller) show('unconfirmed', '正式リリースを確認できませんでした。接続を確認して再確認するか、配布ページをご覧ください。アプリはそのまま使えます。');
      } finally {
        if (active === controller) {
          active = null;
          button.removeAttribute('aria-disabled');
          status.removeAttribute('aria-busy');
        }
      }
    }
    button.addEventListener('click', run);
    auto.addEventListener('change', () => {
      try { localStorage.setItem(PREFERENCE_KEY, auto.checked ? 'on' : 'off'); } catch (_) { /* Keep the session choice. */ }
      if (!auto.checked) {
        if (active) active.abort();
        active = null;
        button.removeAttribute('aria-disabled');
        status.removeAttribute('aria-busy');
        show('disabled', '起動時の自動確認はオフです。「更新を確認」で手動確認できます。');
      } else show('unconfirmed', '起動時の自動確認はオンです。「更新を確認」で今すぐ確認できます。');
    });
    if (!auto.checked) show('disabled', '起動時の自動確認はオフです。「更新を確認」で手動確認できます。');
    else if (navigator.onLine === false) show('unconfirmed', 'オフラインのため正式リリースは未確認です。アプリはそのまま使えます。');
    else run();
  }

  if (typeof module === 'object' && module.exports) module.exports = { parseVersion, releaseStatus, checkRelease };
  else mount();
})();
