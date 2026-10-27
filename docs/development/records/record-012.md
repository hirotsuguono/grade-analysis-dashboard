# PR 12 支援効果の計算で参照する回のずれを修正

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-18 16:56:03 JST |
| 最終更新日時 | 2026-10-19 05:07:00 JST |
| 保存時点の状態 | マージ済み |
| 終了日時 | 2026-10-19 05:06:52 JST |
| マージ時のコミット | [e914e95c54c1](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/e914e95c54c1ef213b76621a66b3d809ca38d593) |

## 最初の説明

> 空の回をグラフから除外しても、本人の直近得点と同じ回のクラスのばらつきを使って支援効果を計算します。表示する回と効果量計算に使うクラス分布の対応を揃えます。
>
> 確認済み（head SHA: `8ec3168ec9f7e6e7948579df1ae34eb43365f531`）：
> - 単体テスト75件成功（失敗0件）
> - 空の回が先頭・途中・末尾にある場合、人数不足、分散0、本人の直近回より後にクラスの得点がある場合を検証
> - 配布ZIPのfile://・オフラインブラウザ検証34件＋13件成功
> - 起動時の復旧案内、欠席者の集計除外、支援効果の回の対応に関する回帰テストが成功
> - ZIPのビルド・ソースとの整合性確認が成功
>
> GitHub Actions（Ubuntu / Chromium）：
> 当時の自動テスト実行 39158135379（公開ログなし）
>
> Closes [#4](record-004.md)

<a id="issuecomment-6247365024"></a>

## コメント 2026-10-18 16:56:11 JST

投稿者：`chatgpt-codex-connector[bot]`

最終更新：2026-10-18 16:57:25 JST

> ## Codex Review Summary
>
> This comment shows the latest Codex review activity on this pull request.
>
> | Review | Status | Commit | Review trigger |
> | --- | --- | --- | --- |
> | 📝 **Code Review** | ✅ **Completed** 2026-10-18 16:57:25 JST | `5e54a1c` | PR opened |
