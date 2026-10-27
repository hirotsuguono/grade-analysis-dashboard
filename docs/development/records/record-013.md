# PR 13 未完成の全教科合計を推移と平均から除外

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-18 16:56:07 JST |
| 最終更新日時 | 2026-10-19 05:12:21 JST |
| 保存時点の状態 | マージ済み |
| 終了日時 | 2026-10-19 05:12:16 JST |
| マージ時のコミット | [95e89d32a398](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/95e89d32a398d9553b55c879862c23032c98aa3c) |

## 最初の説明

> 同じ回の全教科について出席・入力が揃った生徒だけ、全教科合計の推移とクラス平均へ含めます。一覧と推移で完成判定を共通化し、欠席者の保持得点や未入力を除外しながら、出席者の0点は有効として扱います。
>
> 確認済み（head SHA: `206e78d04f30966762d08832b0044a020add423b`）：
> - 単体テスト79件成功（失敗0件）
> - 部分合計、未入力、欠席の保持得点、0点、回ごと・クラスごとの完成判定を検証
> - 入力完了・欠席切替後の再集計と、JSON保存・再読込後の欠席得点除外・復元を検証
> - 配布ZIPのfile://・オフラインブラウザ検証35件＋13件成功
> - 起動時の復旧案内、欠席集計、支援効果の回の対応、全教科合計の回帰テストが成功
> - ZIPのビルド・ソースとの整合性確認が成功
>
> GitHub Actions（Ubuntu / Chromium）：
> 当時の自動テスト実行 39161939463（公開ログなし）
>
> Closes [#5](record-005.md)

<a id="issuecomment-6247365468"></a>

## コメント 2026-10-18 16:56:14 JST

投稿者：`chatgpt-codex-connector[bot]`

最終更新：2026-10-18 16:58:18 JST

> ## Codex Review Summary
>
> This comment shows the latest Codex review activity on this pull request.
>
> | Review | Status | Commit | Review trigger |
> | --- | --- | --- | --- |
> | 📝 **Code Review** | ✅ **Completed** 2026-10-18 16:58:18 JST | `ebc0e2d` | PR opened |
