// 情报抽取规则（纯代码，无模型）：只从已入库的标题、摘要与段落原文中截取字面片段，
// 不推断、不补全、不外推。所有输出都是「待回链确认」的假设线索，不构成参与或采购证明。
// 中文单位名与金额/截止提取都限定在正文已存在的内容里，用于新买家发现与机器提取展示。

// 公告类型三分道：招标类=可行动窗口，结果类=落地事实，其余（更正/废标/流标等）单独观察。
const TENDER_TYPES = /招标公告|竞争性磋商|竞争性谈判|询价|单一来源|意向公开|预公示|磋商公告|谈判公告/;
const RESULT_TYPES = /中标公告|成交公告|中标结果|成交结果|结果公示|结果公告/;

export function classifyNotice(noticeType, title = '') {
  const haystack = `${noticeType || ''} ${title}`;
  if (RESULT_TYPES.test(haystack)) return 'result';
  if (TENDER_TYPES.test(haystack)) return 'tender';
  if (/更正|变更|废标|流标|终止|延期/.test(haystack)) return 'other';
  return noticeType || title ? 'other' : '';
}

export const NOTICE_CLASS_LABELS = {tender: '招标窗口', result: '中标落地', other: '更正与其他'};
const NOTICE_CLASSES = new Set(['tender', 'result', 'other']);

// 采购公告才有分道。已存 noticeClass 优先；旧记录没有该字段时按公告类型与标题现算，
// 与采购公告页同一套兜底。热点事件只带已经算好的 noticeClass，不再按标题重判，
// 避免把普通新闻标题里的「中标」误标成公告状态。
export function noticeClassOf(item) {
  if (!item) return '';
  const stored = item.procurement?.noticeClass;
  if (NOTICE_CLASSES.has(stored)) return stored;
  if (item.procurement) {
    const computed = classifyNotice(item.procurement.noticeType, item.title);
    if (NOTICE_CLASSES.has(computed)) return computed;
  }
  if (!item.procurement && NOTICE_CLASSES.has(item.noticeClass)) return item.noticeClass;
  return '';
}

const AMOUNT_PATTERN = /\d+(?:,\d{3})*(?:\.\d+)?\s*(?:亿|万)?\s*(?:元人民币|万元人民币|元|万美元|美元)/g;

// 只返回原文中逐字出现的金额片段（如 “1,280万元”），不做任何换算。
export function extractAmounts(text, limit = 4) {
  const haystack = String(text || '');
  const found = haystack.match(AMOUNT_PATTERN) || [];
  return [...new Set(found.map(s => s.replace(/\s+/g, '')))].slice(0, limit);
}

const DATE_PATTERNS = [
  /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{1,2}[:：]\d{2})?/,
  /\d{4}-\d{1,2}-\d{1,2}(?:\s*\d{1,2}[:：]\d{2})?/,
  /\d{1,2}\s*月\s*\d{1,2}\s*日/,
];

// 截止/开标时间：时间词必须紧邻日期之前（允许冒号等少量间隔），整段截取保留原语境，
// 不做日期推算；“发布日期”“公示日期”等前缀不算截止时间。
const DEADLINE_PREFIX = /(?:截止时间|截止日期|截止|递交|提交|报名|响应文件|响应|开标时间|开标|投标|磋商|谈判)[^\d]{0,6}$/;
export function extractDeadline(text) {
  const haystack = String(text || '').replace(/\s+/g, ' ');
  for (const date of DATE_PATTERNS) {
    const match = haystack.match(new RegExp(date.source, 'g'));
    if (!match) continue;
    for (const fragment of match) {
      const index = haystack.indexOf(fragment);
      const pre = haystack.slice(Math.max(0, index - 14), index);
      const hit = pre.match(DEADLINE_PREFIX);
      if (!hit) continue;
      const wordStart = pre.lastIndexOf(hit[0]);
      return haystack.slice(index - (pre.length - wordStart), index + fragment.length).trim().slice(0, 60);
    }
  }
  return '';
}

// 截止日排序与临近提示只用「可解析的日历日」。无年份的「3月5日」、非法日（2月31日）
// 视为解析不出，不补年份、不外推。展示文案仍是原文截取，需回链公告确认。
function toIsoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return '';
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseDeadlineDate(fragment) {
  const text = String(fragment || '');
  const cn = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (cn) return toIsoDate(cn[1], cn[2], cn[3]);
  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return toIsoDate(iso[1], iso[2], iso[3]);
  return '';
}

export function shanghaiToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(now);
}

export function noticeBodyText(item) {
  return [item?.title, item?.summary, ...(item?.reading?.paragraphs?.zh || [])].filter(Boolean).join('\n');
}

// 机器提取里的截止片段若能解析出日期，优先用它；否则回落到规则截取。两者都只是原文片段。
export function noticeDeadline(item) {
  const extracted = item?.machineReview?.extracted?.deadline;
  if (typeof extracted === 'string' && extracted.trim() && parseDeadlineDate(extracted)) return extracted.trim();
  return extractDeadline(noticeBodyText(item));
}

export function noticeDeadlineDate(item) {
  return parseDeadlineDate(noticeDeadline(item));
}

function dayDelta(deadlineIso, todayIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadlineIso || '') || !/^\d{4}-\d{2}-\d{2}$/.test(todayIso || '')) return null;
  const deadline = Date.parse(`${deadlineIso}T00:00:00Z`);
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  if (!Number.isFinite(deadline) || !Number.isFinite(today)) return null;
  return Math.round((deadline - today) / 86400000);
}

// 相对今天（调用方传入 Asia/Shanghai 日历日）：0～7 天为临近，已过 1～2 天为已过；更远或更旧不提示。
export function deadlineUrgency(deadlineIso, todayIso = shanghaiToday()) {
  const delta = dayDelta(deadlineIso, todayIso);
  if (delta == null) return '';
  if (delta < 0 && delta >= -2) return 'passed';
  if (delta >= 0 && delta <= 7) return 'soon';
  return '';
}

export const URGENCY_LABELS = {soon: '截止临近', passed: '截止已过'};

const SALES_VERDICTS = new Set(['重点跟进', '观察', '低价值']);

// 预审档位或协助分 P 级都只标成假设，不写成已核验。有档位时带上档位；只有 P 级时不另造档位。
export function salesHypothesisLabel(item) {
  const verdict = item?.machineReview?.salesVerdict;
  if (SALES_VERDICTS.has(verdict)) return `销售价值·假设 · ${verdict}`;
  const priority = item?.assistScore?.priority;
  if (priority === 'P0' || priority === 'P1' || priority === 'P2' || priority === 'P3') return '销售价值·假设';
  return '';
}

function publishedKey(item) {
  const day = String(item?.publishedDate || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}

// 招标窗口：能解析出截止日的按日期升序（越近越前）；解析不出的排在同组末尾，组内按 publishedDate 降序。
export function compareTenderDeadline(a, b) {
  const da = noticeDeadlineDate(a);
  const db = noticeDeadlineDate(b);
  if (da && !db) return -1;
  if (!da && db) return 1;
  if (da && db && da !== db) return da < db ? -1 : 1;
  const pa = publishedKey(a);
  const pb = publishedKey(b);
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa < pb ? 1 : -1;
}

export function sortTenderNotices(items) {
  return items.slice().sort(compareTenderDeadline);
}

// 中文候选单位名：后缀锚定 + 前缀去虚词。只用于统计发现，绝不写进任何「已核验」字段。
const ORG_SUFFIX = /(?:股份有限公司|有限责任公司|集团有限公司|勘察设计研究院|规划设计研究院|设计研究院|工程设计院|设计院|研究院|工程院|科研院|工程局|建设集团|工程集团|数字集团|科技集团|管理局|指挥部|监理公司|检测公司|咨询公司|集团有限公司|有限公司)/;
const ORG_NAME_PATTERN = new RegExp(`[一-龥A-Za-z0-9（）]{2,14}${ORG_SUFFIX.source}`, 'g');
const LEADING_NOISE = /^(?:[的和与及在对从由是为将于]|近日|日前|日前，|目前|此前|同时|未来)+/;
const GENERIC_NAMES = new Set(['有限公司', '股份有限公司', '有限责任公司', '集团有限公司', '监理公司', '咨询公司', '检测公司', '该集团', '本集团', '该单位', '该公司']);

export function extractOrgNames(text, limit = 24) {
  const haystack = String(text || '');
  const names = new Set();
  for (const raw of haystack.match(ORG_NAME_PATTERN) || []) {
    let name = raw.replace(LEADING_NOISE, '').replace(/[，。；、,.;:："'“”（()]/g, '');
    if (name.length < 5 || GENERIC_NAMES.has(name)) continue;
    if (/^[0-9A-Za-z（）]+$/.test(name)) continue;
    // 指代词或连接词拼进名字（如“我公司和某监理公司”）多为把一句话误拼成“单位名”；
    // 复合后缀（勘察设计研究院…有限公司）是正常法人全称，保留。
    if (/[该本我各某等]/.test(name) && /(公司|集团|研究院|设计院|工程局)/.test(name.slice(1))) continue;
    if (/(公司|集团|研究院|设计院|工程局)[^公集院研设工]{0,4}[和与及或、][^公集院研设工]{0,4}(公司|集团|研究院|设计院|工程局)/.test(name)) continue;
    // 高校不是销售买家观察对象，名单原则也不从关键词推参与。
    if (/大学|学院|学校/.test(name)) continue;
    names.add(name);
    if (names.size >= limit) break;
  }
  return [...names];
}

// 候选名若与既有观察名单别名互为包含，视为已知单位，交由 matchWatchOrgs 正常计分。
export function filterKnownOrgs(names, knownAliases = []) {
  const aliases = knownAliases.filter(a => a && a.length >= 2);
  return names.filter(name => !aliases.some(alias => name.includes(alias) || alias.includes(name)));
}
