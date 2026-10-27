# PR 11 欠席者の保持得点を統計から除外

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-18 16:55:59 JST |
| 最終更新日時 | 2026-10-19 04:16:32 JST |
| 保存時点の状態 | マージ済み |
| 終了日時 | 2026-10-19 04:16:27 JST |
| マージ時のコミット | [2df3f304fb99](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/2df3f304fb9999315aa2c17ed93114b4d49f61bd) |

## 最初の説明

> 欠席者の復元用得点を、分野・設問の平均や全教科合計の推移などの集計から除外します。問題別得点の保持と欠席解除時の復元を維持し、出席者の0点は有効として扱います。
>
> 確認済み（head SHA: `293cb7b2d4f1b18cae3232a7982a22b13c483a32`）：
> - 単体テスト63件成功（失敗0件）
> - 配布ZIPを展開したアプリのfile://・オフラインブラウザ検証33件＋13件成功
> - 起動時の復旧案内と欠席集計の回帰テストが両方成功
> - JSON v1〜v3の保存・再読込、欠席解除時の得点復元、0点の扱いを検証
> - ZIPのビルド・ソースとの整合性確認が成功
>
> GitHub Actions（Ubuntu / Chromium）：
> 当時の自動テスト実行 39126414464（公開ログなし）
>
> Closes [#3](record-003.md)

<a id="issuecomment-6247364548"></a>

## コメント 2026-10-18 16:56:07 JST

投稿者：`chatgpt-codex-connector[bot]`

最終更新：2026-10-18 16:59:21 JST

> ## Codex Review Summary
>
> This comment shows the latest Codex review activity on this pull request.
>
> | Review | Status | Commit | Review trigger |
> | --- | --- | --- | --- |
> | 📝 **Code Review** | ✅ **Completed** 2026-10-18 16:59:20 JST | `93ca6d5` | PR opened |

<a id="discussion_r4306260256"></a>

## コードへの指摘 2026-10-18 16:59:18 JST

投稿者：`chatgpt-codex-connector[bot]`

対象ファイル：`src/files/script.js`

対象コミット：[93ca6d557f63](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/93ca6d557f63fc951cf97634d7c73f64318e376b)

> **P2  Filter absences from the all-subject trend too**
>
> When a loaded JSON record has both `absent: true` and a retained non-null `total`, the subject-specific trend now excludes it, but selecting 「全教科合計」 still reaches the `SUM_KEY` branch, which reads each record with `getScore` and adds that total. This makes the same absent score reappear in the student's combined trend; use the attended-score filtering in that branch as well.

<details>
<summary>指摘時のコード周辺</summary>

````diff
@@ -1330,7 +1336,7 @@ function trendAxis() {
     labels: tests.map(termKeyOf),
     yName: '得点',
     valueOf: (sid) => tests.map((t) => {
-      const r = getScore(sid, t.id);
+      const r = getAttendedScore(sid, t.id);
````

</details>

<a id="pullrequestreview-5562029215"></a>

## レビュー 2026-10-18 16:59:18 JST

投稿者：`chatgpt-codex-connector[bot]`

レビュー状態：`COMMENTED`

対象コミット：[93ca6d557f63](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/93ca6d557f63fc951cf97634d7c73f64318e376b)

> ### 💡 Codex Review
>
> Here are some automated review suggestions for this pull request.
>
> **Reviewed commit:** `93ca6d557f`
