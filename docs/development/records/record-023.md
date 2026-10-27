# PR 23 面談カルテの項目選択・テスト比較設定・JSON保存方法の選択を追加

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-24 13:17:33 JST |
| 最終更新日時 | 2026-10-25 05:34:54 JST |
| 保存時点の状態 | マージ済み |
| 終了日時 | 2026-10-25 05:34:50 JST |
| マージ時のコミット | [e78dbae67b12](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/e78dbae67b12c756bdbaba13882b2fdba9157074) |

## 最初の説明

> 面談カルテの表示項目が固定され、種類の異なるテストも直前比較され、ダブルクリック起動時はJSONのダウンロードしか選べなかった問題を改善します。[#20](record-020.md)→[#21](record-021.md)→#22の順にコミットを分け、同じ画面・配布ZIPを更新する3件をまとめました。
>
> - **[#20](record-020.md) 面談カルテ**：基本情報・履歴・テスト表の列・グラフ・メモ欄を選択し、プレビューした内容で印刷。選択はこの利用中のみ保持し、成績データは変更しません。
> - **[#21](record-021.md) 比較対象**：種類と単元名／試験シリーズを画面・Excelから登録。過去の同じ教科から比較相手を選択・解除できます。単元・未分類等は自動比較せず、期末等は同じ種類・系列を使います。満点の違いは得点率に揃え、比較人数・相手名を表示。個人推移と支援は種類で絞り込め、新しい支援記録は対象種類を保持します。既存JSONの種類を名前から推測しません。
> - **[#22](record-022.md) 保存方法**：保存ボタン／Ctrl・Cmd+Sから、上書き・名前を付けて保存・ダウンロードを選択。対応ブラウザではfile://でも保存先を選べます。保存先の指定はこの利用中だけ保持し、書き込み完了後に保存済みとします。取消・拒否・失敗や保存中の追加変更を保持。初回に上書き先を選ぶ場合も外部更新を確認します。API非対応時はダウンロードを使い、利用者が保存先で確認してから保存済みとします。
> - 説明・記入例と配布ZIPを更新。18ファイルのオフライン構成を維持し、利用者にサーバー起動やターミナル操作は求めません。
>
> 確認済み（最新head: `9014a8e82da709e4014f5feea2205ac7db27ef61`）：
> - 単体テスト **115件成功**。表示項目、種類別・手動比較、得点率、0点・欠席・未入力、JSON v1〜v3、保存の取消・失敗・外部変更・追加編集・ダウンロード確認を検証。
> - 配布ZIPを展開し、file://・ネットワーク無効のChromiumで、通常のブラウザ検証 **40件**＋初回登録など **15件成功**。JavaScript実行エラー・外部通信なし。
> - Linuxの画面付きChromiumと実際のOS保存ダイアログで、オフラインのHTMLからJSON作成・上書き・別名保存・外部更新時の中止・ダイアログ取消を検証（**5件成功**）。保存した実ファイルの内容と元ファイルの保持を確認。ブラウザが提供する保存先選択APIをそのまま使用しています。
> - `npm run build` / `npm run check` 成功。配布ZIPとソース18ファイルの一致を確認。
> - Codex Reviewの「初回上書きでも外部更新を確認する」という指摘を修正し、回帰テストを追加。
>
> 成功したGitHub Actions：
> 当時の自動テスト実行 40063192120（公開ログなし）
>
> Closes [#20](record-020.md)
> Closes [#21](record-021.md)
> Closes [#22](record-022.md)

<a id="issuecomment-6379761578"></a>

## コメント 2026-10-24 13:17:48 JST

投稿者：`chatgpt-codex-connector[bot]`

最終更新：2026-10-24 13:19:37 JST

> ## Codex Review Summary
>
> This comment shows the latest Codex review activity on this pull request.
>
> | Review | Status | Commit | Review trigger |
> | --- | --- | --- | --- |
> | 📝 **Code Review** | ✅ **Completed** 2026-10-24 13:19:37 JST | `a471e07` | PR opened |

<a id="discussion_r4365962461"></a>

## コードへの指摘 2026-10-24 13:19:34 JST

投稿者：`chatgpt-codex-connector[bot]`

最終更新：2026-10-24 13:19:35 JST

対象ファイル：`src/files/script.js`

対象コミット：[a471e07cfc59](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/a471e07cfc591352971f2b2896e75d93ad6b197d)

> **P2  Check for external changes on the first local overwrite**
>
> When a JSON is opened through the file input—the normal `file://` flow—`fileHandle` is null, so the first overwrite selects a target through the picker and skips the external-change check in the `else` branch. If another teacher has updated the original JSON since it was opened, selecting that file overwrites their changes without the application's conflict warning, even though `lastDiskText` retains the originally loaded contents. Check the selected existing target before creating the writable stream, including this first-overwrite path.

<details>
<summary>指摘時のコード周辺</summary>

````diff
@@ -564,60 +657,98 @@ function applyJsonText(text, name, handle) {
   }
 }

-async function saveJson() {
-  if (!data) return;
+function canPickSaveFile() {
+  return window.isSecureContext !== false && typeof window.showSaveFilePicker === 'function';
+}
+
+function openSaveDialog() {
+  if (!data || saving) return;
+  const supported = canPickSaveFile();
+  $('saveOverwriteBtn').disabled = !supported;
+  $('saveAsBtn').disabled = !supported;
+  $('saveTarget').textContent = fileHandle ? `上書き先：${fileHandle.name}` : '上書き先は未指定です。最初に既存のJSONを保存先として選択してください。';
+  $('saveCapabilityNote').textContent = supported ?
+    'このブラウザでは保存先を選択できます。初回は書き込み先のJSONを選び、次からは同じファイルへ上書きできます。' :
+    'このブラウザではファイルへの直接保存を利用できません。JSONをダウンロードして保存してください。';
+  $('saveDownloadName').value = fileName || 'seiseki-data.json';
+  $('downloadConfirmBtn').hidden = !pendingDownload;
+  $('saveResult').textContent = pendingDownload ? '先ほどダウンロードしたファイルの保存先と内容を確認してください。' : '';
+  $('saveDialog').showModal();
+}
+
+function setSaveBusy(value) {
+  saving = value;
+  for (const id of ['saveOverwriteBtn', 'saveAsBtn', 'saveDownloadBtn', 'downloadConfirmBtn', 'saveCloseBtn']) {
+    $(id).disabled = value || (['saveOverwriteBtn', 'saveAsBtn'].includes(id) && !canPickSaveFile());
+  }
+}
+
+async function saveJson(mode = 'download') {
+  if (!data || saving) return;
   const validationErrors = validateDataset(data);
-  if (validationErrors.length) {
-    alert('データに問題があるため保存できません。\n\n・' + validationErrors.join('\n・'));
+  if (validationErrors.length) { alert('データに問題があるため保存できません。\n\n・' + validationErrors.join('\n・')); return; }
+  const text = JSON.stringify(data, null, 2);
+  const token = activeDataToken;
+  if (mode === 'download') {
+    const name = $('saveDownloadName').value.trim();
+    if (!name || /[\\/:*?"<>|]/.test(name)) { $('saveResult').textContent = 'ファイル名を入力してください。記号 \\ / : * ? " < > | は使えません。'; return; }
+    const blob = new Blob([text], { type: 'application/json' });
+    const a = document.createElement('a');
+    a.href = URL.createObjectURL(blob); a.download = /\.json$/i.test(name) ? name : name + '.json';
+    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
+    pendingDownload = { text, token };
+    $('downloadConfirmBtn').hidden = false;
+    $('saveResult').textContent = 'ダウンロードを開始しました。保存されたJSONを確認してください。';
+    $('saveStatus').textContent = 'JSONを出力しました。保存先でファイルを確認してください。';
     return;
   }
-  const text = JSON.stringify(data, null, 2);
-  if (supportsFS) {
-    try {
-      if (!fileHandle) {
-        fileHandle = await window.showSaveFilePicker({
-          suggestedName: fileName || 'seiseki-data.json',
-          types: FILE_TYPES,
-        });
-        fileName = fileHandle.name;
-        $('datasetName').textContent = `${data.name || ''}（${fileName}）`;
-      } else {
-        // 共有ファイルの上書き事故防止：開いた時から他者が更新していないか確認
-        let diskNow = null;
-        try {
-          diskNow = await (await fileHandle.getFile()).text();
-        } catch { /* 読めない場合は検知をスキップ */ }
-        if (diskNow != null && diskNow !== lastDiskText) {
-          const ok = confirm(
-            'このファイルは、あなたが開いたあとに別の人が更新しています。\n' +
-            'このまま保存すると、その人の入力が消える可能性があります。\n\n' +
-            '［OK］あなたの内容で上書きする\n' +
-            '［キャンセル］保存をやめる（先にファイルを開き直して、最新を確認してください）'
-          );
-          if (!ok) return;
-        }
+  if (!canPickSaveFile()) { $('saveResult').textContent = '直接保存を利用できません。JSONをダウンロードしてください。'; return; }
+  setSaveBusy(true);
+  let writable;
+  try {
+    let target = mode === 'overwrite' ? fileHandle : null;
+    if (!target) {
+      const suggestedName = mode === 'as' ? (fileName || 'seiseki-data.json').replace(/\.json$/i, '') + '_copy.json' : fileName || 'seiseki-data.json';
+      target = await window.showSaveFilePicker({ suggestedName, types: FILE_TYPES });
+      if (mode === 'as') {
+        const same = fileHandle && typeof target.isSameEntry === 'function' ? await target.isSameEntry(fileHandle) :
+          target.name.toLowerCase() === (fileName || '').toLowerCase();
+        if (same) { $('saveResult').textContent = '元のファイルを残すため、別のファイル名または保存先を選んでください。'; return; }
       }
-      const writable = await fileHandle.createWritable();
-      await writable.write(text);
-      await writable.close();
-      dirty = false;
-      lastDiskText = text;  // 保存した内容を新たな基準に
-      updateSaveStatus(true);
-    } catch (e) {
-      if (e.name !== 'AbortError') alert('保存に失敗しました: ' + e.message);
+    } else {
+      if (typeof target.requestPermission === 'function' && await target.requestPermission({mode:'readwrite'}) !== 'granted') {
+        $('saveResult').textContent = '書き込みが許可されませんでした。作業中のデータは保持しています。'; return;
+      }
+      const diskNow = await (await target.getFile()).text();
````

</details>

<a id="pullrequestreview-5636800772"></a>

## レビュー 2026-10-24 13:19:34 JST

投稿者：`chatgpt-codex-connector[bot]`

レビュー状態：`COMMENTED`

対象コミット：[a471e07cfc59](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/a471e07cfc591352971f2b2896e75d93ad6b197d)

> ### 💡 Codex Review
>
> Here are some automated review suggestions for this pull request.
>
> **Reviewed commit:** `a471e07cfc`
