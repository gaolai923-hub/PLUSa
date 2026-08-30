"use strict";

var GAS = "https://script.google.com/macros/s/AKfycbwR89VP6Iy3z1QNQ51amRtOKrKFwOy0uK64LS2PjxbtnNdBNpaVKc2d20wOiVbcGMKqLA/exec";
var HDEF = 1200;
var TASK_PREFIX = "__PLUSA_TASK_V1__";
var MANUAL_PREFIX = "__PLUSA_MANUAL_V1__";
var state = {
  inTime: localStorage.getItem("pA_in") || null,
  records: [],
  comments: [],
  rate: parseInt(localStorage.getItem("pA_rate") || HDEF, 10),
  learn: localStorage.getItem("pA_learn") || ""
};
var wOff = 0, mOff = 0, prd = "week", editId = null, loading = false, firstLoad = true;

var DEFAULT_MANUALS = [
  { id: "start", emoji: "🌞", title: "出勤したら最初にすること", body: "1. 元気にあいさつする\n2. モップ・掃除機をかける\n3. 入口を雑巾・ほうきできれいにする\n4. 1階のゴミを2階へ持っていく" },
  { id: "service", emoji: "🛍️", title: "お客さまが来たら", body: "相手の顔を見て、聞こえる声であいさつ。\nお帰りのときは『ありがとうございました！』を丁寧に伝える。" },
  { id: "stock", emoji: "📦", title: "入荷作業", body: "追加商品と新作を分ける。\n伝票の合計と商品の数を確認し、登録のたびに数が増えているかを見る。確認後の伝票はレジ裏へ。" },
  { id: "safety", emoji: "🧤", title: "安全に作業する", body: "機械を使うときは髪を結ぶ。\n分からないことはそのままにせず、社長かママに確認する。" }
];

function $(id) { return document.getElementById(id); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function pad(n) { return String(n).padStart(2, "0"); }
function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
  });
}
function num(value, fallback) {
  var n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function parseYmd(ymd) {
  var m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? null : d;
}
function japanYmd(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  try {
    var parts = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    var found = {};
    parts.forEach(function (part) { found[part.type] = part.value; });
    return found.year + "-" + found.month + "-" + found.day;
  } catch (_) {
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }
}
function normalizeDate(value, fallbackTime) {
  if (value instanceof Date) return japanYmd(value);
  var raw = String(value == null ? "" : value).trim();
  if (/T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    var instant = new Date(raw);
    if (!Number.isNaN(instant.getTime())) return japanYmd(instant);
  }
  var direct = raw.match(/(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/);
  if (direct) return direct[1] + "-" + pad(direct[2]) + "-" + pad(direct[3]);
  if (/^\d{4,6}(?:\.\d+)?$/.test(raw)) {
    var serial = Number(raw);
    if (serial > 20000 && serial < 100000) return japanYmd(new Date(Date.UTC(1899, 11, 30) + serial * 86400000));
  }
  var parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return japanYmd(parsed);
  var fallback = new Date(fallbackTime || "");
  return Number.isNaN(fallback.getTime()) ? "" : japanYmd(fallback);
}
function normalizeDateTime(value, ymd) {
  var raw = String(value == null ? "" : value).trim();
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(raw) && ymd) return new Date(ymd + "T" + raw).toISOString();
  var d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
function normalizeRecord(record, rate) {
  var date = normalizeDate(record.date, record.inTime || record.outTime);
  var inTime = normalizeDateTime(record.inTime, date);
  var outTime = normalizeDateTime(record.outTime, date);
  var hours = num(record.hours, NaN);
  if ((!Number.isFinite(hours) || hours < 0) && inTime && outTime) hours = calcH(inTime, outTime);
  if (!Number.isFinite(hours) || hours < 0) hours = 0;
  var pay = num(record.pay, NaN);
  if (!Number.isFinite(pay) || pay < 0) pay = Math.round(hours * rate);
  return { id: String(record.id || uid()), date: date, inTime: inTime, outTime: outTime, hours: hours, pay: pay, learning: String(record.learning || ""), rawDate: String(record.date || "") };
}
function r30(date) {
  var minute = date.getMinutes(), rounded = minute < 15 ? 0 : minute < 45 ? 30 : 60, next = new Date(date);
  next.setMinutes(rounded, 0, 0);
  return next;
}
function fmtT(value) {
  var raw = String(value || "");
  var simple = raw.match(/(?:T|\s)(\d{1,2}):(\d{2})/);
  var date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return pad(date.getHours()) + ":" + pad(date.getMinutes());
  return simple ? pad(simple[1]) + ":" + simple[2] : "--:--";
}
function fmtD(value) {
  var ymd = normalizeDate(value), date = parseYmd(ymd), days = ["日", "月", "火", "水", "木", "金", "土"];
  if (!date) return "日付を確認してください";
  return (date.getMonth() + 1) + "月" + date.getDate() + "日（" + days[date.getDay()] + "）";
}
function calcH(a, b) { return Math.max(0, (new Date(b) - new Date(a)) / 3600000); }
function dStr(date) { return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()); }
function getMon(value) {
  var date = typeof value === "string" ? parseYmd(normalizeDate(value)) : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  var day = date.getDay(), diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function toast(message) {
  var el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(function () { el.classList.remove("show"); }, 2400);
}
function setSy(kind, message) {
  var el = $("sy");
  el.className = "sy sy-" + kind;
  el.textContent = message;
}

async function apiFetch(url, options) {
  var response = await fetch(url, options);
  if (!response.ok) throw new Error("HTTP " + response.status);
  var text = await response.text();
  return text ? JSON.parse(text) : {};
}
async function loadAll() {
  if (loading) return;
  loading = true;
  setSy("ld", "⟳ 同期中...");
  try {
    var data = await apiFetch(GAS + "?action=getAll&t=" + Date.now(), { method: "GET", redirect: "follow" });
    state.rate = num(data.hourlyRate, state.rate || HDEF);
    state.records = (data.records || []).map(function (record) { return normalizeRecord(record, state.rate); });
    state.records.sort(function (a, b) { return (a.date || "") < (b.date || "") ? -1 : 1; });
    state.comments = (data.comments || []).map(function (comment) {
      return { id: String(comment.id || uid()), who: String(comment.who || "shacho"), text: String(comment.text || ""), time: String(comment.time || new Date().toISOString()) };
    });
    localStorage.setItem("pA_rate", state.rate);
    $("ri").value = state.rate;
    setSy("ok", "✅ 同期済み · " + pad(new Date().getHours()) + ":" + pad(new Date().getMinutes()));
    renderAll();
  } catch (error) {
    setSy("er", "⚠️ オフライン · 再試行します");
    console.error("loadAll error", error);
  } finally {
    loading = false;
    if (firstLoad) {
      firstLoad = false;
      $("lov").style.display = "none";
    }
  }
}
async function apiPost(body) {
  try {
    await apiFetch(GAS, { method: "POST", redirect: "follow", body: JSON.stringify(body) });
    setSy("ok", "✅ 保存・同期済み");
    return true;
  } catch (error) {
    setSy("er", "❌ 保存できませんでした");
    console.error("apiPost error", error);
    toast("通信を確認して、もう一度お試しください");
    return false;
  }
}

function showPg(name) {
  document.querySelectorAll(".pg").forEach(function (page) { page.classList.remove("on"); });
  document.querySelectorAll(".nb").forEach(function (button) { button.classList.toggle("on", button.dataset.page === name); });
  var page = $("pg-" + name);
  if (page) page.classList.add("on");
  if (name === "stats") renderStats();
  if (name === "hist") renderHist();
  if (name === "tasks") renderTasks();
  if (name === "manual") renderManuals();
  if (name === "conf") { $("ri").value = state.rate; renderLineReport(); }
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function renderAll() {
  renderCmts();
  renderHist();
  renderStats();
  renderTasks();
  renderManuals();
  renderToday();
  renderLineReport();
}
function renderToday() {
  var today = dStr(new Date());
  var recs = state.records.filter(function (record) { return record.date === today; });
  var hours = recs.reduce(function (sum, record) { return sum + record.hours; }, 0);
  var pay = recs.reduce(function (sum, record) { return sum + record.pay; }, 0);
  if (recs.length) { $("hd").textContent = hours.toFixed(1); $("pd").textContent = pay.toLocaleString(); }
  var hour = new Date().getHours();
  $("hello").textContent = (hour < 11 ? "おはよう！" : hour < 17 ? "こんにちは！" : "おつかれさま！") + " 今日も楽しくいこう 🌷";
}

function punchIn() {
  var time = r30(new Date());
  state.inTime = time.toISOString();
  localStorage.setItem("pA_in", state.inTime);
  $("bi").disabled = true;
  $("bo").disabled = false;
  $("sb").innerHTML = "🟢 出勤中：<strong>" + fmtT(state.inTime) + "</strong> から";
  toast("✅ 出勤しました！ 今日もよろしくね");
}
async function punchOut() {
  if (!state.inTime) return;
  var time = r30(new Date()), hours = calcH(state.inTime, time), pay = Math.round(hours * state.rate);
  var record = { id: uid(), date: dStr(new Date()), inTime: state.inTime, outTime: time.toISOString(), hours: hours, pay: pay, learning: state.learn || "" };
  state.records.push(record);
  state.inTime = null;
  state.learn = "";
  localStorage.removeItem("pA_in");
  localStorage.removeItem("pA_learn");
  $("lt").value = "";
  $("bi").disabled = false;
  $("bo").disabled = true;
  $("sb").innerHTML = "✅ <strong>" + fmtT(record.inTime) + " 〜 " + fmtT(record.outTime) + "</strong> 退勤完了！";
  toast("🎉 おつかれさま！ " + pay.toLocaleString() + "円");
  renderAll();
  setSy("ld", "⟳ 保存中...");
  await apiPost({ action: "saveRecord", record: record });
}
async function addManual() {
  var date = $("md").value, start = $("mi").value, end = $("mo").value;
  if (!date || !start || !end) return toast("⚠️ 日付・時間をすべて入力してください");
  var inIso = new Date(date + "T" + start + ":00").toISOString();
  var outIso = new Date(date + "T" + end + ":00").toISOString();
  if (new Date(outIso) <= new Date(inIso)) return toast("⚠️ 退勤は出勤より後にしてください");
  var hours = calcH(inIso, outIso), pay = Math.round(hours * state.rate);
  var record = { id: uid(), date: date, inTime: inIso, outTime: outIso, hours: hours, pay: pay, learning: "" };
  state.records.push(record);
  state.records.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  renderAll();
  toast("✅ " + hours.toFixed(1) + "時間を記録しました");
  setSy("ld", "⟳ 保存中...");
  await apiPost({ action: "saveRecord", record: record });
}
function saveLearning() {
  state.learn = $("lt").value.trim();
  localStorage.setItem("pA_learn", state.learn);
  var today = dStr(new Date());
  var todays = state.records.filter(function (record) { return record.date === today; });
  var latest = todays[todays.length - 1];
  if (latest) { latest.learning = state.learn; apiPost({ action: "saveRecord", record: latest }); }
  toast("💡 今日の学びを保存しました");
}

function useQuick(text) {
  var area = $("ct2");
  area.value = text + area.value;
  area.focus();
}
function isSystemComment(comment) { return comment.text.indexOf(TASK_PREFIX) === 0 || comment.text.indexOf(MANUAL_PREFIX) === 0; }
async function postCmt() {
  var who = $("cw").value, text = $("ct2").value.trim();
  if (!text) return toast("メッセージを入力してね");
  var comment = { id: uid(), who: who, text: text, time: new Date().toISOString(), optimistic: true };
  state.comments.push(comment);
  $("ct2").value = "";
  renderCmts();
  setSy("ld", "⟳ 送信中...");
  if (await apiPost({ action: "saveComment", comment: comment })) toast("💌 コメントを送りました");
}
function fmtCommentTime(value) {
  var date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時不明";
  return (date.getMonth() + 1) + "月" + date.getDate() + "日 " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}
function renderCmts() {
  var visible = state.comments.filter(function (comment) { return !isSystemComment(comment); }).slice(-30).reverse();
  if (!visible.length) { $("cl").innerHTML = "<p class='empty'>最初のひとことを送ってみよう 💌</p>"; return; }
  $("cl").innerHTML = visible.map(function (comment) {
    var cls = comment.who === "yuzu" ? "cy" : "cs", name = comment.who === "yuzu" ? "ゆずちゃん" : "社長";
    return "<div class='ci " + cls + (comment.optimistic ? " new" : "") + "'><div class='cm'>" + esc(name) + " · " + esc(fmtCommentTime(comment.time)) + "</div>" + esc(comment.text) + "</div>";
  }).join("");
}
async function saveRate() {
  var value = parseInt($("ri").value, 10);
  if (!Number.isFinite(value) || value < 0) return toast("⚠️ 正しい金額を入力してください");
  state.rate = value;
  localStorage.setItem("pA_rate", value);
  setSy("ld", "⟳ 保存中...");
  await apiPost({ action: "saveSettings", hourlyRate: value });
  renderAll();
  toast("✅ 時給を " + value.toLocaleString() + "円に変更しました");
}

function getMoKeys() {
  var set = new Set(state.records.map(function (record) { return record.date && record.date.slice(0, 7); }).filter(function (key) { return /^\d{4}-\d{2}$/.test(key); }));
  return Array.from(set).sort().reverse();
}
function renderHist() {
  var months = getMoKeys(), tabs = $("mtabs");
  if (!months.length) { tabs.innerHTML = ""; $("msum").innerHTML = ""; $("hl").innerHTML = "<p class='empty'>まだ勤務記録はありません</p>"; return; }
  var active = tabs.dataset.act && months.indexOf(tabs.dataset.act) >= 0 ? tabs.dataset.act : months[0];
  tabs.dataset.act = active;
  tabs.innerHTML = months.map(function (month) {
    var parts = month.split("-");
    return "<button class='tab" + (month === active ? " on" : "") + "' onclick=\"selMo('" + month + "')\">" + parts[0] + "年" + Number(parts[1]) + "月</button>";
  }).join("");
  var records = state.records.filter(function (record) { return record.date && record.date.indexOf(active) === 0; });
  var totalHours = records.reduce(function (sum, record) { return sum + record.hours; }, 0);
  var totalPay = records.reduce(function (sum, record) { return sum + record.pay; }, 0);
  $("msum").innerHTML = records.length ? "<div style='background:var(--bg);border-radius:var(--rs);padding:12px;display:flex;justify-content:space-around;margin-bottom:12px'>" +
    "<div style='text-align:center'><div class='sl'>合計勤務</div><div style='font-size:18px;font-weight:700'>" + totalHours.toFixed(1) + "時間</div></div>" +
    "<div style='text-align:center'><div class='sl'>合計給与</div><div style='font-size:18px;font-weight:700'>" + totalPay.toLocaleString() + "円</div></div>" +
    "<div style='text-align:center'><div class='sl'>出勤日数</div><div style='font-size:18px;font-weight:700'>" + records.length + "日</div></div></div>" : "";
  $("hl").innerHTML = records.slice().reverse().map(function (record) {
    if (!record.date) return "<div class='bad-date'>⚠️ 元データの日付を読み取れませんでした：" + esc(record.rawDate) + "</div>";
    var learning = record.learning ? "<div class='ln'>💡 " + esc(record.learning) + "</div>" : "";
    return "<div class='hi'><div class='hd'>" + esc(fmtD(record.date)) + "<button class='eb' onclick=\"openEd('" + esc(record.id) + "')\">✏️ 編集</button></div>" +
      "<div class='ht'>" + esc(fmtT(record.inTime)) + " 〜 " + esc(fmtT(record.outTime)) + "</div>" +
      "<div class='hr'><span style='color:var(--t2);font-size:13px'>" + record.hours.toFixed(1) + "時間</span><span class='pb2'>" + record.pay.toLocaleString() + "円</span></div>" + learning + "</div>";
  }).join("");
}
function selMo(month) { $("mtabs").dataset.act = month; renderHist(); }
function openEd(id) {
  editId = id;
  var record = state.records.find(function (item) { return item.id === id; });
  if (!record) return;
  $("eed").value = record.date;
  $("eei").value = fmtT(record.inTime);
  $("eeo").value = fmtT(record.outTime);
  $("eel").value = record.learning || "";
  $("em").classList.add("open");
}
function closeMod() { $("em").classList.remove("open"); editId = null; }
async function saveEdit() {
  if (!editId) return;
  var date = $("eed").value, start = $("eei").value, end = $("eeo").value, learning = $("eel").value.trim();
  if (!date || !start || !end) return toast("⚠️ 日付・時間を入力してください");
  var inIso = new Date(date + "T" + start + ":00").toISOString(), outIso = new Date(date + "T" + end + ":00").toISOString();
  if (new Date(outIso) <= new Date(inIso)) return toast("⚠️ 退勤は出勤より後にしてください");
  var hours = calcH(inIso, outIso), updated = { id: editId, date: date, inTime: inIso, outTime: outIso, hours: hours, pay: Math.round(hours * state.rate), learning: learning };
  var index = state.records.findIndex(function (record) { return record.id === editId; });
  state.records[index] = updated;
  state.records.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  closeMod();
  renderAll();
  toast("✅ 勤務記録を更新しました");
  setSy("ld", "⟳ 保存中...");
  await apiPost({ action: "saveRecord", record: updated });
}
async function delRec() {
  if (!editId || !confirm("この勤務記録を削除しますか？")) return;
  var id = editId;
  state.records = state.records.filter(function (record) { return record.id !== id; });
  closeMod();
  renderAll();
  toast("🗑️ 勤務記録を削除しました");
  setSy("ld", "⟳ 保存中...");
  await apiPost({ action: "deleteRecord", id: id });
}

function setPrd(period) {
  prd = period;
  $("pw").classList.toggle("on", period === "week");
  $("pm").classList.toggle("on", period === "month");
  $("sw").style.display = period === "week" ? "" : "none";
  $("sm").style.display = period === "month" ? "" : "none";
  renderStats();
}
function shW(direction) { wOff += direction; renderStats(); }
function shM(direction) { mOff += direction; renderStats(); }
function renderStats() { if (prd === "week") renderW(); else renderMo(); }
function renderW() {
  var monday = getMon(new Date());
  if (!monday) return;
  monday.setDate(monday.getDate() + wOff * 7);
  var sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  $("wl").textContent = (monday.getMonth() + 1) + "/" + monday.getDate() + " 〜 " + (sunday.getMonth() + 1) + "/" + sunday.getDate();
  var names = ["月", "火", "水", "木", "金", "土", "日"], hours = [0, 0, 0, 0, 0, 0, 0], totalHours = 0, totalPay = 0;
  state.records.forEach(function (record) {
    if (!record.date) return;
    var recordDate = parseYmd(record.date), recordMonday = getMon(record.date);
    if (recordDate && recordMonday && dStr(recordMonday) === dStr(monday)) {
      var day = (recordDate.getDay() + 6) % 7;
      hours[day] += record.hours; totalHours += record.hours; totalPay += record.pay;
    }
  });
  $("wh").textContent = totalHours.toFixed(1);
  $("wp").textContent = totalPay.toLocaleString();
  var max = Math.max.apply(null, hours.concat([0.1]));
  $("wb").innerHTML = names.map(function (name, index) {
    var value = hours[index], percent = Math.round(value / max * 100);
    return "<div class='br'><span class='bl2'>" + name + "</span><div class='bt'><div class='bf' style='width:" + percent + "%'>" + (value ? "<span class='bv'>" + value.toFixed(1) + "h</span>" : "") + "</div></div>" + (value ? "" : "<span class='bvo'>—</span>") + "</div>";
  }).join("");
}
function renderMo() {
  var now = new Date(), target = new Date(now.getFullYear(), now.getMonth() + mOff, 1), ym = target.getFullYear() + "-" + pad(target.getMonth() + 1);
  $("ml2").textContent = target.getFullYear() + "年" + (target.getMonth() + 1) + "月";
  var records = state.records.filter(function (record) { return record.date && record.date.indexOf(ym) === 0; });
  var totalHours = records.reduce(function (sum, record) { return sum + record.hours; }, 0), totalPay = records.reduce(function (sum, record) { return sum + record.pay; }, 0);
  $("mh").textContent = totalHours.toFixed(1); $("mp").textContent = totalPay.toLocaleString(); $("mdy").textContent = records.length; $("ma").textContent = (records.length ? totalHours / records.length : 0).toFixed(1);
  var weeks = {};
  records.forEach(function (record) { var date = parseYmd(record.date), key = date ? Math.ceil(date.getDate() / 7) + "週目" : ""; if (key) weeks[key] = (weeks[key] || 0) + record.hours; });
  var keys = Object.keys(weeks).sort(), max = Math.max.apply(null, keys.map(function (key) { return weeks[key]; }).concat([0.1]));
  $("mb").innerHTML = keys.length ? keys.map(function (key) { var value = weeks[key], percent = Math.round(value / max * 100); return "<div class='br'><span class='bl2'>" + key + "</span><div class='bt'><div class='bf' style='width:" + percent + "%'><span class='bv'>" + value.toFixed(1) + "h</span></div></div></div>"; }).join("") : "<p class='empty'>この月の記録はありません</p>";
}

function parseEvents(prefix) {
  var latest = new Map();
  state.comments.forEach(function (comment) {
    if (comment.text.indexOf(prefix) !== 0) return;
    try {
      var payload = JSON.parse(comment.text.slice(prefix.length)), id = payload.taskId || payload.manualId;
      if (!id) return;
      var stamp = new Date(payload.updatedAt || comment.time).getTime() || 0, current = latest.get(id);
      if (!current || stamp >= current.stamp) latest.set(id, { payload: payload, stamp: stamp });
    } catch (_) { /* old free-form comments stay untouched */ }
  });
  return Array.from(latest.values()).map(function (entry) { return entry.payload; });
}
async function saveEvent(prefix, payload) {
  var author = $("cw").value || "shacho";
  var comment = { id: uid(), who: author, text: prefix + JSON.stringify(payload), time: payload.updatedAt || new Date().toISOString(), optimistic: true };
  state.comments.push(comment);
  renderAll();
  setSy("ld", "⟳ 共有中...");
  return apiPost({ action: "saveComment", comment: comment });
}
function taskEvents() { return parseEvents(TASK_PREFIX).filter(function (task) { return !task.archived; }).sort(function (a, b) { return (a.done === b.done ? String(a.due || "9999") > String(b.due || "9999") ? 1 : -1 : a.done ? 1 : -1); }); }
async function addTask() {
  var title = $("task-title").value.trim(), due = $("task-due").value || dStr(new Date()), assignee = $("task-who").value;
  if (!title) return toast("タスクの内容を入力してね");
  $("task-title").value = "";
  var task = { taskId: uid(), title: title, due: due, assignee: assignee, done: false, archived: false, updatedAt: new Date().toISOString() };
  await saveEvent(TASK_PREFIX, task);
  toast("✅ タスクをみんなに共有しました");
}
async function toggleTask(id) {
  var task = taskEvents().find(function (item) { return item.taskId === id; });
  if (!task) return;
  task.done = !task.done; task.updatedAt = new Date().toISOString();
  await saveEvent(TASK_PREFIX, task);
  toast(task.done ? "🎉 おつかれさま！ 完了しました" : "タスクを未完了に戻しました");
}
async function archiveTask(id) {
  var task = taskEvents().find(function (item) { return item.taskId === id; });
  if (!task || !confirm("このタスクを一覧から消しますか？")) return;
  task.archived = true; task.updatedAt = new Date().toISOString();
  await saveEvent(TASK_PREFIX, task);
  toast("タスクを一覧から消しました");
}
function renderTasks() {
  var tasks = taskEvents(), open = tasks.filter(function (task) { return !task.done; }), today = dStr(new Date());
  $("task-count").textContent = open.length + "件";
  $("today-task-note").textContent = open.length ? "未完了のタスクが " + open.length + "件あります。タスク欄で確認しよう ✅" : "未完了のタスクはありません。準備ばっちり！ ✨";
  $("task-list").innerHTML = tasks.length ? tasks.map(function (task) {
    var who = task.assignee === "yuzu" ? "ゆずちゃん" : task.assignee === "shacho" ? "社長" : "ふたり", overdue = task.due && task.due < today && !task.done;
    return "<div class='task-row" + (task.done ? " done" : "") + "'><input class='task-check' type='checkbox' aria-label='" + esc(task.title) + "を完了' " + (task.done ? "checked" : "") + " onchange=\"toggleTask('" + esc(task.taskId) + "')\"><div><div class='task-title'>" + esc(task.title) + "</div><div class='task-meta'>" + esc(who) + " · " + (overdue ? "⚠️ 期限 " : "期限 ") + esc(fmtD(task.due)) + "</div></div><button class='icon-btn' onclick=\"archiveTask('" + esc(task.taskId) + "')\" aria-label='タスクを消す'>×</button></div>";
  }).join("") : "<p class='empty'>まだタスクはありません。最初のおしごとを追加しよう 🌱</p>";
}

function manualEvents() { return parseEvents(MANUAL_PREFIX).filter(function (manual) { return !manual.archived; }).sort(function (a, b) { return String(a.title).localeCompare(String(b.title), "ja"); }); }
async function addManualEntry() {
  var title = $("manual-title").value.trim(), body = $("manual-body").value.trim();
  if (!title || !body) return toast("項目名と手順を入力してね");
  $("manual-title").value = ""; $("manual-body").value = "";
  await saveEvent(MANUAL_PREFIX, { manualId: uid(), title: title, body: body, emoji: "📝", archived: false, updatedAt: new Date().toISOString() });
  toast("📚 マニュアルをみんなに共有しました");
}
async function archiveManual(id) {
  var manual = manualEvents().find(function (item) { return item.manualId === id; });
  if (!manual || !confirm("このマニュアルを一覧から消しますか？")) return;
  manual.archived = true; manual.updatedAt = new Date().toISOString();
  await saveEvent(MANUAL_PREFIX, manual);
  toast("マニュアルを一覧から消しました");
}
function renderManuals() {
  var custom = manualEvents(), manuals = DEFAULT_MANUALS.concat(custom);
  $("manual-list").innerHTML = manuals.map(function (manual) {
    var remove = manual.manualId ? "<button class='icon-btn' style='margin-left:auto' onclick=\"archiveManual('" + esc(manual.manualId) + "')\" aria-label='マニュアルを消す'>×</button>" : "";
    return "<article class='manual-card'><div class='manual-title'><span>" + esc(manual.emoji || "📝") + "</span><span>" + esc(manual.title) + "</span>" + remove + "</div><div class='manual-body'>" + esc(manual.body) + "</div></article>";
  }).join("");
}

function currentMonthSummary() {
  var now = new Date(), ym = now.getFullYear() + "-" + pad(now.getMonth() + 1), records = state.records.filter(function (record) { return record.date && record.date.indexOf(ym) === 0; });
  return { year: now.getFullYear(), month: now.getMonth() + 1, days: records.length, hours: records.reduce(function (sum, record) { return sum + record.hours; }, 0), pay: records.reduce(function (sum, record) { return sum + record.pay; }, 0) };
}
function lineReportText() {
  var summary = currentMonthSummary();
  return "【プラスエー 勤務レポート】\n" + summary.year + "年" + summary.month + "月\n\n出勤日数：" + summary.days + "日\n勤務時間：" + summary.hours.toFixed(1) + "時間\n給与見込み：" + summary.pay.toLocaleString() + "円\n\n今月もおつかれさまでした 🌷";
}
function renderLineReport() { if ($("report-preview")) $("report-preview").textContent = lineReportText(); }
async function copyLineReport() {
  var text = lineReportText();
  try { await navigator.clipboard.writeText(text); }
  catch (_) {
    var area = document.createElement("textarea"); area.value = text; area.style.position = "fixed"; area.style.opacity = "0"; document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove();
  }
  toast("📋 LINE用レポートをコピーしました");
}

function init() {
  var now = new Date(), days = ["日", "月", "火", "水", "木", "金", "土"];
  $("dt").textContent = now.getFullYear() + "年" + (now.getMonth() + 1) + "月" + now.getDate() + "日（" + days[now.getDay()] + "）";
  $("md").value = dStr(now); $("task-due").value = dStr(now); $("ri").value = state.rate;
  if (state.inTime) { $("bi").disabled = true; $("bo").disabled = false; $("sb").innerHTML = "🟢 出勤中：<strong>" + fmtT(state.inTime) + "</strong> から"; }
  if (state.learn) $("lt").value = state.learn;
  $("lov-msg").textContent = "みんなのデータを同期中...";
  setTimeout(function () { if (firstLoad) { $("lov").style.display = "none"; firstLoad = false; } }, 10000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) loadAll(); });
  window.addEventListener("focus", function () { loadAll(); });
  setInterval(function () { if (!document.hidden) loadAll(); }, 20000);
  renderTasks(); renderManuals(); renderLineReport();
  loadAll();
}

init();
