# PLUSa 勤怠・おしごとアプリ

親子でリアルタイム共有できる、プラスエーの勤務アプリです。

## 主な機能

- 出勤・退勤と手動記録
- 形式の違うGoogleスプレッドシート日付を日本語へ正規化
- 週間・月間の勤務時間、給与、出勤日数の集計
- すぐ送れてすぐ見える「ひとことボード」
- 端末間で共有できるタスクと業務マニュアル
- 月末LINEレポートの作成と自動送信用Google Apps Script

## 同期の仕組み

勤務記録、コメント、タスク、追加マニュアルは既存のGoogle Apps Script APIを通じてGoogleスプレッドシートへ保存します。画面を開いている間は20秒ごとに再同期し、画面へ戻ったときも自動更新します。

タスクと追加マニュアルは、既存バックエンドを変更せず共有できるよう、コメント欄にアプリ専用の更新イベントとして保存します。通常のコメント画面にはシステム用イベントを表示しません。

## LINE月末自動報告の設定

LINE Notifyは終了しているため、LINE Messaging APIのプッシュメッセージを使います。

1. `line-monthly-report.gs` の内容を、現在のGoogle Apps Scriptプロジェクトへ追加します。
2. Apps Scriptの「プロジェクトの設定」→「スクリプト プロパティ」に次を登録します。
   - `LINE_CHANNEL_ACCESS_TOKEN`: LINE Messaging APIのチャネルアクセストークン
   - `LINE_TO`: 送信先のユーザーIDまたはグループID
   - `SPREADSHEET_ID`: スクリプトがスプレッドシートに紐づいていない場合のみ設定
3. `previewPlusAMonthlyLineReport` を実行して本文を確認します。
4. `testPlusAMonthlyLineReport` を実行してテスト送信します。
5. `setupPlusAMonthlyLineTrigger` を一度だけ実行します。以後、毎日21時ごろに月末か判定し、月末だけ1回送信します。

アクセストークンや送信先IDは `index.html`、GitHub、スプレッドシートへ書かないでください。
