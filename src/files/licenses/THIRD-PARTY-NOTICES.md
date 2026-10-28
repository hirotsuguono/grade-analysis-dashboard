# 成績分析ダッシュボード：第三者ライセンス

ライブラリ本体と以下の全文ライセンス・NOTICEを同梱しています。配布用ZIPの `files/vendor/` に全文、`files/licenses/` にこの案内があります。

アプリ本体のMITライセンスは、以下の第三者ライブラリのライセンスを置き換えるものではありません。各ライブラリには、それぞれの全文ライセンスとNOTICEが適用されます。

| Component | Version | License | Included notices |
| --- | --- | --- | --- |
| Apache ECharts | 6.1.0 | Apache-2.0 and notices in its LICENSE | `../vendor/echarts.LICENSE`, `../vendor/echarts.NOTICE` |
| SheetJS Community Edition | 0.20.3 | Apache-2.0 | `../vendor/sheetjs.LICENSE` |
| ExcelJS (browser distribution) | 4.4.0 | MIT and bundled dependency notices | `../vendor/exceljs.LICENSE`, `../vendor/exceljs.BUNDLED-LICENSES.txt` |

Apache ECharts: Copyright 2017–2026 The Apache Software Foundation. The bundled distribution includes code covered by the additional notices in its full LICENSE, including zrender. The original distribution header is retained. [Release source](https://github.com/apache/echarts/tree/6.1.0).

SheetJS CE: Copyright SheetJS LLC and contributors. The original distribution header is retained. [Official standalone distribution](https://docs.sheetjs.com/docs/getting-started/installation/standalone/).

ExcelJS: Copyright Guyon Roche and contributors. The unmodified browser distribution writes the template formatting, validation and frozen panes. Its original notices are retained, and dependency license texts are included separately. [Release source](https://github.com/exceljs/exceljs/tree/v4.4.0).

ライブラリは同梱されており、実行時にCDNから取得しません。

ExcelJS 4.4.0 の公式 npm browser bundle とバイト一致を確認しています。内蔵 JSZip は **3.10.1**（ライセンス選択 MIT）、core-js は **3.33.0**（MIT）です。実行時の依存解決結果ではなく、配布バンドルのヘッダー・ソースマップ・ソース本文を確認しています。依存ライセンス全文は `exceljs.BUNDLED-LICENSES.txt` を参照してください。

ECharts 6.1.0 は Lines 系列の tooltip に関する既知修正を含みます（[Apache の告知](https://lists.apache.org/thread/1g6xk7gd9vg1c6zyqqt2lnko10zomc3o)、[修正](https://github.com/apache/echarts/pull/21608)）。本アプリがその発生条件に該当することは確認されていません。アプリでは tooltip を richText に固定しています。

補足のサーバー依存ライセンス一覧にある解決版は、ブラウザ同梱版の一覧ではありません。バンドルと照合できた Day.js は **1.11.10**、util は **0.10.4** です。実体で検証した版と補足資料を区別し、依存解決だけで同梱版を推測しません。
