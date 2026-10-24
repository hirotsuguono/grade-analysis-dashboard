# 成績分析ダッシュボード：第三者ライセンス

ライブラリ本体と以下の全文ライセンス・NOTICEを同梱しています。配布用ZIPの `files/vendor/` に全文、`files/licenses/` にこの案内があります。

アプリ本体のMITライセンスは、以下の第三者ライブラリのライセンスを置き換えるものではありません。各ライブラリには、それぞれの全文ライセンスとNOTICEが適用されます。

| Component | Version | License | Included notices |
| --- | --- | --- | --- |
| Apache ECharts | 5.5.1 | Apache-2.0 and notices in its LICENSE | `../vendor/echarts.LICENSE`, `../vendor/echarts.NOTICE` |
| SheetJS Community Edition | 0.20.3 | Apache-2.0 | `../vendor/sheetjs.LICENSE` |
| ExcelJS (browser distribution) | 4.4.0 | MIT and bundled dependency notices | `../vendor/exceljs.LICENSE`, `../vendor/exceljs.BUNDLED-LICENSES.txt` |

Apache ECharts: Copyright 2017–2024 The Apache Software Foundation. The bundled distribution includes code covered by the additional notices in its full LICENSE, including zrender. The original distribution header is retained. [Release source](https://github.com/apache/echarts/tree/5.5.1).

SheetJS CE: Copyright SheetJS LLC and contributors. The original distribution header is retained. [Official standalone distribution](https://docs.sheetjs.com/docs/getting-started/installation/standalone/).

ExcelJS: Copyright Guyon Roche and contributors. The unmodified browser distribution writes the template formatting, validation and frozen panes. Its original notices are retained, and dependency license texts are included separately. [Release source](https://github.com/exceljs/exceljs/tree/v4.4.0).

ライブラリは同梱されており、実行時にCDNから取得しません。
