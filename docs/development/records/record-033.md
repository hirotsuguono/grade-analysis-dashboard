# PR 33 v0.4.0: バージョン表示と更新案内を追加し、配布ZIPを更新

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-25 17:03:32 JST |
| 最終更新日時 | 2026-10-27 09:05:24 JST |
| 保存時点の状態 | マージ済み |
| 終了日時 | 2026-10-26 08:03:20 JST |
| マージ時のコミット | [cd386e87b931](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/cd386e87b931ab8186fea0f30d68410cce7311cd) |

## 最初の説明

> ローカルで使うアプリから、現在のバージョン・最新版の配布先・成績データを引き継ぐ更新手順を確認できます。フッターは小さな見出しと横並びのリンクにまとめ、狭い画面ではボタンを縦に配置します。
>
> - 「GitHubで最新版を確認」から正式配布版のZIPと変更履歴へ、「GitHubのプロジェクトを見る」からリポジトリへ進めます。どちらも別タブで開きます。
> - アプリとパッケージのバージョンを正式版 `0.4.0` に統一しました。
> - 折りたたみの更新案内と使い方ガイドに、JSON保存 → ZIPを別フォルダへ全展開 → 新しいIndex.htmlを開く → JSONを読み込む、の手順を記載しました。キーボードでも操作でき、印刷物には表示しません。file://・オフライン利用を維持します。
> - 配布ZIPを最新のsrcへ同期しました。CIでは通常の `npm run check` でコミット済みZIPを照合し、一時ZIPを再生成してバイト単位で一致することも確認します。ブラウザは実際の配布ZIPを展開して検証します。
>
> 確認済み（head `145a17d5cd8b65c76afb5f91074bd52110c5e755`）：
> - 単体140件、file://・ネットワーク無効のブラウザ62件、実ファイル保存5件が成功。
> - `npm run build`・`npm run check` 成功。22ファイルのソース一致・ローカル参照・ライセンス・架空サンプルを検証し、別途再生成したZIPとも完全一致。
> - 320/390/1280pxの表示、リンク先・別タブ設定、44px以上の操作領域、キーボード操作、未保存データ保持、JSONの別フォルダへの引き継ぎ、印刷時非表示を確認。JavaScriptエラー・外部通信なし。
>
> 成功したActions：当時の自動テスト実行 40242761557（公開ログなし）
>
> Closes [#32](record-032.md)

<a id="issuecomment-6395183929"></a>

## コメント 2026-10-25 17:03:43 JST

投稿者：`chatgpt-codex-connector[bot]`

最終更新：2026-10-25 17:05:04 JST

> ## Codex Review Summary
>
> This comment shows the latest Codex review activity on this pull request.
>
> | Review | Status | Commit | Review trigger |
> | --- | --- | --- | --- |
> | 📝 **Code Review** | ✅ **Completed** 2026-10-25 17:05:03 JST | `458378f` | PR opened |

<a id="discussion_r4370111566"></a>

## コードへの指摘 2026-10-25 17:05:01 JST

投稿者：`chatgpt-codex-connector[bot]`

対象ファイル：`.github/workflows/offline-tests.yml`

対象コミット：[458378f54f4b](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/458378f54f4b242c698a664ac1f7d2b632bb21b8)

> **P1  Restore verification of the checked-in distribution ZIP**
>
> The workflow now checks only a ZIP freshly generated from `src/`, so it no longer detects a stale checked-in distribution. This commit already leaves `downloads/grade-analysis-dashboard.zip` out of sync: the default `npm run check` fails with `Stale or changed ZIP entry: grade-analysis-dashboard/Index.html`, and users following the README's fallback download link receive an app without the new version display and update guidance. Restore validation of the checked-in ZIP and synchronize that artifact with the source; verifying a temporary candidate can remain an additional check.
>
> AGENTS.md reference: [AGENTS.md:L8-L8](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/458378f54f4b242c698a664ac1f7d2b632bb21b8/AGENTS.md#L8-L8)

<details>
<summary>指摘時のコード周辺</summary>

````diff
@@ -42,13 +42,14 @@ jobs:
       - name: Run unit tests
         run: npm test

-      - name: Verify distribution ZIP and build
+      - name: Build and verify a candidate ZIP without changing the distributed ZIP
         run: |
-          npm run check
           npm run build -- --output "$RUNNER_TEMP/grade-analysis-dashboard.zip"
+          npm run check -- --output "$RUNNER_TEMP/grade-analysis-dashboard.zip"
+          git diff --exit-code -- downloads/
````

</details>

<a id="pullrequestreview-5642175407"></a>

## レビュー 2026-10-25 17:05:01 JST

投稿者：`chatgpt-codex-connector[bot]`

レビュー状態：`COMMENTED`

対象コミット：[458378f54f4b](https://github.com/hirotsuguono/grade-analysis-dashboard/commit/458378f54f4b242c698a664ac1f7d2b632bb21b8)

> ### 💡 Codex Review
>
> Here are some automated review suggestions for this pull request.
>
> **Reviewed commit:** `458378f54f`
