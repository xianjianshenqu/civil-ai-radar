import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_PERIODS,
  addDays,
  buildPeriodIndex,
  groupIndexByMonth,
  isoWeekKey,
  mondayOf,
  periodAnchor,
  periodKey,
  periodRangeText,
  periodRowLabel,
  validDay,
} from '../src/lib/reportPeriods.js';

const byPublish = (a, b) => (b.publishSort || 0) - (a.publishSort || 0);

test('validDay 只接受真实日历日', () => {
  assert.equal(validDay('2026-09-26'), true);
  assert.equal(validDay('2026-02-30'), false);
  assert.equal(validDay('2026-9-6'), false);
  assert.equal(validDay(''), false);
  assert.equal(validDay(undefined), false);
});

test('addDays 跨月进位', () => {
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-09-26', -6), '2026-09-20');
});

test('mondayOf 返回所在周的周一', () => {
  assert.equal(mondayOf('2026-09-26'), '2026-09-21'); // 周六
  assert.equal(mondayOf('2026-09-21'), '2026-09-21'); // 周一本身
  assert.equal(mondayOf('2027-01-01'), '2026-12-28'); // 跨年周
  assert.equal(mondayOf('bad'), '');
});

test('isoWeekKey 符合 ISO 8601（周一为一周开始）', () => {
  assert.equal(isoWeekKey('2026-01-01'), '2026-W01'); // 元旦恰为周四
  assert.equal(isoWeekKey('2026-09-26'), '2026-W39');
  assert.equal(isoWeekKey('2027-01-01'), '2026-W53'); // 2026 年有 53 周
  assert.equal(isoWeekKey(''), '');
});

test('periodKey / periodAnchor 三种口径', () => {
  assert.equal(periodKey('daily', '2026-09-26'), '2026-09-26');
  assert.equal(periodKey('weekly', '2026-09-26'), '2026-W39');
  assert.equal(periodKey('monthly', '2026-09-26'), '2026-09');
  assert.equal(periodKey('weekly', ''), '');
  assert.equal(periodAnchor('weekly', '2026-09-26'), '2026-09-21');
  assert.equal(periodAnchor('monthly', '2026-09-26'), '2026-09-01');
  assert.equal(periodAnchor('daily', '2026-09-26'), '2026-09-26');
});

test('periodRangeText 输出报头日期区间', () => {
  assert.equal(periodRangeText('daily', '2026-09-26'), '2026.09.26');
  assert.equal(periodRangeText('weekly', '2026-09-26'), '2026.09.21 — 2026.09.27');
  assert.equal(periodRangeText('weekly', '2027-01-01'), '2026.12.28 — 2027.01.03');
  assert.equal(periodRangeText('monthly', '2026-09-26'), '2026.09');
});

test('buildPeriodIndex 按周归组、跳过未披露日期、按期倒序并给出 lead', () => {
  const entries = [
    { id: 'a', title: '甲', publishedDate: '2026-09-22', publishSort: 3 },
    { id: 'b', title: '乙', publishedDate: '2026-09-25', publishSort: 1 }, // 与甲同周
    { id: 'c', title: '丙', publishedDate: '2026-09-15', publishSort: 9 }, // 上一周
    { id: 'd', title: '丁', publishedDate: '' }, // 未披露
    { id: 'e', title: '戊', publishedDate: '2026-08-02', publishSort: 2 },
  ];
  const index = buildPeriodIndex('weekly', entries, byPublish);
  assert.deepEqual(index.map((p) => p.key), ['2026-W39', '2026-W38', '2026-W31']);
  assert.equal(index[0].anchor, '2026-09-21');
  assert.equal(index[0].count, 2);
  assert.equal(index[0].lead.id, 'a'); // publishSort 3 > 1
  assert.equal(index[1].lead.id, 'c');
  assert.equal(index.reduce((n, p) => n + p.count, 0), 4); // 未披露日期的“丁”不进入任何一期
});

test('buildPeriodIndex 月报口径', () => {
  const entries = [
    { id: 'a', title: '甲', publishedDate: '2026-09-01', publishSort: 1 },
    { id: 'b', title: '乙', publishedDate: '2026-09-30', publishSort: 5 },
    { id: 'c', title: '丙', publishedDate: '2026-08-15', publishSort: 9 },
  ];
  const index = buildPeriodIndex('monthly', entries, byPublish);
  assert.deepEqual(index.map((p) => p.key), ['2026-09', '2026-08']);
  assert.equal(index[0].count, 2);
  assert.equal(index[0].lead.id, 'b');
  assert.equal(index[0].anchor, '2026-09-01');
});

test('groupIndexByMonth 日报按月分组、月报按年分组', () => {
  const daily = buildPeriodIndex('daily', [
    { id: 'a', publishedDate: '2026-09-26', publishSort: 1 },
    { id: 'b', publishedDate: '2026-09-03', publishSort: 1 },
    { id: 'c', publishedDate: '2026-08-20', publishSort: 1 },
  ]);
  const dailyGroups = groupIndexByMonth(daily, 'daily');
  assert.deepEqual(dailyGroups.map((g) => g.label), ['2026年9月', '2026年8月']);
  assert.equal(dailyGroups[0].rows.length, 2);

  const monthly = buildPeriodIndex('monthly', [
    { id: 'a', publishedDate: '2026-09-10', publishSort: 1 },
    { id: 'b', publishedDate: '2025-12-10', publishSort: 1 },
  ]);
  const monthlyGroups = groupIndexByMonth(monthly, 'monthly');
  assert.deepEqual(monthlyGroups.map((g) => g.label), ['2026年', '2025年']);
});

test('periodRowLabel 历史行短标签', () => {
  assert.equal(periodRowLabel('daily', { key: '2026-09-26', anchor: '2026-09-26' }), '26日');
  assert.equal(periodRowLabel('weekly', { key: '2026-W09', anchor: '2026-02-23' }), 'W9');
  assert.equal(periodRowLabel('monthly', { key: '2026-09', anchor: '2026-09-01' }), '9月');
});

test('REPORT_PERIODS 覆盖日/周/月三种口径', () => {
  assert.deepEqual(REPORT_PERIODS.map((p) => p.id), ['daily', 'weekly', 'monthly']);
  assert.deepEqual(REPORT_PERIODS.map((p) => p.label), ['日报', '周报', '月报']);
});
