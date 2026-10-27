# Issue 5 [P2] 全教科推移で一部教科だけの点を完成した合計と比較している

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-16 21:06:02 JST |
| 最終更新日時 | 2026-10-19 05:12:18 JST |
| 保存時点の状態 | クローズ |
| 終了日時 | 2026-10-19 05:12:18 JST |

## 最初の説明

> ## 検証範囲
> 2026-10-16に、配布ZIPから抽出した元の関数・式をNode.jsで架空データのみ使って実行。検証した `script.js` は登録時の `main` の `src/files/script.js` とGit blob SHAが一致（`c225f798914539be53096619bdee24ceb7a26271`）。ブラウザ・DOM・画面操作は未検証。
>
> ## 再現手順
> 1. 同じ回に数学・英語の各100点テストを作る。
> 2. 架空Aは数学80、英語未入力。架空Bは数学80、英語80とする。
> 3. 元の `trendAxis` と一覧の `listCell` を実行する。
>
> ## 期待／実際
> 期待：未完成の合計を完成した合計と同じ尺度で扱わない。一覧同様に欠損扱いなら、完成者だけの平均は160。
> 実際：推移はA=80、B=160、クラス平均120。同じAの一覧合計は空欄で、集計規則が異なる。
> 未入力・欠席が成績低下に見え、クラス平均も下がるおそれがある。
>
> ## 該当箇所
> - 推移：[src/files/script.js:1303–1309](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L1303-L1309)、[src/files/script.js:1350–1354](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L1350-L1354)
> - 整合させる一覧実装：[src/files/script.js:2013–2022](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L2013-L2022)
>
> ## 修正案・受入条件
> 一覧の完全性・欠席判定を共通化する。部分合計を残す設計なら明示的に区別し、完成合計の平均には混ぜない。
> - [ ] 同じ集計対象の推移と一覧で合計の扱いが一致する。
> - [ ] 上記ケースで未完成のAが完成合計の平均に混ざらない。
> - [ ] 未入力と実際の0点を区別する。
