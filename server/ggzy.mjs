// 全国公共资源交易平台检索采集器（2026-09-26 实测：www.ggzy.gov.cn robots.txt 返回 404，无 robots
// 限制；检索端点 POST /information/pubTradingInfo/getTradList 支持 HTTPS，返回结构化 JSON，汇总各地
// 公共资源交易平台与政府采购网上报的公告）。只保存检索结果里的标题、链接、时间、地区/业务类型/
// 来源平台摘要，不抓公告全文；来源平台名称只用于溯源，不构成该单位参与或采购的证明。
import { procurementArticleFromMeta, perKeywordDeadline } from './procurement.mjs';
import { canonicalUrl } from './collector.mjs';

export const GGZY_SEARCH_TIMEOUT_MS = 60000;
const WINDOW_DAYS = 30; // 与 procurement.mjs 的收录窗口一致；检索请求窗口和入库校验都用 30 天
const MAX_PER_KEYWORD = 20;

export function ggzySearchUrl() {
  return 'https://www.ggzy.gov.cn/information/pubTradingInfo/getTradList';
}

function chinaDay(stamp) {
  return new Date(stamp + 8 * 3600000).toISOString().slice(0, 10);
}

export function ggzySearchBody(keyword, now) {
  const params = new URLSearchParams();
  params.set('SOURCE_TYPE', '1');
  params.set('DEAL_TIME', '02');
  params.set('TIMEBEGIN', chinaDay(now - (WINDOW_DAYS - 1) * 86400000));
  params.set('TIMEEND', chinaDay(now));
  params.set('FINDTXT', keyword);
  params.set('PAGENUMBER', '1');
  return params.toString();
}

const GGZY_PROVENANCE = {
  notice: '公告摘要来自全国公共资源交易平台公开检索结果，不是公告全文。地区、业务类型与来源平台取自检索摘要（汇总自各地交易平台上报），需回链公告原文确认。',
  summary: '由全国公共资源交易平台公开检索结果自动发现的交易公告线索，汇总各地公共资源交易与政府采购平台。公告类型与来源平台来自检索摘要，尚未经编辑复核，不代表采购已立项或该单位正在采购相关产品。',
  quote: '公告标题、发布时间与来源平台来自全国公共资源交易平台检索结果；不代表已核验工程事实。',
};

export function parseGgzyResponse(jsonText, source, now = Date.now()) {
  let parsed;
  try { parsed = JSON.parse(jsonText); } catch { throw new Error('全国公共资源交易平台检索结果不是合法 JSON，请人工检查来源接口。'); }
  const records = parsed && parsed.data && Array.isArray(parsed.data.records) ? parsed.data.records : null;
  if (!records) throw new Error('全国公共资源交易平台检索结果结构未识别，请人工检查来源接口。');
  const result = new Map();
  for (const record of records) {
    const rawUrl = String(record.url || '').trim();
    if (!rawUrl) continue;
    const url = canonicalUrl(rawUrl, source.url, source.articleHosts || []);
    const title = String(record.title || '').trim();
    if (!url || !title) continue;
    const publishedRaw = String(record.publishTime || '');
    const day = /^\d{4}-\d{2}-\d{2}/.test(publishedRaw) ? publishedRaw.slice(0, 10) : '';
    const stamp = day ? Date.parse(`${day}T00:00:00+08:00`) : NaN;
    const procurement = {};
    if (record.provinceText) procurement.region = String(record.provinceText);
    if (record.informationTypeText) procurement.noticeType = String(record.informationTypeText);
    const metaLine = [
      record.provinceText ? `地区：${record.provinceText}` : '地区：摘要未披露',
      record.businessTypeText ? `业务类型：${record.businessTypeText}` : '',
      record.informationTypeText ? `公告类型：${record.informationTypeText}` : '',
      record.transactionSourcesPlatformText ? `来源平台：${record.transactionSourcesPlatformText}` : '',
      record.deadline ? `截止：${record.deadline}` : '',
    ].filter(Boolean).join('；');
    const article = procurementArticleFromMeta({url, title, paragraphs: [metaLine], procurement, publishedDay: day || '未披露', publishStamp: stamp, source, now, provenance: GGZY_PROVENANCE});
    if (article) result.set(url, article);
    if (result.size >= MAX_PER_KEYWORD) break;
  }
  return [...result.values()];
}

export async function collectGgzy(source, {safeFetch, boundedText, now = Date.now, timeoutMs = GGZY_SEARCH_TIMEOUT_MS} = {}) {
  const keywords = (Array.isArray(source.keywords) ? source.keywords : []).filter(k => typeof k === 'string' && k.trim().length >= 2 && k.trim().length <= 30);
  if (!keywords.length) throw new Error('Ggzy source has no keyword list');
  const limit = Number.isFinite(timeoutMs) ? timeoutMs : GGZY_SEARCH_TIMEOUT_MS;
  const stamp = typeof now === 'function' ? now() : now;
  const merged = new Map();
  const errors = [];
  for (const keyword of keywords) {
    // 每个关键词单独超时；上一个 signal 中止不会取消后面的检索。请求结束后取消计时器。
    const deadline = perKeywordDeadline(limit);
    try {
      const response = await safeFetch(ggzySearchUrl(), {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: ggzySearchBody(keyword.trim(), stamp),
        signal: deadline.signal,
        timeoutMs: limit,
      });
      if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
      for (const article of parseGgzyResponse(await boundedText(response), source, stamp)) merged.set(article.sourceUrl, article);
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
