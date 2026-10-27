# PR 15 ブラウザテスト失敗時のログをActions画面に表示

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-22 10:51:39 JST |
| 最終更新日時 | 2026-10-22 10:55:02 JST |
| 保存時点の状態 | マージ済み |
| 終了日時 | 2026-10-22 10:54:33 JST |
| マージ時のコミット | [c04b5cfaea90](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/c04b5cfaea90943662dbd9b50e9a3f9c4890598a) |

## 最初の説明

> オフラインブラウザテストの結果ファイルが生成されなかった場合に、実行ログの末尾35行をGitHub Actionsのエラー注釈へ表示します。ログがない場合や正常終了時の集計も確認し、注釈内の改行・パーセント記号をエスケープします。
>
> 確認済み（head SHA: `d5ef4eed943cd05ea265c63c7516c608def7073e`）：
> - ワークフローYAMLと埋め込みPythonの構文確認
> - 正常終了・片方の結果欠損・両方の結果欠損・ログ欠損の4ケースが成功
> - ログ末尾35行の抽出と注釈のエスケープを確認
> - 単体テスト83件成功
> - 配布ZIPのオフラインブラウザ検証36件＋13件成功
> - ZIPのビルド・ソースとの整合性確認が成功
> - push・PR両方のChecksが成功
> - 最新headに対するCodexレビューが指摘なしで完了
>
> GitHub Actions：
> 当時の自動テスト実行 39708106344（公開ログなし）

<a id="issuecomment-6330759463"></a>

## コメント 2026-10-22 10:51:48 JST

投稿者：`chatgpt-codex-connector[bot]`

最終更新：2026-10-22 10:53:19 JST

> ## Codex Review Summary
>
> This comment shows the latest Codex review activity on this pull request.
>
> | Review | Status | Commit | Review trigger |
> | --- | --- | --- | --- |
> | 📝 **Code Review** | ✅ **Completed** 2026-10-22 10:53:18 JST | `d5ef4ee` | PR opened |
