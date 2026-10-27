# Issue 25 [P2] 同名テストを日付と逆順に登録すると未来のテストを比較対象にする

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-25 02:13:04 JST |
| 最終更新日時 | 2026-10-25 05:37:26 JST |
| 保存時点の状態 | クローズ |
| 終了日時 | 2026-10-25 05:37:26 JST |

## 最初の説明

> ## 問題
> 同じ教科・学年・テスト名の記録を実施日と逆順に登録すると、「過去のテスト」の判定が登録順になり、未来のテストとの比較を許してしまいます。Excel取込では同名テストを別テストとして追加する操作が許可されています。
>
> ## 検証対象
> `feat/issues-20-22` / `9014a8e82da709e4014f5feea2205ac7db27ef61`（PR [#23](record-023.md)）。同コミットの元ソースをNode.jsのVMで実行し、架空データで再現。DOM・グラフ描画はスタブ化しているため、この追加ケースの実ブラウザ操作は未検証です。
>
> ## 再現手順と実際の結果
> 1. 英語・2年・「架空テスト」・期末テスト・100点満点として、7月1日実施のテストを先に登録する。
> 2. 同じ名称・教科・学年・種類で、5月1日実施のテストを後から登録する（比較系列は両方空欄）。
> 3. 自動比較を確認する。
>
> 元関数で確認した結果：
> - 5月の `comparisonTarget` が7月を返す。
> - 7月の比較対象はなし。
> - 7月から5月へ正しい過去比較を `compareTo` に設定しても、`validateDataset` が「比較対象は過去のテストを指定してください。」で拒否する。
>
> ## 原因
> [termKeyOf / termOrderedList](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/9014a8e82da709e4014f5feea2205ac7db27ef61/src/files/script.js#L205)が「学年＋名前」だけで回をまとめ、[sortTestsByTerm / comparisonCandidates](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/9014a8e82da709e4014f5feea2205ac7db27ef61/src/files/script.js#L231)は同一キー内で実施日を比較していません。[JSON検証](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/9014a8e82da709e4014f5feea2205ac7db27ef61/src/files/script.js#L505)にも同じ順序を使用します。
>
> ## 期待・受入条件
> - [ ] 比較候補は個々のテストの実施日も考慮し、未来を過去として扱わない。
> - [ ] 同名・異日付のテストを逆順に取り込んでも、7月から5月へ比較できる。
> - [ ] 正しい比較設定を保存・再読込できる。
> - [ ] 全教科の同じ回をまとめる既存機能は保ち、比較対象の時間順判定と混同しない。
>
> #21の比較機能に関する具体的な境界条件の不具合です。
