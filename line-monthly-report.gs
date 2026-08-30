/**
 * PLUSa 月末LINEレポート拡張
 * 既存のGoogle Apps Scriptプロジェクトへ、このファイルの内容を追加して使います。
 * 秘密情報はHTMLやスプレッドシートへ書かず、スクリプトプロパティへ保存してください。
 */

var PLUS_A_LINE_ENDPOINT = "https://api.line.me/v2/bot/message/push";
var PLUS_A_TIMEZONE = "Asia/Tokyo";

/** 毎日21時ごろに月末判定を行うトリガーを1つだけ作成します。 */
function setupPlusAMonthlyLineTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "runPlusAMonthlyLineReport") ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("runPlusAMonthlyLineReport").timeBased().everyDays(1).atHour(21).create();
}

/** 時間主導トリガーから呼ばれ、月末だけ1回送信します。 */
function runPlusAMonthlyLineReport() {
  var now = new Date();
  var tomorrow = new Date(now.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.getMonth() === now.getMonth()) return;
  sendPlusAMonthlyLineReport_(now, false);
}

/** 初期設定時のテスト送信用です。実行すると現在月のレポートをLINEへ送ります。 */
function testPlusAMonthlyLineReport() {
  return sendPlusAMonthlyLineReport_(new Date(), true);
}

/** 送信せず、現在月の本文だけログで確認できます。 */
function previewPlusAMonthlyLineReport() {
  var text = buildPlusAMonthlyLineReport_(new Date());
  console.log(text);
  return text;
}

function sendPlusAMonthlyLineReport_(targetDate, force) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("LINE_CHANNEL_ACCESS_TOKEN");
  var to = props.getProperty("LINE_TO");
  if (!token || !to) throw new Error("スクリプトプロパティ LINE_CHANNEL_ACCESS_TOKEN と LINE_TO を設定してください。");

  var monthKey = Utilities.formatDate(targetDate, PLUS_A_TIMEZONE, "yyyy-MM");
  if (!force && props.getProperty("LINE_LAST_SENT_MONTH") === monthKey) return "already-sent";

  var response = UrlFetchApp.fetch(PLUS_A_LINE_ENDPOINT, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({ to: to, messages: [{ type: "text", text: buildPlusAMonthlyLineReport_(targetDate) }] }),
    muteHttpExceptions: true
  });
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error("LINE送信に失敗しました（" + status + "）：" + response.getContentText());
  props.setProperty("LINE_LAST_SENT_MONTH", monthKey);
  return "sent";
}

function buildPlusAMonthlyLineReport_(targetDate) {
  var year = Number(Utilities.formatDate(targetDate, PLUS_A_TIMEZONE, "yyyy"));
  var month = Number(Utilities.formatDate(targetDate, PLUS_A_TIMEZONE, "M"));
  var summary = readPlusAMonthSummary_(year, month);
  return "【プラスエー 勤務レポート】\n" + year + "年" + month + "月\n\n" +
    "出勤日数：" + summary.days + "日\n" +
    "勤務時間：" + summary.hours.toFixed(1) + "時間\n" +
    "給与見込み：" + Math.round(summary.pay).toLocaleString("ja-JP") + "円\n\n" +
    "今月もおつかれさまでした 🌷";
}

function readPlusAMonthSummary_(year, month) {
  var props = PropertiesService.getScriptProperties();
  var spreadsheetId = props.getProperty("SPREADSHEET_ID");
  var book = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error("スプレッドシートを特定できません。SPREADSHEET_ID を設定してください。");

  var sheet = findPlusARecordSheet_(book);
  if (!sheet) throw new Error("勤務記録のシートが見つかりません。1行目に date（日付）、hours（勤務時間）、pay（給与）の見出しが必要です。");
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { days: 0, hours: 0, pay: 0 };

  var headers = values[0].map(function (value) { return String(value).trim().toLowerCase(); });
  var dateIndex = findPlusAHeader_(headers, ["date", "日付", "勤務日"]);
  var hoursIndex = findPlusAHeader_(headers, ["hours", "勤務時間", "時間"]);
  var payIndex = findPlusAHeader_(headers, ["pay", "給与", "給料", "支給額"]);
  var days = 0, hours = 0, pay = 0;

  values.slice(1).forEach(function (row) {
    var date = parsePlusADate_(row[dateIndex]);
    if (!date) return;
    var rowYear = Number(Utilities.formatDate(date, PLUS_A_TIMEZONE, "yyyy"));
    var rowMonth = Number(Utilities.formatDate(date, PLUS_A_TIMEZONE, "M"));
    if (rowYear !== year || rowMonth !== month) return;
    days += 1;
    hours += Number(row[hoursIndex]) || 0;
    pay += Number(row[payIndex]) || 0;
  });
  return { days: days, hours: hours, pay: pay };
}

function findPlusARecordSheet_(book) {
  var sheets = book.getSheets();
  for (var i = 0; i < sheets.length; i += 1) {
    var lastColumn = sheets[i].getLastColumn();
    if (!lastColumn) continue;
    var headers = sheets[i].getRange(1, 1, 1, lastColumn).getValues()[0].map(function (value) { return String(value).trim().toLowerCase(); });
    if (findPlusAHeader_(headers, ["date", "日付", "勤務日"]) >= 0 &&
        findPlusAHeader_(headers, ["hours", "勤務時間", "時間"]) >= 0 &&
        findPlusAHeader_(headers, ["pay", "給与", "給料", "支給額"]) >= 0) return sheets[i];
  }
  return null;
}

function findPlusAHeader_(headers, candidates) {
  for (var i = 0; i < candidates.length; i += 1) {
    var index = headers.indexOf(candidates[i]);
    if (index >= 0) return index;
  }
  return -1;
}

function parsePlusADate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  var text = String(value || "").trim();
  var match = text.match(/(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  var parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}
