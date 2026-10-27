# Issue 7 [P3] Excel日付シリアルの実在日検証を初回・新規テスト取り込みで統一する

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-16 21:06:08 JST |
| 最終更新日時 | 2026-10-19 05:16:02 JST |
| 保存時点の状態 | クローズ |
| 終了日時 | 2026-10-19 05:16:02 JST |

## 最初の説明

> ## 検証範囲
> 2026-10-16に、配布ZIPから抽出した元の関数・式をNode.jsで架空データのみ使って実行。検証した `script.js` は登録時の `main` の `src/files/script.js` とGit blob SHAが一致（`c225f798914539be53096619bdee24ceb7a26271`）。ブラウザ・DOM・画面操作は未検証。
>
> ## 再現手順・実際の結果
> 同梱の実際のSheetJSと、元の `normalizeDateValue` をNode.jsで実行する。
> - 数値 `0` → `1900-01-00`
> - 数値 `60` → `1900-02-29`
> - 通常値 `45000.5` → `2023-03-15`
>
> 文字列経路は実在日を検証するが、数値経路はSheetJSの返値をそのまま文字列化する。新規テスト取り込みは非空の返値を受理する。一方、初回取り込みの `dateValue` は数値変換後にも実在日を確認する。
>
> ## 期待・影響
> 数値由来でも実在しない日付を拒否し、初回取り込みと新規テスト取り込みで扱いを一致させる。現代の通常日付では問題が出にくいため、低優先度の改善候補。
>
> ## 該当箇所
> - 日付正規化：[src/files/script.js:70–81](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L70-L81)
> - 新規テスト取り込み：[src/files/script.js:3039–3046](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L3039-L3046)
> - 初回取り込み：[src/files/initial-import.js:59–76](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/initial-import.js#L59-L76)
>
> `initial-import.js` と同梱SheetJSも、検証ZIPと登録時mainでGit blob SHAが一致することを確認済み。
>
> ## 修正案・受入条件
> 数値・文字列の変換後に共通の実在日検証を適用する。
> - [ ] シリアル0・60を有効な実在日として保存しない。
> - [ ] 数値／文字列と、初回／新規テスト取り込みで検証結果が一致する。
> - [ ] 通常の日付と時刻小数付きシリアルを壊さない回帰テストを追加する。
