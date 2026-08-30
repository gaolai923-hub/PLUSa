const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("app.js", "utf8").replace(/\ninit\(\);\s*$/, "");
const element = () => ({
  value: "",
  textContent: "",
  innerHTML: "",
  dataset: {},
  style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  focus() {}
});
const elements = new Map();
const context = vm.createContext({
  console,
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    querySelectorAll() { return []; },
    addEventListener() {},
    hidden: false
  },
  window: { scrollTo() {}, addEventListener() {} },
  navigator: {},
  setTimeout,
  clearTimeout,
  setInterval() {},
  confirm() { return true; }
});
vm.runInContext(source, context);

assert.equal(context.normalizeDate("Sun Jul 19 2026 00:00:00 GMT+0900"), "2026-07-19");
assert.equal(context.normalizeDate("2026/7/9"), "2026-07-09");
assert.equal(context.normalizeDate("2026-07-19T15:00:00.000Z"), "2026-07-20");
assert.equal(context.fmtD("2026-08-30"), "8月30日（日）");
assert.equal(context.dStr(context.getMon("2026-08-30")), "2026-08-24");

const roundedDown = context.r10(new Date(2026, 7, 30, 9, 4, 59));
const roundedUp = context.r10(new Date(2026, 7, 30, 9, 5, 0));
const roundedHour = context.r10(new Date(2026, 7, 30, 9, 56, 0));
assert.equal(roundedDown.getHours(), 9);
assert.equal(roundedDown.getMinutes(), 0);
assert.equal(roundedUp.getHours(), 9);
assert.equal(roundedUp.getMinutes(), 10);
assert.equal(roundedHour.getHours(), 10);
assert.equal(roundedHour.getMinutes(), 0);

const record = context.normalizeRecord({
  id: 1,
  date: "Sun Jul 19 2026 00:00:00 GMT+0900",
  inTime: "2026-07-19T05:30:00.000Z",
  outTime: "2026-07-19T07:30:00.000Z",
  hours: "2",
  pay: "2400"
}, 1200);
assert.equal(record.date, "2026-07-19");
assert.equal(record.hours, 2);
assert.equal(record.pay, 2400);

context.state.comments = [
  { id: "a", who: "shacho", time: "2026-08-30T09:00:00Z", text: context.TASK_PREFIX + JSON.stringify({ taskId: "t1", title: "掃除", due: "2026-08-30", done: false, updatedAt: "2026-08-30T09:00:00Z" }) },
  { id: "b", who: "yuzu", time: "2026-08-30T10:00:00Z", text: context.TASK_PREFIX + JSON.stringify({ taskId: "t1", title: "掃除", due: "2026-08-30", done: true, updatedAt: "2026-08-30T10:00:00Z" }) }
];
assert.equal(context.taskEvents().length, 1);
assert.equal(context.taskEvents()[0].done, true);

console.log("PLUSa logic tests passed");
