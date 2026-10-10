// 深圳公共资源交易中心检索采集器（2026-09-26 实测：www.szggzy.com robots.txt 返回 404，无 robots
// 限制；检索端点 POST /cms/api/v1/trade/content/page 支持 HTTPS 与标题关键词检索，无 JS 挑战、无需
// 登录。频道 channelId：2850 政府采购、2851 建设工程（其余频道见 SZGGZY_CHANNELS，按需开通））。
// 只保存检索结果里的标题、链接、时间、招标人/采购人与公告类型摘要，不抓公告全文；招标人名称只用于
// 评分线索，不构成该单位参与或采购的证明。详情页统一回链站内 details.html 页，不外链第三方域名。
import { procurementArticleFromMeta, perKeywordDeadline } from './procurement.mjs';
import { canonicalUrl } from './collector.mjs';

export const SZGGZY_SEARCH_TIMEOUT_MS = 60000;
const MAX_PER_KEYWORD = 20;

// 频道表来自站点 config.js（2026-09-26 抓取核实）。
export const SZGGZY_CHANNELS = new Map([[2850, '政府采购'], [2851, '建设工程'], [2852, '土地矿业'], [2853, '产权交易'], [2854, '拍卖交易'], [2855, '集体企业要素']]);

export function szggzySearchUrl() {
  return 'https://www.szggzy.com/cms/api/v1/trade/content/page';
}

export function szggzyRequestBody(keyword, channelId) {
  // parentBusinessType 留空对所有频道有效（2026-09-26 实测 2850/2851 均返回 200）。
  return JSON.stringify({modelId: 1378, channelId, fields: [], jsgcProjectType: '', parentBusinessType: '', title: keyword, releaseTimeBegin: null, releaseTimeEnd: null, page: 0, size: 10, siteId: 1});
}

const SZGGZY_PROVENANCE = {
  notice: '公告摘要来自深圳公共资源交易中心公开检索结果，不是公告全文。招标人/采购人与公告类型取自检索摘要，需回链公告原文确认。',
  summary: '由深圳公共资源交易中心公开检索结果自动发现的交易公告线索。招标人/采购人与公告类型来自检索摘要，尚未经编辑复核，不代表采购已立项或该单位正在采购相关产品。',
  quote: '公告标题、发布时间与招标人来自深圳公共资源交易中心检索结果；不代表已核验工程事实。',
};

export function parseSzggzyResponse(jsonText, source, now = Date.now()) {
  let parsed;
  try { parsed = JSON.parse(jsonText); } catch { throw new Error('深圳公共资源交易中心检索结果不是合法 JSON，请人工检查来源接口。'); }
  const content = parsed && parsed.code === 200 && parsed.data && Array.isArray(parsed.data.content) ? parsed.data.content : null;
  if (!content) throw new Error('深圳公共资源交易中心检索结果结构未识别，请人工检查来源接口。');
  const result = new Map();
  for (const record of content) {
    const id = record.contentId || record.id;
    const title = String(record.noticeTitle || record.projectName || '').trim();
    if (!id || !title) continue;
    const url = canonicalUrl(`/jygg/details.html?contentId=${id}`, source.url, source.articleHosts || []);
    if (!url) continue;
    const releaseRaw = String(record.releaseTime || record.publishTime || '');
    const parts = releaseRaw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    const day = parts ? `${parts[1]}-${parts[2]}-${parts[3]}` : '';
    const stamp = parts ? Date.parse(`${parts[1]}-${parts[2]}-${parts[3]}T${(parts[4] || '00').padStart(2, '0')}:${parts[5] || '00'}:${parts[6] || '00'}+08:00`) : NaN;
    const buyer = String(record.tenderer || record.tenderer2 || record.purchaseMan || '').trim();
    const buyerLabel = record.classifyType === '政府采购' ? '采购人' : '招标人';
    // noticeType 可能是代码（如实录里出现 N51=采购意向公开），优先取人读名称字段。
    const noticeType = String(record.noticeTypeName || record.appNoticeTypeName || record.noticeType || '').trim();
    const region = String(record.areaName || record.projectRegion || '').trim() || '深圳';
    const procurement = {};
    if (buyer) procurement.buyer = buyer;
    if (noticeType) procurement.noticeType = noticeType;
    if (region) procurement.region = region;
    const metaLine = [
      buyer ? `${buyerLabel}：${buyer}` : `${buyerLabel}：摘要未披露`,
      noticeType ? `公告类型：${noticeType}` : '',
      `地区：${region}`,
      record.classifyType ? `业务类型：${record.classifyType}` : '',
    ].filter(Boolean).join('；');
    const article = procurementArticleFromMeta({url, title, paragraphs: [metaLine], procurement, publishedDay: day || '未披露', publishStamp: stamp, source, now, provenance: SZGGZY_PROVENANCE});
    if (article) result.set(url, article);
    if (result.size >= MAX_PER_KEYWORD) break;
  }
  return [...result.values()];
}

export async function collectSzggzy(source, {safeFetch, boundedText, now = Date.now, timeoutMs = SZGGZY_SEARCH_TIMEOUT_MS} = {}) {
  const keywords = (Array.isArray(source.keywords) ? source.keywords : []).filter(k => typeof k === 'string' && k.trim().length >= 2 && k.trim().length <= 30);
  const channels = (Array.isArray(source.channels) ? source.channels : []).filter(id => SZGGZY_CHANNELS.has(id));
  if (!keywords.length) throw new Error('Szggzy source has no keyword list');
  if (!channels.length) throw new Error('Szggzy source has no channel list');
  const limit = Number.isFinite(timeoutMs) ? timeoutMs : SZGGZY_SEARCH_TIMEOUT_MS;
  const stamp = typeof now === 'function' ? now() : now;
  const merged = new Map();
  const errors = [];
  for (const channelId of channels) {
    for (const keyword of keywords) {
      // 每个频道×关键词单独超时；单个失败只记 warning 并继续。请求结束后取消计时器。
      const deadline = perKeywordDeadline(limit);
      try {
        const response = await safeFetch(szggzySearchUrl(), {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: szggzyRequestBody(keyword.trim(), channelId),
          signal: deadline.signal,
          timeoutMs: limit,
        });
        if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
        for (const article of parseSzggzyResponse(await boundedText(response), source, stamp)) merged.set(article.sourceUrl, article);
      } catch (error) {
        errors.push(`${SZGGZY_CHANNELS.get(channelId)}/${keyword}: ${error.message}`);
      } finally {
        deadline.cancel();
      }
    }
  }
  // 只有全部请求都失败才让整源失败。有任一成功（哪怕 0 条命中）则保留已合并结果。
  if (errors.length === channels.length * keywords.length) throw new Error(errors.join('; '));
  const articles = [...merged.values()];
  articles.warnings = errors;
  return articles;
}
