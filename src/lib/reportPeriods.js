// AI 日报 / 周报 / 月报 分期归组：纯日期与分组计算，不依赖 React 与数据文件。
// 全部按日期字符串（UTC 零点）运算，与展示时区无关；公开日期未披露的条目不参与归档。

export const REPORT_PERIODS = [
  { id: 'daily', label: '日报' },
  { id: 'weekly', label: '周报' },
  { id: 'monthly', label: '月报' },
];

const DAY_MS = 86400000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validDay(day) {
  if (!DAY_RE.test(day || '')) return false;
  const d = new Date(day + 'T00:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === day;
}

export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 周一为一周开始（ISO 8601）。
export function mondayOf(day) {
  if (!validDay(day)) return '';
  const weekday = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

export function isoWeek(day) {
  if (!validDay(day)) return { year: 0, week: 0 };
  const weekday = (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const thursday = new Date(addDays(day, 3 - weekday) + 'T00:00:00Z');
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(4 - jan4Weekday + 3);
  const week = 1 + Math.round((thursday - firstThursday) / (7 * DAY_MS));
  return { year: thursday.getUTCFullYear(), week };
}

export function isoWeekKey(day) {
  const { year, week } = isoWeek(day);
  return year ? `${year}-W${String(week).padStart(2, '0')}` : '';
}

export function periodKey(period, day) {
  if (!validDay(day)) return '';
  if (period === 'weekly') return isoWeekKey(day);
  if (period === 'monthly') return day.slice(0, 7);
  return day;
}

// 每期的代表日：日=当天，周=周一，月=1 号。用于 URL 锚点与历史列表定位。
export function periodAnchor(period, day) {
  if (!validDay(day)) return '';
  if (period === 'weekly') return mondayOf(day);
  if (period === 'monthly') return day.slice(0, 7) + '-01';
  return day;
}

export function periodRangeText(period, day) {
  if (!validDay(day)) return '';
  const dotted = (s) => s.split('-').join('.');
  if (period === 'weekly') {
    const start = mondayOf(day);
    return `${dotted(start)} — ${dotted(addDays(start, 6))}`;
  }
  if (period === 'monthly') return dotted(day.slice(0, 7));
  return dotted(day);
}

// 由归档条目构建某一期的索引，按期倒序；lead 为该期按 leadSort 排出的首位条目（仅作导航预览，非编辑推荐）。
export function buildPeriodIndex(period, entries, leadSort) {
  const map = new Map();
  for (const entry of entries) {
    const day = entry?.publishedDate;
    if (!validDay(day)) continue;
    const key = periodKey(period, day);
    if (!map.has(key)) map.set(key, { key, anchor: periodAnchor(period, day), items: [] });
    map.get(key).items.push(entry);
  }
  return [...map.values()]
    .map(({ key, anchor, items }) => {
      const sorted = leadSort ? items.slice().sort(leadSort) : items;
      return { key, anchor, count: items.length, lead: sorted[0] || null };
    })
    .sort((a, b) => b.anchor.localeCompare(a.anchor));
}

// 历史列表按月（月报按年）分组；入参须为 buildPeriodIndex 的倒序结果。
export function groupIndexByMonth(index, period) {
  const groups = [];
  const map = new Map();
  for (const row of index) {
    const raw = period === 'monthly' ? row.anchor.slice(0, 4) : row.anchor.slice(0, 7);
    if (!map.has(raw)) {
      map.set(raw, { raw, label: period === 'monthly' ? `${raw}年` : `${raw.slice(0, 4)}年${Number(raw.slice(5, 7))}月`, rows: [] });
      groups.push(map.get(raw));
    }
    map.get(raw).rows.push(row);
  }
  return groups;
}

// 历史行左侧的短标签：日→26日，周→W39，月→9月。
export function periodRowLabel(period, row) {
  if (period === 'weekly') return `W${Number(row.key.slice(6))}`;
  if (period === 'monthly') return `${Number(row.anchor.slice(5, 7))}月`;
  return `${Number(row.anchor.slice(8, 10))}日`;
}
