// 中国政府采购网公开检索采集器（2026-09-18 实测：search.ccgp.gov.cn 无 robots 限制，
// 检索端点与公告详情页均支持 HTTPS）。只保存检索结果里的标题、链接、时间与采购人摘要，
// 不抓取公告全文；采购人名称只用于评分线索，不构成该单位参与或采购的证明。
import { AI, ENGINEERING } from '../src/lib/scoring.js';
import { applyLane } from '../src/lib/machineReview.js';
import { classifyNotice } from '../src/lib/intel.js';
import { guessSector } from '../src/lib/topicMatch.js';
import { timelineFields } from '../src/lib/timeline.js';
import { hash } from './auth.mjs';
import { canonicalUrl } from './collector.mjs';
import { sanitizeBuyer } from '../src/lib/procurementIdentity.js';

const WINDOW_DAYS = 30;
const MAX_PER_KEYWORD = 20;
// 政采检索比 RSS 慢。独立于采集器对其它源使用的 20s 超时，且每个关键词各自一个 signal。
export const CCGP_SEARCH_TIMEOUT_MS = 60000;
export const PROCUREMENT_NOTICE = '公告摘要来自中国政府采购网公开检索结果，不是公告全文。采购人与公告类型取自检索摘要，不等于该单位正在采购相关产品，需回链公告原文确认。';

const LIST_BLOCK = /<ul[^>]+class="vT-srch-result-list-bid"[^>]*>([\s\S]*?)<\/ul>/i;
const LIST_ITEM = /<li>([\s\S]*?)<\/li>/gi;
const NOTICE_TYPES = /招标公告|中标公告|成交公告|更正公告|废标|流标|竞争性磋商|竞争性谈判|询价|单一来源|预公示|意向公开/;

function array(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function parseMeta(value) {
  const parts = String(value || '').replace(/<br\s*\/?>/gi, '|').split('|').map(p => stripTags(p)).filter(Boolean);
  const out = {publishedRaw: '', buyer: '', agency: '', noticeType: '', region: ''};
  for (const part of parts) {
    if (/^\d{4}\.\d{2}\.\d{2}/.test(part) && !out.publishedRaw) {out.publishedRaw = part; continue;}
    if (part.startsWith('采购人：') || part.startsWith('采购人:')) {out.buyer = sanitizeBuyer(part.slice(4)); continue;}
    if (part.startsWith('代理机构：') || part.startsWith('代理机构:')) {out.agency = part.slice(5).trim(); continue;}
    if (!out.noticeType && NOTICE_TYPES.test(part)) {out.noticeType = part.match(NOTICE_TYPES)[0]; continue;}
    if (!out.region && part.length >= 2 && part.length <= 4) out.region = part;
  }
  return out;
}
export function ccgpSearchUrl(keyword) {
  const url = new URL('https://search.ccgp.gov.cn/bxsearch');
  url.searchParams.set('searchtype', '1');
  url.searchParams.set('page_index', '1');
  url.searchParams.set('bidSort', '0');
  url.searchParams.set('pinMu', '0');
  url.searchParams.set('bidType', '0');
  url.searchParams.set('dbselect', 'bidx');
  url.searchParams.set('kw', keyword);
  return url.href;
}
// 通用采购公告入库构造：ccgp / 全国公共资源交易平台（ggzy） / 深圳公共资源交易中心（szggzy） / 广州公共资源交易中心（gzggzy）共用。
// 窗口校验、AI×土木双门控、待复核口径集中在这里；provenance 由各来源提供自己的摘要说明文案。
export function procurementArticleFromMeta({url, title, paragraphs, procurement, publishedDay, publishStamp, source, now, provenance}) {
  if (!url || !title || !Number.isFinite(publishStamp)) return null;
  if (Math.abs(now - publishStamp) > WINDOW_DAYS * 86400000) return null;
  const haystack = [title, ...paragraphs].join('\n');
  if (!AI.test(haystack) || !ENGINEERING.test(haystack)) return null;
  const proc = {...(procurement || {})};
  const rawBuyer = String(proc.buyer || '').trim();
  const cleanBuyer = sanitizeBuyer(rawBuyer);
  if (cleanBuyer) proc.buyer = cleanBuyer;
  else delete proc.buyer;
  // 联系人被误当成采购人时，摘要行改回「未披露」，不把姓名写进新入库的正文。
  const body = rawBuyer && !cleanBuyer ? paragraphs.map(p => String(p)
    .replaceAll(`采购人：${rawBuyer}`, '采购人：摘要未披露').replaceAll(`采购人:${rawBuyer}`, '采购人：摘要未披露')
    .replaceAll(`招标人：${rawBuyer}`, '招标人：摘要未披露').replaceAll(`招标人:${rawBuyer}`, '招标人：摘要未披露')) : paragraphs;
  // 招标/结果分道是展示口径：中标公告只代表公开检索摘要显示的结果，不构成核验。
  const noticeClass = classifyNotice(proc.noticeType, title);
  if (noticeClass) proc.noticeClass = noticeClass;
  const article = {
    id: 'feed-' + hash(url).slice(0, 24),
    sourceUrl: url,
    title: title.slice(0, 300),
    source: source.name,
    sourceId: source.id,
    reading: body.length ? {kind: 'procurement-notice', originalLanguage: 'zh', paragraphs: {zh: body}, notice: provenance.notice} : undefined,
    procurement: Object.keys(proc).length ? proc : undefined,
    summary: provenance.summary,
    quote: provenance.quote,
    implication: '待编辑结合公告原文补充工程启示。',
    sector: guessSector(haystack) || source.sector,
    scope: source.scope || '国内',
    region: source.region || '中国',
    topicIds: source.topicIds || [],
    time: '未披露',
    eventDate: '未披露',
    eventSort: 0,
    publishedDate: publishedDay,
    publishSort: Number(publishedDay.replaceAll('-', '')) * 10000,
    publishedAt: new Date(publishStamp).toISOString(),
    ai: 'AI 相关线索',
    maturity: '待判断',
    layer: '自动采集',
    engineeringStage: '待判断',
    evidence: '待复核',
    dataOrigin: 'collector',
    firstSeenAt: new Date(now).toISOString(),
  };
  return applyLane({...article, ...timelineFields(article)}, source);
}

const CCGP_PROVENANCE = {
  notice: PROCUREMENT_NOTICE,
  summary: '由中国政府采购网公开检索结果自动发现的采购公告线索。采购人与公告类型来自检索摘要，尚未经编辑复核，不代表采购已立项或该单位正在采购相关产品。',
  quote: '公告标题、发布时间与采购人来自中国政府采购网检索结果；不代表已核验工程事实。',
};

function procurementArticle({url, title, snippet, meta, source, now}) {
  const known = /^\d{4}\.\d{2}\.\d{2}/.test(meta.publishedRaw);
  const day = known ? meta.publishedRaw.slice(0, 10).replaceAll('.', '-') : '未披露';
  let stamp = NaN;
  if (known) {
    const parts = meta.publishedRaw.match(/^(\d{4})\.(\d{2})\.(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (parts) stamp = Date.parse(`${parts[1]}-${parts[2]}-${parts[3]}T${(parts[4] || '00').padStart(2, '0')}:${parts[5] || '00'}:${parts[6] || '00'}+08:00`);
  }
  const metaLine = [`采购人：${meta.buyer || '摘要未披露'}`, meta.agency ? `代理机构：${meta.agency}` : '', meta.noticeType ? `公告类型：${meta.noticeType}` : '', meta.region ? `地区：${meta.region}` : ''].filter(Boolean).join('；');
  const procurement = {};
  for (const key of ['buyer', 'agency', 'noticeType', 'region']) if (meta[key]) procurement[key] = meta[key];
  const paragraphs = [snippet, metaLine].filter(Boolean);
  return procurementArticleFromMeta({url, title, paragraphs, procurement, publishedDay: day, publishStamp: stamp, source, now, provenance: CCGP_PROVENANCE});
}
export function parseCcgpList(html, source, now = Date.now()) {
  const block = String(html || '').match(LIST_BLOCK);
  if (!block) throw new Error('政府采购检索结果结构未识别，请人工检查来源页面。');
  const result = new Map();
  for (const item of block[1].match(LIST_ITEM) || []) {
    const link = item.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const url = canonicalUrl(link[1], source.url, source.articleHosts || []);
    const title = stripTags(link[2]);
    if (!url || !title) continue;
    const snippet = stripTags(item.match(/<p>([\s\S]*?)<\/p>/i)?.[1]).slice(0, 1200);
    const meta = parseMeta(item.match(/<span>([\s\S]*?)<\/span>/i)?.[1] || '');
    const article = procurementArticle({url, title, snippet, meta, source, now});
    if (article) result.set(url, article);
    if (result.size >= MAX_PER_KEYWORD) break;
  }
  return [...result.values()];
}
// 政采类检索每个关键词/频道各自一个 signal：单个超时不连坐，请求结束取消计时器。
export function perKeywordDeadline(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  }, timeoutMs);
  return {signal: controller.signal, cancel() { clearTimeout(timer); }};
}
export async function collectProcurement(source, {safeFetch, boundedText, now = Date.now, timeoutMs = CCGP_SEARCH_TIMEOUT_MS} = {}) {
  const keywords = array(source.keywords).filter(k => typeof k === 'string' && k.trim().length >= 2 && k.trim().length <= 30);
  if (!keywords.length) throw new Error('Procurement source has no keyword list');
  const limit = Number.isFinite(timeoutMs) ? timeoutMs : CCGP_SEARCH_TIMEOUT_MS;
  const stamp = typeof now === 'function' ? now() : now;
  const merged = new Map();
  const errors = [];
  for (const keyword of keywords) {
    // 每个关键词单独超时；上一个 signal 中止不会取消后面的检索。请求结束后取消计时器。
    const deadline = perKeywordDeadline(limit);
    try {
      const response = await safeFetch(ccgpSearchUrl(keyword.trim()), {signal: deadline.signal, timeoutMs: limit});
      if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
      for (const article of parseCcgpList(await boundedText(response), source, stamp)) merged.set(article.sourceUrl, article);
    } catch (error) {
      errors.push(`${keyword}: ${error.message}`);
    } finally {
      deadline.cancel();
    }
  }
  // 只有全部关键词都失败才让整源失败。有关键词成功（哪怕 0 条命中）则保留已合并结果。
  if (errors.length === keywords.length) throw new Error(errors.join('; '));
  const articles = [...merged.values()];
  articles.warnings = errors;
  return articles;
}
