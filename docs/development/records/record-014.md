# PR 14 Excel日付の検証を初回登録と新規テスト取込で統一

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-18 16:56:11 JST |
| 最終更新日時 | 2026-10-19 05:16:05 JST |
| 保存時点の状態 | マージ済み |
| 終了日時 | 2026-10-19 05:16:01 JST |
| マージ時のコミット | [2aa27a122787](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/2aa27a12278709fc3a1218e1608cf4a506e74407) |

## 最初の説明

> Excelの日付番号も実在する暦日か検証し、初回登録と新規テスト取込で日付番号0・60などの不正な日付を拒否します。時刻付きの値は日付部分を使用し、不正な取込では既存の未保存データを変更しません。
>
> 確認済み（head SHA: `2d7517950661d8fdbe6b6f76ef74af01b1f6a27c`）：
> - 単体テスト83件成功（失敗0件）
> - 日付番号0・60、不正な日付、非有限値の拒否と、時刻付き日付・うるう日の扱いを検証
> - 初回登録と新規テスト取込の正規化結果、不正入力時のデータ保持、有効な0点の保持を検証
> - 配布ZIPのfile://・オフラインブラウザ検証36件＋13件成功
> - 起動時の復旧案内、欠席集計、支援効果、全教科合計、Excel日付検証の回帰テストがすべて成功
> - ZIPのビルド・ソースとの整合性確認が成功
>
> GitHub Actions（Ubuntu / Chromium）：
> 当時の自動テスト実行 39162324115（公開ログなし）
>
> Closes [#7](record-007.md)

<a id="issuecomment-6247366263"></a>

## コメント 2026-10-18 16:56:20 JST

投稿者：`chatgpt-codex-connector[bot]`

最終更新：2026-10-18 16:59:10 JST

> ## Codex Review Summary
>
> This comment shows the latest Codex review activity on this pull request.
>
> | Review | Status | Commit | Review trigger |
> | --- | --- | --- | --- |
> | 📝 **Code Review** | ✅ **Completed** 2026-10-18 16:59:09 JST | `dd9b41f` | PR opened |
