# Issue 26 [P2] 設問に未入力が残っていても部分合計を入力済みの得点として集計する

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-25 02:13:10 JST |
| 最終更新日時 | 2026-10-25 05:37:26 JST |
| 保存時点の状態 | クローズ |
| 終了日時 | 2026-10-25 05:37:26 JST |

## 最初の説明

> ## 問題
> 1問でも入力すると、残りの未入力を含む部分合計が完成した得点として平均・得点率・支援判定に使われます。空欄を未入力とする説明に対し、統計上は残りを0点と同じ扱いにしています。
>
> ## 検証対象
> `feat/issues-20-22` / `9014a8e82da709e4014f5feea2205ac7db27ef61`（PR [#23](record-023.md)）。同コミットの元ソースをNode.jsのVMで実行し、架空データで再現。DOM・グラフ描画はスタブ化しているため、この追加ケースの実ブラウザ操作は未検証です。
>
> ## 再現手順と実際の結果
> 1. 100点満点、読解分野100点、問1・問2各50点のテストを作る。
> 2. 架空生徒の問1に50点を入力し、問2は未入力のままにする。
> 3. 入力状況と支援判定を確認する。
>
> `recalcScore`・`renderInput`・`rtiRateFor` の実行結果：
> - `questions = {q1: 50}`（q2は存在しない）
> - `total = 50`、`domains = {読解: 50}`
> - 入力状況は「入力済」としてカウント。
> - RTIの判定値は50%。
> - `validateDataset` はエラーなし。
>
> ## 原因
> [recalcScore](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/9014a8e82da709e4014f5feea2205ac7db27ef61/src/files/script.js#L308)は空欄を飛ばし、1問でも値があれば合計を確定します。[入力済人数](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/9014a8e82da709e4014f5feea2205ac7db27ef61/src/files/script.js#L1110)と[RTI](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/9014a8e82da709e4014f5feea2205ac7db27ef61/src/files/script.js#L2411)はtotalの有無のみで採用します。[新規テストExcel取込](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/9014a8e82da709e4014f5feea2205ac7db27ef61/src/files/script.js#L3268)にも同様の部分合計処理があります。
>
> ## 期待・受入条件
> - [ ] 入力途中と入力完了を区別し、未完成の合計を完成した成績と混ぜない。
> - [ ] 部分合計を画面に表示する場合は「入力途中」と明示し、全問の得点率・支援判定へそのまま使わない。
> - [ ] 50点＋空欄と、50点＋明示的な0点を区別する。
> - [ ] 問題単位の入力・Excel取込・分野集計で扱いを揃える。
> - [ ] 問題別入力を使わない合計点のみのテストは従来どおり利用できる。
>
> 既存 [#5](record-005.md) は全教科合計の欠損です。本件は1つのテスト内の設問欠損で、修正済みの [#5](record-005.md) とは対象が異なります。部分得点を保持する現行仕様は維持しつつ、統計への採否を整理する必要があります。
