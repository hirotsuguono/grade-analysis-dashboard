# Issue 27 [P2] 個人推移で選択中の生徒を名簿から削除すると描画が例外で止まる

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-25 02:13:15 JST |
| 最終更新日時 | 2026-10-25 05:37:27 JST |
| 保存時点の状態 | クローズ |
| 終了日時 | 2026-10-25 05:37:27 JST |

## 最初の説明

> ## 問題
> 個人推移で1名選択したまま、その生徒を名簿管理から削除すると、削除済みIDが選択状態に残り、分野別推移の描画が例外になります。
>
> ## 検証対象
> `feat/issues-20-22` / `9014a8e82da709e4014f5feea2205ac7db27ef61`（PR [#23](record-023.md)）。同コミットの元ソースをNode.jsのVMで実行し、架空データで再現。DOM・グラフ描画はスタブ化しているため、この追加ケースの実ブラウザ操作は未検証です。
>
> ## 再現手順と実際の結果
> 1. 架空生徒2名以上と英語テストを登録する。
> 2. 個人推移で英語を選び、生徒Aだけを選択する。
> 3. 管理者モードの名簿管理からAを削除する。
> 4. 個人推移の再描画が走る。
>
> 元の削除関数から再描画関数を呼び出した結果：
> ```text
> TypeError: Cannot read properties of undefined (reading 'name')
>   at renderTrendDomainChart (script.js:1547)
>   at renderTrend
>   at renderCurrentTab
>   at handleRosterDelete
> ```
> 削除処理自体は先に反映されていますが、`ui.trendSelected` に削除済みIDが残ります。今回のVM検証では `renderAll` のセレクト要素更新だけを省き、`renderCurrentTab → renderTrend → renderTrendDomainChart` は元関数で実行しました。
>
> ## 原因
> [removeStudentData](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/9014a8e82da709e4014f5feea2205ac7db27ef61/src/files/script.js#L2692)と[handleRosterDelete](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/9014a8e82da709e4014f5feea2205ac7db27ef61/src/files/script.js#L2755)で選択IDを除去せず、[renderTrendDomainChart](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/9014a8e82da709e4014f5feea2205ac7db27ef61/src/files/script.js#L1537)が生徒の存在を確認しないまま `student.name` を参照します。
>
> ## 期待・受入条件
> - [ ] 生徒削除時に `ui.trendSelected` から対象IDを除去する。
> - [ ] 描画関数側も存在しない選択IDを安全に扱う。
> - [ ] 1名選択中・複数名選択中・最後の生徒の削除を実ブラウザで回帰確認する。
> - [ ] 削除後も他の生徒の選択・推移・カルテ・JSON保存を継続できる。
>
> 同じ症状の既存Issueは見つかりませんでした。
