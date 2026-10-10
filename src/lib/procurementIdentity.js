// 采购公告的展示层判重与采购人清洗（2026-10-05）。
// 只影响公开列表与接口返回的副本，不删除、不改写已入库记录。
// 同一条公告可以同时来自政采网与全国公共资源交易平台；合并后保留一条主记录，
// 其余来源放在 procurement.sources，原文链接都还在。
import { noticeClassOf } from './intel.js';

const CONTACT_TITLE = /^(?:[\u4e00-\u9fff]{1,4})(?:老师|先生|女士|小姐|同志)$/;
const CONTACT_GONG = /^(?:[\u4e00-\u9fff]{1,3})工$/;
const LABELED_CODE = /(?:项目编号|招标编号|采购编号|采购项目编号)\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9._/-]{5,39})/g;
const HYPHEN_CODE = /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+){1,6}/g;
const COMPACT_CODE = /[A-Za-z]{2,}\d{2,}[A-Za-z][A-Za-z0-9]*/g;

function compact(value) {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, '');
}

function isContactName(text) {
  if (!text) return true;
  if (/^(?:老师|先生|女士|小姐|同志|联系人|项目联系人|采购联系人)$/.test(text)) return true;
  if (CONTACT_TITLE.test(text)) return true;
  // 「张工 / 欧阳工」是联系人简称。「施工」是工序，不是姓+工。
  if (CONTACT_GONG.test(text) && !text.includes('施工')) return true;
  return false;
}

// 明显是联系人的值返回空串。单位名称（含「淮阴工学院」「北京广播电视台(本级)」）原样保留。
export function sanitizeBuyer(value) {
  const original = String(value ?? '').trim();
  if (!original) return '';
  let text = compact(original);
  text = text.replace(/^(?:项目联系人|采购联系人|联系人)[:：]/, '');
  text = text.replace(/(?:1\d{10}|0\d{2,3}-?\d{7,8})$/g, '');
  const withoutContactParen = text.replace(/\((?:[\u4e00-\u9fff]{1,4}(?:老师|先生|女士|小姐|同志)|[\u4e00-\u9fff]{1,3}工)\)/g, '');
  // 括号里的短备注（联系人）不参与判断；剩下的若仍是称呼，整段留空。
  const probe = withoutContactParen.replace(/\([^()]{0,12}\)/g, '');
  if (!probe || isContactName(probe)) return '';
  if (withoutContactParen === compact(original)) return original;
  return withoutContactParen;
}

export function normalizeNoticeTitle(title) {
  return compact(title).replace(/[—–－]/g, '-').toLowerCase();
}

function acceptCode(raw) {
  const code = String(raw || '').replace(/[._/]+$/g, '').toUpperCase();
  if (code.length < 8 || code.length > 40) return '';
  if (!/[A-Z]/.test(code) || !/\d/.test(code)) return '';
  if (/^\d{4}-\d{2}/.test(code)) return '';
  return code;
}

export function extractProjectCodes(article) {
  const parts = [
    article?.title,
    article?.summary,
    ...(article?.reading?.paragraphs?.zh || []),
  ];
  const text = parts.filter(Boolean).join('\n').replace(/https?:\/\/\S+/g, ' ');
  const found = new Set();
  const add = raw => {
    const code = acceptCode(raw);
    if (code) found.add(code);
  };
  for (const match of text.matchAll(LABELED_CODE)) add(match[1]);
  for (const match of text.matchAll(HYPHEN_CODE)) add(match[0]);
  for (const match of text.matchAll(COMPACT_CODE)) add(match[0]);
  return found;
}

const NUMBER_LABEL = /(?:采购项目编号|项目编号|招标编号|采购编号)/g;
const CN_DIGIT = {零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9};

export function noticeTitleCore(title) {
  let text = normalizeNoticeTitle(title).replace(NUMBER_LABEL, '');
  for (const code of extractProjectCodes({title})) text = text.replaceAll(code.toLowerCase(), '');
  return text.replace(/[()（）[\]【】「」『』"'“”‘’、,，。:：;；\-_／/·]/g, '');
}

// 「第二次」和「第2次」是同一轮。无法换算的写法保持原样，不同轮次仍然分开。
function canonicalCount(raw) {
  const text = String(raw || '');
  if (!text) return '';
  if (/^\d+$/.test(text)) return String(Number(text));
  if (text === '十') return '10';
  const ten = text.indexOf('十');
  if (ten === -1) return text.length === 1 && CN_DIGIT[text] != null ? String(CN_DIGIT[text]) : text;
  if (text.length > 3) return text;
  const high = ten === 0 ? 1 : CN_DIGIT[text[0]];
  const low = ten === text.length - 1 ? 0 : CN_DIGIT[text[ten + 1]];
  if (high == null || low == null) return text;
  return String(high * 10 + low);
}

export function noticeRoundMarker(title) {
  const text = compact(title);
  const match = text.match(/第([0-9]{1,2}|[一二三四五六七八九十两]{1,3})次|\(([0-9]{1,2}|[一二三四五六七八九十两]{1,3})次\)/);
  return match ? canonicalCount(match[1] || match[2]) : '';
}

function lotMarker(title) {
  const text = compact(title);
  const pack = text.match(/采购包([0-9]{1,2}|[一二三四五六七八九十]{1,3})/);
  if (pack) return pack[1];
  const numbered = text.match(/([0-9]{1,2})包/);
  if (numbered) return String(Number(numbered[1]));
  const paren = text.match(/\(([一二三四五六七八九十0-9]{1,2})\)/);
  if (paren && !paren[0].includes('次')) return paren[1];
  return '';
}

function noticeFacts(article) {
  return {
    title: normalizeNoticeTitle(article?.title),
    core: noticeTitleCore(article?.title),
    noticeClass: noticeClassOf(article),
    round: noticeRoundMarker(article?.title),
    lot: lotMarker(article?.title),
    codes: extractProjectCodes(article),
  };
}

function sameNotice(a, b) {
  if (a.title && a.title === b.title) return true;
  if (!a.noticeClass || a.noticeClass !== b.noticeClass) return false;
  if (a.round !== b.round || a.lot !== b.lot) return false;
  for (const code of a.codes) if (b.codes.has(code)) return true;
  if (a.codes.size > 0 && b.codes.size > 0) return false;
  return Boolean(a.core && a.core === b.core && a.core.length >= 16);
}

function scrubContactBuyerLine(paragraph, rawBuyer) {
  const raw = String(rawBuyer || '').trim();
  if (!raw) return paragraph;
  let text = String(paragraph ?? '');
  for (const label of ['采购人', '招标人']) {
    text = text.replaceAll(`${label}：${raw}`, `${label}：摘要未披露`);
    text = text.replaceAll(`${label}:${raw}`, `${label}：摘要未披露`);
  }
  return text;
}

function sanitizeDisplayed(article) {
  const raw = String(article?.procurement?.buyer || '').trim();
  const clean = sanitizeBuyer(raw);
  const paragraphs = article?.reading?.paragraphs?.zh;
  const nextParagraphs = raw && !clean && Array.isArray(paragraphs)
    ? paragraphs.map(p => scrubContactBuyerLine(p, raw))
    : null;
  const paragraphsChanged = Boolean(nextParagraphs && nextParagraphs.some((p, i) => p !== paragraphs[i]));
  if (raw === clean && !paragraphsChanged) return article;
  const procurement = {...(article.procurement || {})};
  if (clean) procurement.buyer = clean;
  else delete procurement.buyer;
  const next = {...article, procurement};
  if (paragraphsChanged) {
    next.reading = {...article.reading, paragraphs: {...article.reading.paragraphs, zh: nextParagraphs}};
  }
  return next;
}

function scoreOf(article) {
  return article?.salesScore?.total ?? article?.assistScore?.total ?? 0;
}
function humanTouched(article) {
  return article?.reviewed || article?.reviewStatus === 'approved' ? 1 : 0;
}
function featuredBoost(article) {
  if (Number.isInteger(article?.featuredRank) && article.featuredRank >= 1) return 2;
  if (article?.salesScore?.featured || article?.assistScore?.featured) return 1;
  return 0;
}
function completeness(article) {
  const proc = article?.procurement || {};
  return (sanitizeBuyer(proc.buyer) ? 4 : 0) + (proc.agency ? 1 : 0) + (proc.region ? 1 : 0);
}

// 主记录：已人工发布的优先，其次是更能占住精选/热点名额的高分记录；采购人等空字段从其余副本补上。
function comparePrimary(a, b) {
  const rank = item => (Number.isInteger(item?.featuredRank) && item.featuredRank >= 1 ? item.featuredRank : 999);
  return humanTouched(b) - humanTouched(a)
    || featuredBoost(b) - featuredBoost(a)
    || scoreOf(b) - scoreOf(a)
    || rank(a) - rank(b)
    || completeness(b) - completeness(a)
    || String(a?.firstSeenAt || '').localeCompare(String(b?.firstSeenAt || ''))
    || String(a?.id || '').localeCompare(String(b?.id || ''));
}

function attachSources(primary, ranked) {
  const procurement = {...(primary.procurement || {})};
  if (!procurement.buyer) {
    for (const item of ranked) {
      const buyer = sanitizeBuyer(item?.procurement?.buyer);
      if (buyer) { procurement.buyer = buyer; break; }
    }
  }
  for (const key of ['agency', 'region']) {
    if (procurement[key]) continue;
    const value = ranked.map(item => item?.procurement?.[key]).find(v => typeof v === 'string' && v.trim());
    if (value) procurement[key] = value.trim();
  }
  const sources = [];
  const seen = new Set();
  for (const item of ranked) {
    const sourceUrl = item?.sourceUrl || '';
    if (!sourceUrl || seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    sources.push({id: item.id, source: item.source || '', sourceUrl});
  }
  if (sources.length > 1) procurement.sources = sources;
  return {...primary, procurement};
}

// 主记录 id，加上 procurement.sources 里其余副本的 id。收藏、关注和详情按这组 id 认同一条公告。
export function procurementRecordIds(article) {
  const ids = [];
  const push = id => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  push(article?.id);
  for (const source of article?.procurement?.sources || []) push(source?.id);
  return ids;
}

export function findCollapsedEntry(entries, id) {
  if (!id) return null;
  const list = Array.isArray(entries) ? entries : [];
  return list.find(entry => entry?.id === id)
    || list.find(entry => (entry?.procurement?.sources || []).some(source => source?.id === id))
    || null;
}

// 公开池使用：采购公告按标题 / 项目编号合并，联系人采购人留空。其它条目原样返回。
export function collapseProcurementDuplicates(articles) {
  const items = Array.isArray(articles) ? articles : [];
  const procIdx = [];
  items.forEach((item, index) => { if (item?.procurement) procIdx.push(index); });
  const facts = procIdx.map(index => noticeFacts(items[index]));
  const parent = procIdx.map((_, index) => index);
  const find = index => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const link = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  for (let i = 0; i < procIdx.length; i++) {
    for (let j = i + 1; j < procIdx.length; j++) {
      if (sameNotice(facts[i], facts[j])) link(i, j);
    }
  }
  const groups = new Map();
  procIdx.forEach((index, order) => {
    const root = find(order);
    const group = groups.get(root) || [];
    group.push(items[index]);
    groups.set(root, group);
  });
  const replacement = new Map();
  const skip = new Set();
  for (const group of groups.values()) {
    const ranked = group.slice().sort(comparePrimary);
    const primary = sanitizeDisplayed(ranked[0]);
    const merged = ranked.length === 1 ? primary : attachSources(primary, ranked);
    replacement.set(ranked[0], merged);
    for (const other of ranked.slice(1)) skip.add(other);
  }
  const out = [];
  for (const item of items) {
    if (skip.has(item)) continue;
    out.push(replacement.get(item) || item);
  }
  return out;
}
