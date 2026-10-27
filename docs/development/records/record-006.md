# Issue 6 [P2] 支援記録の日付型が未検証で読み込み後の並び替えが例外になる

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-16 21:06:05 JST |
| 最終更新日時 | 2026-10-18 15:57:05 JST |
| 保存時点の状態 | クローズ |
| 終了日時 | 2026-10-18 15:57:05 JST |

## 最初の説明

> ## 検証範囲
> 2026-10-16に、配布ZIPから抽出した元の関数・式をNode.jsで架空データのみ使って実行。検証した `script.js` は登録時の `main` の `src/files/script.js` とGit blob SHAが一致（`c225f798914539be53096619bdee24ceb7a26271`）。ブラウザ・DOM・画面操作は未検証。
>
> ## 再現手順
> 1. 有効な生徒に紐づく支援記録を2件作り、両方 `status="active"`、`startDate` を数値42・43とする。
> 2. 元のデータ検証、読み込み時整理・移行、支援記録の並び替え式を順に実行する。
>
> ## 期待／実際
> 期待：現在のデータを置き換える前に不正な日付型を拒否する。
> 実際：検証エラーなし。整理・移行後も42・43のままで、並び替えが `TypeError: (b.startDate || "").localeCompare is not a function` になる。
> 不正JSONを受理しRTIログ処理が中断する。アプリ全体のUI挙動は未確認。
>
> ## 該当箇所
> - 検証：[src/files/script.js:461–465](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L461-L465)
> - 整理・移行：[src/files/script.js:479–506](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L479-L506)
> - 並び替え：[src/files/script.js:2408–2410](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L2408-L2410)
>
> ## 修正案・受入条件
> `startDate` の型・形式、`status` など支援記録フィールドを検証し、失敗時は既存データを保持する。
> - [ ] 数値・オブジェクト等の不正な日付型を反映前に拒否する。
> - [ ] 正常な支援記録を日付順に並び替えできる。
> - [ ] 不正JSONを読み込んでも既存データが保持されることをブラウザでも確認する。
