// 广州公共资源交易中心（广州交易集团）工程建设招标公告采集器。
// 2026-09-28 核对：官网域名为 https://www.gzggzy.cn （备用 www.gzprtc.cn；ggzy.gz.gov.cn 无 DNS）。
// 工程建设公告是 JeeCMS 服务端渲染栏目页，公开 GET，查询参数 word=标题或项目编号，
// 无登录、无验证码、无签名。栏目来自站点导航（房屋建筑/市政/交通/水利的招标公告）。
// 只保存列表上的标题、链接、发布日期、项目编号与栏目类别，不抓公告详情全文；
// 列表不提供采购人、预算、截止时间，这些字段保持缺失。采购人名称不会被编造。
import { procurementArticleFromMeta, perKeywordDeadline } from './procurement.mjs';
import { canonicalUrl } from './collector.mjs';

export const GZGGZY_SEARCH_TIMEOUT_MS = 60000;
const MAX_PER_KEYWORD = 20;

// 栏目路径来自 2025-07 首页与 2024-12 栏目页存档中的导航（招标公告，不含中标/候选人，以控制每日请求量）。
export const GZGGZY_COLUMNS = new Map([
  ['jyywjsgcfwjzzbgg', {name: '房屋建筑', noticeType: '招标公告'}],
  ['jyywjsgcszgczbgg', {name: '市政工程', noticeType: '招标公告'}],
  ['jyywjsgcjtgczbgg', {name: '交通工程', noticeType: '招标公告'}],
  ['jyywjsgcslswzbgg', {name: '水利水务', noticeType: '招标公告'}],
]);

export function gzggzySearchUrl(columnPath, keyword) {
  const url = new URL(`https://www.gzggzy.cn/${columnPath}/index.jhtml`);
  url.searchParams.set('word', keyword);
  return url.href;
}

const TABLE = /<table[^>]+class="[^"]*procureBulletin-table[^"]*"[^>]*>([\s\S]*?)<\/table>/i;
const ROW = /<tr>([\s\S]*?)<\/tr>/gi;
const CELL = /<td[^>]*>([\s\S]*?)<\/td>/gi;

const GZGGZY_PROVENANCE = {
  notice: '公告摘要来自广州公共资源交易中心公开栏目列表，不是公告全文。项目编号取自列表标题，采购人、预算与截止时间列表未提供，需回链公告原文确认。',
  summary: '由广州公共资源交易中心工程建设招标公告栏目自动发现的交易线索。工程类别来自栏目名称，尚未经编辑复核，不代表采购已立项或该单位正在采购相关产品。',
  quote: '公告标题与发布日期来自广州公共资源交易中心栏目列表；不代表已核验工程事实。',
};

function stripTags(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseGzggzyList(html, source, now = Date.now(), column = {name: '工程建设', noticeType: '招标公告'}) {
  const block = String(html || '').match(TABLE);
  if (!block) throw new Error('广州公共资源交易中心栏目结果结构未识别，请人工检查来源页面。');
  const result = new Map();
  for (const row of block[1].match(ROW) || []) {
    const cells = [...row.matchAll(CELL)].map(cell => cell[1]);
    if (cells.length < 2) continue;
    const link = cells[1].match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const url = canonicalUrl(link[1], source.url, source.articleHosts || []);
    const title = stripTags(link[2]);
    if (!url || !title) continue;
    const publishedRaw = stripTags(cells[2] || '');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(publishedRaw) ? publishedRaw : '';
    const stamp = day ? Date.parse(`${day}T00:00:00+08:00`) : NaN;
    const projectCode = title.match(/^\[([A-Za-z0-9-]{4,40})\]/)?.[1] || '';
    const procurement = {noticeType: column.noticeType, region: '广州'};
    // 栏目名（房屋建筑/市政工程等）是我们加的分类，不能拿来满足土木关键词门控；门控只看公告标题。
    const metaLine = [
      '采购人：摘要未披露',
      projectCode ? `项目编号：${projectCode}` : '',
      `公告类型：${column.noticeType}`,
      '地区：广州',
    ].filter(Boolean).join('；');
    const article = procurementArticleFromMeta({
      url, title, paragraphs: [metaLine], procurement,
      publishedDay: day || '未披露', publishStamp: stamp, source, now, provenance: GZGGZY_PROVENANCE,
    });
    if (article?.reading?.paragraphs?.zh) article.reading.paragraphs.zh.push(`工程类别：${column.name}`);
    if (article) result.set(url, article);
    if (result.size >= MAX_PER_KEYWORD) break;
  }
  return [...result.values()];
}

export async function collectGzggzy(source, {safeFetch, boundedText, now = Date.now, timeoutMs = GZGGZY_SEARCH_TIMEOUT_MS} = {}) {
  const keywords = (Array.isArray(source.keywords) ? source.keywords : []).filter(k => typeof k === 'string' && k.trim().length >= 2 && k.trim().length <= 30);
  const columns = (Array.isArray(source.columns) ? source.columns : []).filter(path => GZGGZY_COLUMNS.has(path));
  if (!keywords.length) throw new Error('Gzggzy source has no keyword list');
  if (!columns.length) throw new Error('Gzggzy source has no column list');
  const limit = Number.isFinite(timeoutMs) ? timeoutMs : GZGGZY_SEARCH_TIMEOUT_MS;
  const stamp = typeof now === 'function' ? now() : now;
  const merged = new Map();
  const errors = [];
  for (const columnPath of columns) {
    const column = {path: columnPath, ...GZGGZY_COLUMNS.get(columnPath)};
    for (const keyword of keywords) {
      // 每个栏目×关键词单独超时；单个失败只记 warning 并继续。请求结束后取消计时器。
      const deadline = perKeywordDeadline(limit);
      try {
        const response = await safeFetch(gzggzySearchUrl(columnPath, keyword.trim()), {signal: deadline.signal, timeoutMs: limit});
        if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
        for (const article of parseGzggzyList(await boundedText(response), source, stamp, column)) merged.set(article.sourceUrl, article);
      } catch (error) {
        errors.push(`${column.name}/${keyword}: ${error.message}`);
      } finally {
        deadline.cancel();
      }
    }
  }
  // 只有全部请求都失败才让整源失败。有任一成功（哪怕 0 条命中）则保留已合并结果。
  if (errors.length === columns.length * keywords.length) throw new Error(errors.join('; '));
  const articles = [...merged.values()];
  articles.warnings = errors;
  return articles;
}
