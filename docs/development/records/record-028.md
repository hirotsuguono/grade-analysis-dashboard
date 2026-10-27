# Issue 28 [P3] 5段階アンケートで画面入力・貼り付け・JSONは小数を受理しExcel取込と不一致

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-25 02:13:22 JST |
| 最終更新日時 | 2026-10-25 05:37:27 JST |
| 保存時点の状態 | クローズ |
| 終了日時 | 2026-10-25 05:37:27 JST |

## 最初の説明

> ## 問題
> 5段階アンケートはExcel取込では1〜5の整数に限定されますが、画面入力では2.5などの小数が保存され、JSON検証も通ります。クロス集計で本来ない回答カテゴリーが作られる可能性があります。
>
> ## 検証対象
> `feat/issues-20-22` / `9014a8e82da709e4014f5feea2205ac7db27ef61`（PR [#23](record-023.md)）。同コミットの元ソースをNode.jsのVMで実行し、架空データで再現。DOM・グラフ描画はスタブ化しているため、この追加ケースの実ブラウザ操作は未検証です。
>
> ## 再現手順と実際の結果
> 1. 種類が `scale` の架空5段階アンケートを作り、ある生徒の回答を2とする。
> 2. 画面入力と同じ `handleMetricInput` に2.5を渡す。
> 3. 保存前検証と、同じ値のExcel取込検証を実行する。
>
> 実行結果：
> - 画面入力：既存の2が2.5に更新される。
> - `validateDataset`：エラーなし。
> - `GD_IMPORT.parseMetricRows`：「1〜5の整数に修正してください。」と拒否。
>
> ## 原因
> [handleMetricInput](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/9014a8e82da709e4014f5feea2205ac7db27ef61/src/files/script.js#L1997)・[handleMetricPaste](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/9014a8e82da709e4014f5feea2205ac7db27ef61/src/files/script.js#L2019)・[JSON検証](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/9014a8e82da709e4014f5feea2205ac7db27ef61/src/files/script.js#L547)が範囲だけを確認し、整数判定をしていません。貼り付け経路はコード確認のみです。Excel取込の `import-core.js` は `Number.isInteger` を確認しています。
>
> ## 期待・受入条件
> - [ ] scaleの画面入力・貼り付け・JSON・Excel取込すべてで1〜5の整数というルールを揃える。
> - [ ] 不正な小数入力では既存の回答を保持する。
> - [ ] 未回答と整数1〜5を引き続き利用できる。
> - [ ] 種類がnumberの指標では小数を引き続き利用できる。
>
> 同じ症状の既存Issueは見つかりませんでした。
