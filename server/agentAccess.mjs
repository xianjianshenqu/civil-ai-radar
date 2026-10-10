// Agent 接入层（2026-09-30，参考 AIHOT /agent 的公开接入模式）：
// 匿名只读、无需 API Key。/api/v1/*（REST）、/api/mcp（MCP Streamable HTTP）、
// /llms.txt 与 /skills/civil-radar/*（Agent Skill 包）都从这里出去。
// 可见性规则与 /api/articles 同源（feeds.mjs loadPublicArticles：已驳回不可见）。
// 这些端点刻意不做同源校验：工具与跨域浏览器是正式支持路径（CORS *），
// 且只有 GET 与无 Cookie 的 JSON-RPC，没有可被 CSRF 的账号状态。
import { createHash } from 'node:crypto';
import { loadPublicArticles, memoByPublicVersion } from './feeds.mjs';
import { applyEditorial } from './review.mjs';
import { scoreArticle } from '../src/lib/scoring.js';
import { timelineFields } from '../src/lib/timeline.js';
import { isFeatured, featuredSort, recommendReason, editorialSources, HOT_LIMIT, inWindow, validDate, buildHotEvents } from '../src/lib/radar.js';
import { classifyNotice, extractAmounts, noticeDeadline, shanghaiToday, NOTICE_CLASS_LABELS } from '../src/lib/intel.js';
import { collapseProcurementDuplicates, findCollapsedEntry } from '../src/lib/procurementIdentity.js';
import { REPORT_PERIODS, buildPeriodIndex, periodKey, periodRangeText, addDays } from '../src/lib/reportPeriods.js';
import { clientIp } from './config.mjs';
import { HttpError } from './auth.mjs';
import { AGENT_VERSION, MCP_PROTOCOL_VERSIONS } from '../src/lib/agentVersion.js';

const WINDOWS = { '24h': 1, '7d': 7, '30d': 30, all: 0 };
const PROCUREMENT_WINDOWS = { '7d': 7, '30d': 30, all: 0 };
// 短路径别名：行为与正式端点完全一致（含查询参数）。Agent 常猜漏写的 s 或单复数。
const PATH_ALIASES = {
  '/api/v1/daily': '/api/v1/dailies/latest',
  '/api/v1/hotspot': '/api/v1/hotspots',
  '/api/v1/procurements': '/api/v1/procurement',
};

const cors = () => ({ 'Access-Control-Allow-Origin': '*' });

function problem(res, status, title, detail, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/problem+json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors(), ...extra });
  res.end(JSON.stringify({ type: 'about:blank', title, status, detail }));
}

function send(req, res, bodyText, type, extra = {}) {
  // ETag/304：Agent 与阅读器轮询时省流量；缓存窗口 2 分钟，客户端应再自加本地缓存。
  const etag = '"' + createHash('sha256').update(bodyText).digest('hex').slice(0, 32) + '"';
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, ...cors(), ...extra });
    return res.end();
  }
  res.writeHead(200, { 'Content-Type': type, ETag: etag, 'Cache-Control': 'public, max-age=120', 'X-Content-Type-Options': 'nosniff', ...cors(), ...extra });
  res.end(req.method === 'HEAD' ? undefined : bodyText);
}

export function createAgentAccess({ db, config, now = Date.now, limits = { v1: [120, 60000], mcp: [60, 60000] } }) {
  const origin = () => String(config.publicUrl || '').replace(/\/+$/, '');
  // generatedAt 对齐到 2 分钟缓存窗口：响应体在窗口内稳定，ETag/304 才有意义。
  const stableIso = () => new Date(Math.floor(now() / 120000) * 120000).toISOString();
  function limit(key, [max, period]) {
    const row = db.prepare('SELECT * FROM limits WHERE key=?').get(key);
    if (!row || row.reset_at <= now()) {
      db.prepare('INSERT OR REPLACE INTO limits VALUES(?,?,?)').run(key, 1, now() + period);
      return;
    }
    if (row.count >= max) {
      const retry = Math.max(1, Math.ceil((row.reset_at - now()) / 1000));
      throw Object.assign(new Error(`请求过于频繁（每分钟 ${max} 次），请在 ${retry} 秒后重试。`), { status: 429, retryAfter: retry });
    }
    db.prepare('UPDATE limits SET count=count+1 WHERE key=?').run(key);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let text = '';
      req.on('data', part => {
        text += part;
        if (Buffer.byteLength(text) > 262144) { reject(Object.assign(new Error('请求体过大。'), { status: 413 })); req.destroy(); }
      });
      req.on('end', () => resolve(text));
      req.on('error', reject);
    });
  }
  // ── 公开池准备：与 /api/articles 同一条可见性链，再补时间线与代码评分 ──
  // 公开池只在库内数据变化时重算（memoByPublicVersion），各查询在其结果上过滤与排序，不改动缓存的条目。
  const basePool = memoByPublicVersion(db, () =>
    // 与 /api/articles 一样：公开读路径合并重复采购公告，不改库内记录。
    collapseProcurementDuplicates(loadPublicArticles(db)
      .map(entry => entry.article)
      .map(applyEditorial)
      .map(article => {
        const day = validDate(article.publishedDate) ? article.publishedDate
          : validDate(String(article.publishedAt || '').slice(0, 10)) ? article.publishedAt.slice(0, 10) : '';
        const score = scoreArticle(article);
        return { ...article, ...timelineFields(article), publishedDate: day, salesScore: score, assistScore: score };
      })));
  const dayOf = a => a.publishedDate || '';
  function sortAll(list) {
    return list.slice().sort((a, b) => (b.timelineSort || 0) - (a.timelineSort || 0) || (b.salesScore.total || 0) - (a.salesScore.total || 0));
  }
  function toItem(a, { full = false } = {}) {
    const originUrl = origin();
    const item = {
      id: a.id,
      title: a.title,
      summary: a.summary || '',
      source: a.source || '',
      sourceUrl: a.sourceUrl || null,
      detailUrl: originUrl ? originUrl + '/detail/' + encodeURIComponent(a.id) : '/detail/' + encodeURIComponent(a.id),
      region: a.region || null,
      sector: a.sector || null,
      ai: a.ai || null,
      layer: a.layer || null,
      maturity: a.maturity || null,
      engineeringStage: a.engineeringStage || null,
      publishedAt: a.publishedAt || null,
      publishedDate: dayOf(a) || null,
      firstSeenAt: a.firstSeenAt || null,
      evidence: a.evidence || '待复核',
      reviewed: !!a.reviewed,
      reviewStatus: a.reviewStatus || 'pending',
      origin: a.dataOrigin || null,
      featured: isFeatured(a),
      eventId: a.eventId || null,
      topicIds: a.topicIds || [],
      salesScore: {
        total: a.salesScore?.total ?? 0,
        priority: a.salesScore?.priority || null,
        featured: !!a.salesScore?.featured,
        reason: a.salesScore?.reason || '',
      },
    };
    if (full) {
      // 详情字段都是详情页公开内容：机器整理保持「机器整理」语义，不含人工销售标签。
      item.machineReview = a.machineReview?.summary || a.machineReview?.implication ? {
        summary: a.machineReview.summary || '',
        implication: a.machineReview.implication || '',
        extracted: a.machineReview.extracted || null,
      } : null;
      item.reading = a.reading?.paragraphs ? { paragraphs: a.reading.paragraphs } : null;
      item.verificationRecord = a.verificationRecord || null;
      if (a.procurement) item.procurement = a.procurement;
    }
    return item;
  }
  // ── 查询（v1 与 MCP 共用）──
  function parseItemsParams(params) {
    const mode = params.get('mode') || 'featured';
    if (!['featured', 'all'].includes(mode)) throw new HttpError(400, 'mode 只支持 featured 或 all。');
    const windowKey = params.get('window') || 'all';
    if (!(windowKey in WINDOWS)) throw new HttpError(400, 'window 只支持 24h / 7d / 30d / all。');
    const limitRaw = params.get('limit') ?? '30';
    if (!/^\d+$/.test(limitRaw)) throw new HttpError(400, 'limit 必须是正整数。');
    const limit = Math.min(100, Math.max(1, Number(limitRaw)));
    const q = (params.get('q') || '').trim();
    if (q.length > 64) throw new HttpError(400, 'q 最长 64 字符。');
    return { mode, days: WINDOWS[windowKey], limit, q, windowKey };
  }
  function queryItems({ mode = 'featured', days = 0, limit = 30, q = '' } = {}) {
    let list = basePool();
    if (mode === 'featured') list = list.filter(isFeatured);
    if (days) list = list.filter(a => inWindow(a, days, new Date(now())));
    if (q) list = list.filter(a => [a.title, a.summary, a.source].join(' ').toLowerCase().includes(q.toLowerCase()));
    list = mode === 'featured' ? list.slice().sort(featuredSort) : sortAll(list);
    const items = list.slice(0, limit).map(a => toItem(a));
    return { object: 'list', mode, count: items.length, generatedAt: stableIso(), items };
  }
  function queryHotspots({ window: windowKey = 'all' } = {}) {
    if (!(windowKey in { '2': 2, '7': 7, all: 0 })) throw new HttpError(400, 'window 只支持 2 / 7 / all。');
    let list = basePool().filter(isFeatured);
    const days = { '2': 2, '7': 7, all: 0 }[windowKey];
    if (days) list = list.filter(a => inWindow(a, days, new Date(now())));
    const events = buildHotEvents(list).slice(0, HOT_LIMIT);
    const originUrl = origin();
    return {
      object: 'list',
      count: events.length,
      note: '按销售价值自动评分的推荐，不是实时热度；评分是假设，不是核验。',
      generatedAt: stableIso(),
      events: events.map((event, index) => ({
        rank: index + 1,
        id: event.id,
        title: event.title,
        summary: event.summary || '',
        implication: recommendReason(event.items[0])?.text || '',
        salesScore: { total: event.salesScore?.total ?? 0, priority: event.salesScore?.priority || null },
        sector: event.sector || null,
        evidence: event.evidence || '待复核',
        publishedDate: event.publishedDate || null,
        noticeClass: event.noticeClass || null,
        noticeClassLabel: NOTICE_CLASS_LABELS[event.noticeClass] || null,
        eventDate: event.eventDate || null,
        upcoming: !!event.upcoming,
        itemCount: event.itemCount,
        eventId: event.id !== event.items[0]?.id ? event.id : null,
        leadDetailUrl: originUrl ? originUrl + '/detail/' + encodeURIComponent(event.leadId) : '/detail/' + encodeURIComponent(event.leadId),
        sources: event.sources.map(s => ({ name: s.name, url: s.url, type: s.type })),
      })),
    };
  }
  function queryProcurement({ noticeClass = 'all', window: windowKey = '30d', limit = 50 } = {}) {
    if (!['tender', 'result', 'other', 'all'].includes(noticeClass)) throw new HttpError(400, 'noticeClass 只支持 tender / result / other / all。');
    if (!(windowKey in PROCUREMENT_WINDOWS)) throw new HttpError(400, 'window 只支持 7d / 30d / all。');
    let list = basePool().filter(a => a.procurement);
    const classOf = a => a.procurement.noticeClass || classifyNotice(a.procurement.noticeType, a.title);
    if (noticeClass !== 'all') list = list.filter(a => classOf(a) === noticeClass);
    const days = PROCUREMENT_WINDOWS[windowKey];
    if (days) {
      const cutoff = addDays(shanghaiToday(new Date(now())), -(days - 1));
      list = list.filter(a => dayOf(a) && dayOf(a) >= cutoff);
    }
    const items = sortAll(list).slice(0, limit).map(a => {
      const cls = classOf(a);
      const text = [a.title, a.summary, ...(a.reading?.paragraphs?.zh || [])].filter(Boolean).join('\n');
      return {
        id: a.id,
        title: a.title,
        noticeClass: cls,
        noticeClassLabel: NOTICE_CLASS_LABELS[cls] || cls,
        noticeType: a.procurement.noticeType || null,
        buyer: a.procurement.buyer || null,
        agency: a.procurement.agency || null,
        region: a.procurement.region || null,
        source: a.source || '',
        sourceUrl: a.sourceUrl || null,
        detailUrl: origin() ? origin() + '/detail/' + encodeURIComponent(a.id) : '/detail/' + encodeURIComponent(a.id),
        publishedAt: a.publishedAt || null,
        publishedDate: dayOf(a) || null,
        amounts: extractAmounts(text, 4),
        deadline: noticeDeadline(a) || null,
        ...(Array.isArray(a.procurement.sources) && a.procurement.sources.length > 1 ? { sources: a.procurement.sources.map(s => ({ id: s.id, source: s.source || '', sourceUrl: s.sourceUrl || null })) } : {}),
        reviewStatus: a.reviewStatus || 'pending',
        evidence: a.evidence || '待复核',
        salesScore: { total: a.salesScore?.total ?? 0, priority: a.salesScore?.priority || null },
      };
    });
    return { object: 'list', noticeClass, window: windowKey, count: items.length, note: '采购公告是多家公开平台的检索摘要，不是公告全文；金额与截止为原文截取片段，需回链确认。', generatedAt: stableIso(), items };
  }
  function datedPool() {
    return basePool().filter(a => dayOf(a));
  }
  function validatePeriod(period) {
    if (!REPORT_PERIODS.some(p => p.id === period)) throw new HttpError(400, 'period 只支持 daily / weekly / monthly。');
    return period;
  }
  function queryDailyIndex({ period = 'daily' } = {}) {
    validatePeriod(period);
    const index = buildPeriodIndex(period, datedPool(), featuredSort);
    return {
      object: 'list',
      period,
      count: index.length,
      note: '按首次公开日期归档；公开日期未披露的条目不参与。',
      generatedAt: stableIso(),
      periods: index.map(row => ({
        key: row.key,
        anchor: row.anchor,
        count: row.count,
        rangeText: periodRangeText(period, row.anchor),
        lead: row.lead ? { id: row.lead.id, title: row.lead.title } : null,
      })),
    };
  }
  function queryDailyReport({ period = 'daily', date = '' } = {}) {
    validatePeriod(period);
    const index = buildPeriodIndex(period, datedPool(), featuredSort);
    const row = date
      ? index.find(r => r.key === periodKey(period, date))
      : index[0];
    if (!row) throw new HttpError(404, date ? '该日期所在周期没有已入库的公开内容。' : '暂无已归档内容。');
    const report = datedPool().filter(a => periodKey(period, dayOf(a)) === row.key)
      .sort((a, b) => b.publishedDate.localeCompare(a.publishedDate) || (b.salesScore.total || 0) - (a.salesScore.total || 0));
    return {
      object: 'report',
      period,
      key: row.key,
      anchor: row.anchor,
      rangeText: periodRangeText(period, row.anchor),
      count: report.length,
      collected: report.filter(a => a.dataOrigin === 'collector').length,
      verified: report.filter(a => a.evidence === '已核验').length,
      generatedAt: stableIso(),
      items: report.map(a => toItem(a)),
    };
  }
  function queryItem(id) {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id || '')) throw new HttpError(400, '条目 ID 格式不正确。');
    // 跨来源合并后，副本 id 解析到主记录，旧详情链接仍然可读。
    const hit = findCollapsedEntry(basePool(), id);
    if (!hit) throw new HttpError(404, '条目不存在或不可见（已驳回的内容不提供）。');
    return toItem(hit, { full: true });
  }
  // ── OpenAPI 3.1（机器可读契约）──
  function openApi() {
    const o = origin();
    const param = (name, description, schema) => ({ name, in: 'query', description, required: false, schema });
    const hotspotOk = {
      description: '推荐事件列表。采购公告事件带 noticeClass 与 noticeClassLabel；非采购事件这两个字段为 null。分数与编辑置顶相同时，招标窗口排在已中标或更正之前。',
      content: { 'application/json': { schema: { type: 'object', properties: {
        note: { type: 'string' },
        events: { type: 'array', items: { type: 'object', properties: {
          noticeClass: { type: ['string', 'null'], enum: ['tender', 'result', 'other', null], description: '采购公告分道。tender=招标窗口，result=中标落地，other=更正与其他。非采购事件为 null。' },
          noticeClassLabel: { type: ['string', 'null'], enum: ['招标窗口', '中标落地', '更正与其他', null], description: 'noticeClass 的中文标签，与采购公告页一致。非采购事件为 null。' },
        } } },
      } } } },
    };
    return {
      openapi: '3.1.0',
      info: {
        title: '土木 AI 雷达 Agent API',
        version: AGENT_VERSION,
        description: '匿名只读公开接口：可见性与网站公开池一致（已驳回内容不可见）。销售评分为代码计算的假设，不是核验。无 API Key；请配合 ETag 与客户端缓存轮询。',
      },
      servers: o ? [{ url: o }] : [],
      paths: {
        '/api/v1/items': { get: { summary: '公开池条目', parameters: [
          param('mode', 'featured=今日精选池（默认），all=全部公开池', { type: 'string', enum: ['featured', 'all'], default: 'featured' }),
          param('window', '采集时间线窗口', { type: 'string', enum: ['24h', '7d', '30d', 'all'], default: 'all' }),
          param('limit', '返回条数（1-100）', { type: 'integer', minimum: 1, maximum: 100, default: 30 }),
          param('q', '关键词（标题/摘要/来源，最长 64 字符）', { type: 'string', maxLength: 64 }),
        ], responses: { '200': { description: '条目列表' }, '400': { description: '参数无效（Problem JSON）' }, '429': { description: '超速（Problem JSON，含 Retry-After）' } } } },
        '/api/v1/hotspots': { get: { summary: '热点榜（销售推荐，最多 10 条，非实时热度）', parameters: [
          param('window', '公开时间窗口（自然日）', { type: 'string', enum: ['2', '7', 'all'], default: 'all' }),
        ], responses: { '200': hotspotOk } } },
        '/api/v1/hotspot': { get: { summary: '短路径别名：等同 /api/v1/hotspots', description: '短路径别名。行为与 GET /api/v1/hotspots 相同（含查询参数）。', deprecated: true, parameters: [
          param('window', '公开时间窗口（自然日）', { type: 'string', enum: ['2', '7', 'all'], default: 'all' }),
        ], responses: { '200': hotspotOk } } },
        '/api/v1/dailies': { get: { summary: '日/周/月报索引', parameters: [
          param('period', '周期', { type: 'string', enum: ['daily', 'weekly', 'monthly'], default: 'daily' }),
        ], responses: { '200': { description: '周期索引（按首次公开日期归档）' } } } },
        '/api/v1/dailies/latest': { get: { summary: '最新一期报告', parameters: [
          param('period', '周期', { type: 'string', enum: ['daily', 'weekly', 'monthly'], default: 'daily' }),
        ], responses: { '200': { description: '报告内容' }, '404': { description: '暂无已归档内容' } } } },
        '/api/v1/daily': { get: { summary: '短路径别名：等同 /api/v1/dailies/latest', description: '短路径别名。行为与 GET /api/v1/dailies/latest 相同，period=daily|weekly|monthly。', deprecated: true, parameters: [
          param('period', '周期', { type: 'string', enum: ['daily', 'weekly', 'monthly'], default: 'daily' }),
        ], responses: { '200': { description: '报告内容' }, '404': { description: '暂无已归档内容' } } } },
        '/api/v1/dailies/{date}': { get: { summary: '按日期取报告（日期为周期内任一天）', parameters: [
          param('period', '周期', { type: 'string', enum: ['daily', 'weekly', 'monthly'], default: 'daily' }),
          { name: 'date', in: 'path', required: true, schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
        ], responses: { '200': { description: '报告内容' }, '404': { description: '该周期没有已入库内容' } } } },
        '/api/v1/procurement': { get: { summary: '采购公告摘要（检索摘要，不是公告全文）', parameters: [
          param('noticeClass', '公告分道', { type: 'string', enum: ['tender', 'result', 'other', 'all'], default: 'all' }),
          param('window', '窗口', { type: 'string', enum: ['7d', '30d', 'all'], default: '30d' }),
          param('limit', '返回条数（1-100）', { type: 'integer', minimum: 1, maximum: 100, default: 50 }),
        ], responses: { '200': { description: '公告列表' } } } },
        '/api/v1/procurements': { get: { summary: '短路径别名：等同 /api/v1/procurement', description: '短路径别名。行为与 GET /api/v1/procurement 相同（含查询参数）。', deprecated: true, parameters: [
          param('noticeClass', '公告分道', { type: 'string', enum: ['tender', 'result', 'other', 'all'], default: 'all' }),
          param('window', '窗口', { type: 'string', enum: ['7d', '30d', 'all'], default: '30d' }),
          param('limit', '返回条数（1-100）', { type: 'integer', minimum: 1, maximum: 100, default: 50 }),
        ], responses: { '200': { description: '公告列表' } } } },
        '/api/v1/items/{id}': { get: { summary: '按 ID 读取单条公开记录（含机器整理与阅读段落，若有）', parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ], responses: { '200': { description: '条目详情' }, '404': { description: '不存在或不可见' } } } },
        '/api/v1/openapi.json': { get: { summary: '本契约', responses: { '200': { description: 'OpenAPI 文档' } } } },
      },
    };
  }
  // ── llms.txt 与 Agent Skill 包 ──
  function llmsTxt() {
    const o = origin();
    const L = (label, path) => `- ${label}: ${o}${path}`;
    return `# 土木 AI 雷达（Civil AI Radar）

> 土木与基础设施行业的 AI 落地情报：公开订阅采集（待复核）与编辑精选。本站对 Agent 与工具提供匿名只读接入，无需 API Key；可见性与网站公开池一致，已驳回内容不可见。

## 接入方式

${L('REST API v1（公开池 / 热点榜 / 日报 / 采购公告）', '/api/v1/items')}
${L('OpenAPI 3.1 契约', '/api/v1/openapi.json')}
${L('MCP 服务器（Streamable HTTP，tools/list 查看工具）', '/api/mcp')}
${L('Agent Skill（SKILL.md）', '/skills/civil-radar/SKILL.md')}
${L('Agent Skill 安装说明', '/skills/civil-radar/README.md')}
${L('RSS（最新 50 条公开动态）', '/rss.xml')}
${L('站点地图', '/sitemap.xml')}

## 短路径别名

与正式端点行为相同（含查询参数），供猜短路径的 Agent 使用：

${L('日报最新一期（等同 /api/v1/dailies/latest，period=daily|weekly|monthly）', '/api/v1/daily')}
${L('热点榜（等同 /api/v1/hotspots）', '/api/v1/hotspot')}
${L('采购公告（等同 /api/v1/procurement）', '/api/v1/procurements')}

## 约定

- 只读。没有任何写入、登录或支付接口。
- 条目只含摘要与来源链接；全文请走 sourceUrl 访问发布方原文。
- 销售评分（salesScore）是代码计算的假设，不是核验，也不是实时热度；待复核条目 reviewStatus=pending。
- 支持跨域（CORS *）与 ETag/304；请做客户端缓存（≥5 分钟），收到 429 按提示退避。
- 引用请保留来源链接；基于本站的二次产出请注明来自「土木 AI 雷达」。
- 商业产品、公开镜像或批量再分发前请先联系站长获得书面授权。
`;
  }
  function skillMd() {
    return `---
name: civil-ai-radar
description: 查询「土木 AI 雷达」的土木×AI 落地情报：精选动态、全部公开池、热点榜、采购公告与日/周/月报。匿名只读 REST API，无需 API Key。当用户想了解土木工程行业的 AI 应用、招投标与采购线索、行业动态时使用。
license: 个人学习、内部业务参考与公益使用免费；商业产品、公开镜像或批量再分发需先获得站长书面授权。
---

# 土木 AI 雷达（civil-ai-radar）v${AGENT_VERSION}

土木与基础设施行业的 AI 落地情报站。本 Skill 通过匿名只读 REST API 读取公开池。

## Base URL

以发布本文件的站点源站为准（例如 https://radar.example.com ，本地开发是当前访问的 host）。

## 何时使用

- 用户问「最近土木/基建行业有什么 AI 动态」「有没有智慧工地/智能巡检相关的招标或中标」
- 用户想要某天的土木 AI 日报、周报或月报
- 用户想了解某个单位是否出现 AI 采购/落地线索（注意：评分是假设，不是参与证明）

## 接口

| 场景 | 请求 |
| --- | --- |
| 最新精选动态 | GET {base}/api/v1/items?mode=featured&limit=10 |
| 全部公开池（含待复核采集） | GET {base}/api/v1/items?mode=all&limit=20 |
| 关键词搜索 | GET {base}/api/v1/items?mode=all&q=智慧工地 |
| 热点榜（销售推荐 ≤10 条） | GET {base}/api/v1/hotspots（短路径 /api/v1/hotspot） |
| 采购公告（招标窗口/中标落地） | GET {base}/api/v1/procurement?noticeClass=tender（复数别名 /api/v1/procurements） |
| 日/周/月报 | GET {base}/api/v1/dailies/latest 或 /api/v1/daily（短路径别名，支持同样的 period），或 /api/v1/dailies/{date} |
| 单条详情 | GET {base}/api/v1/items/{id}（ID 只能来自上面接口的返回） |

示例：

    curl -fsSL "{base}/api/v1/items?mode=featured&limit=5"

## 输出规范

- 每条引用都带来源（source 与 sourceUrl）；条目只有摘要，全文请引导用户访问 sourceUrl。
- 待复核条目（reviewStatus=pending）要如实标注「待复核」；销售评分（salesScore）注明「自动评分假设，非核验」。
- 已驳回内容在接口层不可见；不要猜测或编造不存在的条目与数字。
- 收到 429 请按 Retry-After 退避；可用 ETag 做 304 缓存。
`;
  }
  function skillReadme() {
    return `# civil-ai-radar Skill 安装包 v${AGENT_VERSION}

把「土木 AI 雷达」的查询能力安装为 Agent 技能（Claude Code、Codex 等支持 SKILL.md 的环境）。

## 方式一：把提示词发给 Agent（推荐）

    请安装土木 AI 雷达 Skill：读取 ${origin()}/skills/civil-radar/README.md，
    按其中的说明把 SKILL.md 安装到本环境的技能目录，然后告诉我安装结果。

## 方式二：手动安装（Claude Code 个人技能目录）

    mkdir -p ~/.claude/skills/civil-ai-radar
    curl -fsSL ${origin()}/skills/civil-radar/SKILL.md -o ~/.claude/skills/civil-ai-radar/SKILL.md

Codex 或其他环境请放入对应技能目录。

## 验证

安装后开一个新会话，问：

    今天的土木 AI 精选有哪些？

Agent 应调用 /api/v1/items 返回带来源链接的条目，并标注待复核状态。

## 更新

    请把土木 AI 雷达 Skill 更新到最新版：重新读取 ${origin()}/skills/civil-radar/SKILL.md 并覆盖本地文件。
`;
  }
  // ── MCP（Streamable HTTP，无状态）──
  function toolSummaryItems(items, cap = 15) {
    return items.slice(0, cap).map((it, i) => `${i + 1}. ${it.title}\n   ${it.source || '来源未注明'} · ${it.publishedDate || '日期未披露'} · ${it.evidence}${it.featured ? ' · 精选' : ''}\n   ${it.detailUrl}`).join('\n');
  }
  const MCP_TOOLS = [
    {
      name: 'radar_get_latest',
      description: '获取土木 AI 雷达最新公开动态（默认精选池，可切全部公开池）。返回标题、摘要、来源、原文链接与待复核状态。',
      inputSchema: { type: 'object', additionalProperties: false, properties: {
        mode: { type: 'string', enum: ['featured', 'all'], default: 'featured', description: 'featured=今日精选池，all=全部公开池' },
        window: { type: 'string', enum: ['24h', '7d', '30d', 'all'], default: 'all' },
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
      } },
    },
    {
      name: 'radar_search',
      description: '按关键词搜索全部公开池（标题、摘要、来源）。词面匹配不代表任何机构参与。',
      inputSchema: { type: 'object', additionalProperties: false, properties: {
        q: { type: 'string', maxLength: 64 },
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
      }, required: ['q'] },
    },
    {
      name: 'radar_get_hotspots',
      description: '获取热点榜：按销售价值自动评分的推荐事件，最多 10 条。这是代码评分的假设，不是实时热度。',
      inputSchema: { type: 'object', additionalProperties: false, properties: {
        window: { type: 'string', enum: ['2', '7', 'all'], default: 'all', description: '公开时间窗口（自然日）' },
      } },
    },
    {
      name: 'radar_get_procurement',
      description: '获取采购公告摘要（招标窗口/中标落地/更正与其他）。来自公开交易与采购平台的检索摘要，不是公告全文。',
      inputSchema: { type: 'object', additionalProperties: false, properties: {
        noticeClass: { type: 'string', enum: ['tender', 'result', 'other', 'all'], default: 'all' },
        window: { type: 'string', enum: ['7d', '30d', 'all'], default: '30d' },
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 15 },
      } },
    },
    {
      name: 'radar_get_daily',
      description: '获取 AI 日报/周报/月报：默认最新一期日报，可指定周期与日期（周期内任一天）。',
      inputSchema: { type: 'object', additionalProperties: false, properties: {
        period: { type: 'string', enum: ['daily', 'weekly', 'monthly'], default: 'daily' },
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: '周期内任一天；省略则取最新一期' },
      } },
    },
    {
      name: 'radar_get_item',
      description: '按条目 ID 读取单条公开记录详情（含机器整理与阅读段落，若有）。ID 只能来自其他工具的返回，不要自行构造。',
      inputSchema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } }, required: ['id'] },
    },
  ];
  function toolResult(summary, data) {
    return { content: [{ type: 'text', text: summary }, { type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
  function callTool(name, args = {}) {
    switch (name) {
      case 'radar_get_latest': {
        const mode = args.mode || 'featured';
        if (!['featured', 'all'].includes(mode)) throw new Error('mode 只支持 featured 或 all。');
        const data = queryItems({ mode, days: WINDOWS[args.window || 'all'] ?? 0, limit: Math.min(30, Math.max(1, Number(args.limit) || 10)) });
        return toolResult(`共 ${data.count} 条${mode === 'featured' ? '精选' : '公开池'}动态：\n${toolSummaryItems(data.items)}`, data);
      }
      case 'radar_search': {
        const q = String(args.q || '').trim();
        if (!q) throw new Error('缺少关键词 q。');
        if (q.length > 64) throw new Error('关键词最长 64 字符。');
        const data = queryItems({ mode: 'all', limit: Math.min(30, Math.max(1, Number(args.limit) || 10)), q });
        return toolResult(`搜索「${q}」命中 ${data.count} 条（全部公开池）：\n${toolSummaryItems(data.items)}`, data);
      }
      case 'radar_get_hotspots': {
        const windowKey = String(args.window || 'all');
        if (!['2', '7', 'all'].includes(windowKey)) throw new Error('window 只支持 2 / 7 / all。');
        const data = queryHotspots({ window: windowKey });
        return toolResult(`热点榜共 ${data.count} 条（销售推荐 · 自动评分，非实时热度）：\n${data.events.map(e => `${e.rank}. ${e.noticeClassLabel ? '[' + e.noticeClassLabel + '] ' : ''}${e.title}（评分 ${e.salesScore.total} · ${e.itemCount} 条相关 · ${e.evidence}）\n   ${e.leadDetailUrl}`).join('\n')}`, data);
      }
      case 'radar_get_procurement': {
        const noticeClass = args.noticeClass || 'all';
        const windowKey = args.window || '30d';
        const data = queryProcurement({ noticeClass, window: windowKey, limit: Math.min(30, Math.max(1, Number(args.limit) || 15)) });
        return toolResult(`采购公告共 ${data.count} 条（${windowKey}）：\n${data.items.slice(0, 15).map((it, i) => `${i + 1}. [${it.noticeClassLabel}] ${it.title}${it.buyer ? ' · 采购人 ' + it.buyer : ''}${it.amounts.length ? ' · 金额 ' + it.amounts.join('、') : ''}${it.deadline ? ' · 截止 ' + it.deadline : ''}\n   ${it.detailUrl}`).join('\n')}`, data);
      }
      case 'radar_get_daily': {
        const data = queryDailyReport({ period: args.period || 'daily', date: args.date || '' });
        return toolResult(`AI ${ { daily: '日报', weekly: '周报', monthly: '月报' }[data.period] }（${data.rangeText || data.key}）共 ${data.count} 条：\n${toolSummaryItems(data.items)}`, data);
      }
      case 'radar_get_item': {
        const item = queryItem(String(args.id || ''));
        return toolResult(`${item.title}\n${item.source || '来源未注明'} · ${item.publishedDate || '日期未披露'} · ${item.evidence}\n${item.summary || ''}\n${item.detailUrl}`, item);
      }
      default:
        throw new Error(`未知工具 ${name}；用 tools/list 查看可用工具。`);
    }
  }
  async function dispatch(rpc) {
    if (rpc.method === 'initialize') {
      const requested = rpc.params?.protocolVersion;
      return {
        protocolVersion: MCP_PROTOCOL_VERSIONS.includes(requested) ? requested : MCP_PROTOCOL_VERSIONS.at(-1),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'civil-ai-radar', title: '土木 AI 雷达', version: AGENT_VERSION },
        instructions: '土木 AI 雷达：土木与基础设施行业的 AI 落地情报。所有工具匿名只读；条目含摘要与来源链接，全文走 sourceUrl；待复核条目保持 pending 标注；销售评分是假设不是核验。',
      };
    }
    if (rpc.method === 'ping') return {};
    if (rpc.method === 'tools/list') return { tools: MCP_TOOLS };
    if (rpc.method === 'tools/call') {
      const name = rpc.params?.name;
      const args = rpc.params?.arguments && typeof rpc.params.arguments === 'object' ? rpc.params.arguments : {};
      try {
        return { ...callTool(name, args) };
      } catch (error) {
        // 工具级错误按 MCP 规范放在结果里（isError），不作为 JSON-RPC 协议错误。
        return { content: [{ type: 'text', text: `工具调用失败：${error?.message || '请稍后重试。'}` }], isError: true };
      }
    }
    throw Object.assign(new Error(`方法不存在：${rpc.method}`), { code: -32601 });
  }
  function rpcError(res, id, code, message, status = 400) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors() });
    res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
  }
  async function handleMcp(req, res) {
    if (req.method === 'GET' || req.method === 'DELETE' || req.method === 'HEAD') {
      res.writeHead(405, { Allow: 'POST, OPTIONS', ...cors() });
      return res.end();
    }
    if (req.method !== 'POST') {
      problem(res, 405, '方法不允许', 'MCP 端点只接受 POST（JSON-RPC 2.0）。', { Allow: 'POST, OPTIONS' });
      return;
    }
    limit('agent-mcp:' + clientIp(req, config), limits.mcp);
    let raw;
    try { raw = await readBody(req); }
    catch (error) { return problem(res, error?.status || 400, '请求无效', error?.message || '请求体读取失败。'); }
    let rpc;
    try { rpc = JSON.parse(raw || ''); }
    catch { return rpcError(res, null, -32700, 'Parse error：请求不是合法 JSON。'); }
    if (Array.isArray(rpc)) return rpcError(res, null, -32600, '批量请求不受支持，请单条发送。');
    if (!rpc || typeof rpc !== 'object' || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string') {
      return rpcError(res, rpc?.id ?? null, -32600, '请求不符合 JSON-RPC 2.0。');
    }
    // 通知（notifications/*）无 id、无响应体；Streamable HTTP 约定 202。
    if (rpc.method.startsWith('notifications/') || rpc.id === undefined) {
      res.writeHead(202, { ...cors() });
      return res.end();
    }
    let result;
    try { result = await dispatch(rpc); }
    catch (error) {
      if (error?.code === -32601) return rpcError(res, rpc.id, -32601, error.message, 200);
      return rpcError(res, rpc.id, -32603, '内部错误：' + (error?.message || '请稍后重试。'), 200);
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors() });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  }
  // ── 总入口：只接管自己的路径，其余返回 false 交给主应用 ──
  async function handler(req, res) {
    let pathname = '';
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return false; }
    const isV1 = pathname === '/api/v1' || pathname.startsWith('/api/v1/');
    const isMcp = pathname === '/api/mcp';
    const isAgentStatic = ['/llms.txt', '/skills/civil-radar/SKILL.md', '/skills/civil-radar/README.md'].includes(pathname);
    if (!isV1 && !isMcp && !isAgentStatic) return false;
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, Authorization, If-None-Match',
          'Access-Control-Max-Age': '86400',
          ...cors(),
        });
        res.end();
        return true;
      }
      if (isMcp) { await handleMcp(req, res); return true; }
      if (!['GET', 'HEAD'].includes(req.method)) {
        problem(res, 405, '方法不允许', '此接口只读，仅支持 GET / HEAD。', { Allow: 'GET, HEAD, OPTIONS' });
        return true;
      }
      limit('agent-v1:' + clientIp(req, config), limits.v1);
      const params = new URL(req.url, 'http://localhost').searchParams;
      if (pathname === '/llms.txt') { send(req, res, llmsTxt(), 'text/plain; charset=utf-8'); return true; }
      if (pathname === '/skills/civil-radar/SKILL.md') { send(req, res, skillMd(), 'text/markdown; charset=utf-8'); return true; }
      if (pathname === '/skills/civil-radar/README.md') { send(req, res, skillReadme(), 'text/markdown; charset=utf-8'); return true; }
      if (pathname === '/api/v1') {
        send(req, res, JSON.stringify({ name: '土木 AI 雷达 Agent API', version: AGENT_VERSION, description: '匿名只读公开接口；可见性与网站公开池一致。aliases 为短路径别名，行为与目标端点一致。', endpoints: ['/api/v1/items', '/api/v1/hotspots', '/api/v1/hotspot', '/api/v1/dailies', '/api/v1/dailies/latest', '/api/v1/daily', '/api/v1/dailies/{date}', '/api/v1/procurement', '/api/v1/procurements', '/api/v1/openapi.json', '/api/mcp', '/llms.txt', '/skills/civil-radar/SKILL.md'], aliases: PATH_ALIASES }, null, 2), 'application/json; charset=utf-8');
        return true;
      }
      if (PATH_ALIASES[pathname]) pathname = PATH_ALIASES[pathname];
      if (pathname === '/api/v1/items') { send(req, res, JSON.stringify(queryItems(parseItemsParams(params))), 'application/json; charset=utf-8'); return true; }
      if (pathname === '/api/v1/hotspots') { send(req, res, JSON.stringify(queryHotspots({ window: params.get('window') || 'all' })), 'application/json; charset=utf-8'); return true; }
      if (pathname === '/api/v1/procurement') {
        const limitRaw = params.get('limit') ?? '50';
        if (!/^\d+$/.test(limitRaw)) throw new HttpError(400, 'limit 必须是正整数。');
        send(req, res, JSON.stringify(queryProcurement({ noticeClass: params.get('noticeClass') || 'all', window: params.get('window') || '30d', limit: Math.min(100, Math.max(1, Number(limitRaw))) })), 'application/json; charset=utf-8');
        return true;
      }
      if (pathname === '/api/v1/dailies') { send(req, res, JSON.stringify(queryDailyIndex({ period: params.get('period') || 'daily' })), 'application/json; charset=utf-8'); return true; }
      if (pathname === '/api/v1/dailies/latest') { send(req, res, JSON.stringify(queryDailyReport({ period: params.get('period') || 'daily' })), 'application/json; charset=utf-8'); return true; }
      const dailyMatch = pathname.match(/^\/api\/v1\/dailies\/(\d{4}-\d{2}-\d{2})$/);
      if (dailyMatch) { send(req, res, JSON.stringify(queryDailyReport({ period: params.get('period') || 'daily', date: dailyMatch[1] })), 'application/json; charset=utf-8'); return true; }
      const itemMatch = pathname.match(/^\/api\/v1\/items\/([^/]+)$/);
      if (itemMatch) {
        let id; try { id = decodeURIComponent(itemMatch[1]); } catch { throw new HttpError(400, '条目 ID 格式不正确。'); }
        send(req, res, JSON.stringify(queryItem(id)), 'application/json; charset=utf-8');
        return true;
      }
      if (pathname === '/api/v1/openapi.json') { send(req, res, JSON.stringify(openApi(), null, 2), 'application/json; charset=utf-8'); return true; }
      problem(res, 404, '接口不存在', '查看 /api/v1 或 /api/v1/openapi.json 获取可用端点。');
      return true;
    } catch (error) {
      if (error?.status === 429) {
        problem(res, 429, '请求过于频繁', error.message, { 'Retry-After': String(error.retryAfter || 60) });
        return true;
      }
      if (error instanceof HttpError) { problem(res, error.status, '请求无效', error.message); return true; }
      console.error('Agent access error:', error?.message || error);
      problem(res, 500, '服务暂时不可用', '请稍后重试；若持续失败请通过站点反馈页告知。');
      return true;
    }
  }
  return { handler };
}
