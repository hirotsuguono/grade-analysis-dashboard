# Issue 3 [P2] 欠席へ変更した生徒の残存回答が設問・分野統計に含まれる

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-16 21:05:55 JST |
| 最終更新日時 | 2026-10-19 04:16:29 JST |
| 保存時点の状態 | クローズ |
| 終了日時 | 2026-10-19 04:16:29 JST |

## 最初の説明

> ## 検証範囲
> 2026-10-16に、配布ZIPから抽出した元の関数・式をNode.jsで架空データのみ使って実行。検証した `script.js` は登録時の `main` の `src/files/script.js` とGit blob SHAが一致（`c225f798914539be53096619bdee24ceb7a26271`）。ブラウザ・DOM・画面操作は未検証。
>
> ## 再現手順
> 1. 100点満点の1問・1分野を作り、架空A=100、架空B=0とする。
> 2. Aに元ソースの欠席チェック分岐を適用する。`absent=true`、`total=null` となるが、`questions.q1=100` と `domains.d1=100` は保持される。
> 3. この状態で元の設問・分野集計式を実行する。データ検証は正常通過する。
>
> ## 期待／実際
> 期待：欠席Aを除外し、設問・分野平均はいずれも0%。Bの0点は有効値として残る。
> 実際：いずれも50%。回答の有無だけで集計し、`absent` を除外していない。
> 総点と設問・分野で欠席の扱いが食い違い、分析結果が誤る。
>
> ## 該当箇所
> - 欠席処理：[src/files/script.js:1053–1055](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L1053-L1055)
> - 分野集計：[src/files/script.js:843–847](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L843-L847)
> - 設問集計：[src/files/script.js:1507–1509](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L1507-L1509)、[src/files/script.js:1546–1549](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L1546-L1549)
>
> ## 修正案・受入条件
> 設問・分野・箱ひげ・推移・前後比較で欠席除外判定を共通化する。復元用の回答保持は維持してよい。
> - [ ] 欠席オン／オフで全統計への採否が一致する。
> - [ ] 上記ケースは欠席時0%、復帰時50%になる。
> - [ ] 0点と未入力を区別し、0点を常に有効値として扱う。
