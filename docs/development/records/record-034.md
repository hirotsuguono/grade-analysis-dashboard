# PR 34 公開用GitHub Actionsを常設し、検証済みZIPから正式版を公開

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-27 09:16:27 JST |
| 最終更新日時 | 2026-10-27 09:33:37 JST |
| 保存時点の状態 | マージ済み |
| 終了日時 | 2026-10-27 09:21:04 JST |
| マージ時のコミット | [d9b95cfb428e](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/d9b95cfb428e63a4279478380af535334a865ae3) |

## 最初の説明

> リリースごとに一時ワークフローを追加していた公開処理を、mainから手動起動できる「Publish verified release」にします。バージョン・対象コミット・既存Release IDを指定し、既存の単体・オフラインブラウザ・実ファイル保存テストを通過した配布ZIPを、GitHub発行のトークンで添付・正式版／Latestとして公開します。
>
> 既定では検証のみを行い、publish=trueで公開します。公開権限はテスト後のジョブに限定し、対象コミット・タグ・ZIPの一致と公開後の両ダウンロードURLを検証します。説明文とタイトルを保持し、同一リリースの再実行は読み取りのみ、異なる既存ZIPは上書きせず停止します。
>
> 確認済み：リリース処理の18テスト、npm test、配布ZIPの再生成一致・npm run check、actionlint。公開済みv0.4.0の実アセットと公開ダウンロードを、このスクリプトの検証モードでも照合しました。アプリ・README・配布ZIPの変更はありません。

<a id="issuecomment-6430473070"></a>

## コメント 2026-10-27 09:16:36 JST

投稿者：`chatgpt-codex-connector[bot]`

最終更新：2026-10-27 09:17:48 JST

> ## Codex Review Summary
>
> This comment shows the latest Codex review activity on this pull request.
>
> | Review | Status | Commit | Review trigger |
> | --- | --- | --- | --- |
> | 📝 **Code Review** | ✅ **Completed** 2026-10-27 09:17:47 JST | `9c57145` | PR opened |
