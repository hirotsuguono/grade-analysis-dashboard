# Issue 2 [P1候補] クラス名・支援基準値がHTMLへ未エスケープで挿入される

[開発記録の一覧へ](../README.md)

| 項目 | 内容 |
| --- | --- |
| 投稿者 | `hirotsuguono` |
| 作成日時 | 2026-10-16 21:05:50 JST |
| 最終更新日時 | 2026-10-18 07:43:01 JST |
| 保存時点の状態 | クローズ |
| 終了日時 | 2026-10-18 07:43:01 JST |

## 最初の説明

> ## 検証範囲
> 2026-10-16に、配布ZIPから抽出した元の関数・式をNode.jsで架空データのみ使って実行。検証した `script.js` は登録時の `main` の `src/files/script.js` とGit blob SHAが一致（`c225f798914539be53096619bdee24ceb7a26271`）。ブラウザ・DOM・画面操作は未検証。
>
> ## 再現手順・実際の結果
> 1. 架空4人を2クラスに分け、100点満点の得点を20・30／70・80とする。
> 2. 低得点側のクラス名を `<img src=x onerror="alert(1)">` とする。有効な支援記録の `baseline` にも同じ文字列を設定する。
> 3. 元の `validateDataset` とクラス間差KPI・支援記録のHTML生成式を抽出して実行する。
> 4. 検証エラーは空配列。クラス名は `small` 内、baselineは `<td><img src=x onerror="alert(1)">%</td>` として未エスケープで残る。
>
> ## 期待・影響
> クラス名は文字として表示し、baselineは有限数値またはnullに限定する。現状は表示改変と、イベント属性が実行される環境でのスクリプト実行につながる潜在リスクがある。確認できたのはHTML文字列構築までで、ブラウザでのXSS発火・実際の悪用可能性は未検証。P1は潜在リスクを踏まえた候補。
>
> ## 該当箇所
> - クラス名・KPI生成：[src/files/script.js:775–792](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L775-L792)
> - 支援記録検証：[src/files/script.js:461–465](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L461-L465)
> - baselineのHTML出力：[src/files/script.js:2430–2440](https://github.com/hirotsuguono/grade-analysis-dashboard/blob/main/src/files/script.js#L2430-L2440)
>
> ## 修正案・受入条件
> 動的テキストは `esc` または `textContent` で扱い、baselineの型・許容範囲を検証する。
> - [ ] タグを含むクラス名を文字として表示する。
> - [ ] 非数値のbaselineを読み込み反映前に拒否する。
> - [ ] HTMLタグ・イベント属性を含む架空入力の回帰テストを追加し、ブラウザでの安全な表示も確認する。
