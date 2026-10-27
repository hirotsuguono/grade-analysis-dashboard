# PR 10 フォルダの移動方法と起動時の復旧案内を追加

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-18 16:55:54 JST |
| 最終更新日時 | 2026-10-18 20:58:16 JST |
| 保存時点の状態 | マージ済み |
| 終了日時 | 2026-10-18 20:58:12 JST |
| マージ時のコミット | [80be04870254](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/80be04870254242cf232ca15a410fa228d42f61a) |

## 最初の説明

> フォルダごとの移動・コピーと、ショートカットの作り方を案内しました。
> HTML単体や必要なファイルが欠けた場合にも、復旧方法を表示します。
>
> 確認済み：
> ・自動テスト55件が成功
> ・フォルダ移動、HTML単体、CSS・JS欠損、JavaScript無効時の検証が成功
> ・配布ZIPのオフライン全体テストと整合性確認が成功
>
> 改善案のため、Issueは自動クローズしません。
> Refs [#1](record-001.md)

<a id="issuecomment-6247364001"></a>

## コメント 2026-10-18 16:56:03 JST

投稿者：`chatgpt-codex-connector[bot]`

最終更新：2026-10-18 16:57:24 JST

> ## Codex Review Summary
>
> This comment shows the latest Codex review activity on this pull request.
>
> | Review | Status | Commit | Review trigger |
> | --- | --- | --- | --- |
> | 📝 **Code Review** | ✅ **Completed** 2026-10-18 16:57:23 JST | `577b771` | PR opened |

<a id="discussion_r4306254259"></a>

## コードへの指摘 2026-10-18 16:57:21 JST

投稿者：`chatgpt-codex-connector[bot]`

対象ファイル：`src/files/onboarding.js`

対象コミット：[577b7715fc34](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/577b7715fc34ef341d1270ccf74b4f23eba39188)

> **P2  Keep recovery help visible when accessibility.js is absent**
>
> If `files/accessibility.js` is missing or fails to execute, the browser continues to `onboarding.js`, every condition here still passes, and the recovery notice is hidden. That asset owns the sample button handler, keyboard tab behavior, ARIA state, and chart data tables, so the resulting installation is visibly incomplete but gives users no missing-file recovery guidance; require an initialization marker from `accessibility.js` before hiding the notice.
>
> AGENTS.md reference: [AGENTS.md:L4-L4](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/577b7715fc34ef341d1270ccf74b4f23eba39188/AGENTS.md#L4-L4)

<details>
<summary>指摘時のコード周辺</summary>

````diff
@@ -131,4 +131,11 @@
   }
   new MutationObserver(updatePrepare).observe(document.body, { childList: true, subtree: true });
   updatePrepare();
+  // 起動処理と同梱の主要資産が揃った場合だけ、HTML内の復旧案内を閉じます。
+  if (document.documentElement.dataset.dashboardInitialized === 'true'
+      && window.echarts && window.XLSX && window.GD_IMPORT && window.GD_INITIAL
+      && window.GRADE_DASHBOARD_SAMPLE
+      && getComputedStyle(document.documentElement).getPropertyValue('--dashboard-style-loaded').trim() === '1') {
````

</details>

<a id="pullrequestreview-5562022981"></a>

## レビュー 2026-10-18 16:57:21 JST

投稿者：`chatgpt-codex-connector[bot]`

レビュー状態：`COMMENTED`

対象コミット：[577b7715fc34](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/577b7715fc34ef341d1270ccf74b4f23eba39188)

> ### 💡 Codex Review
>
> Here are some automated review suggestions for this pull request.
>
> **Reviewed commit:** `577b7715fc`
