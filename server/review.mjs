import { hash, HttpError } from './auth.mjs';
import { completeVerification, isHttpUrl } from '../src/lib/evidence.js';
import { civilAiTopics } from '../src/data/topicsData.js';
import { parseSalesTags, salesCatalog } from '../src/data/orgWatchlist.js';
import { scoreArticle } from '../src/lib/scoring.js';
import { applyLane } from '../src/lib/machineReview.js';
import { guessSector, SECTORS as SECTOR_LIST } from '../src/lib/topicMatch.js';
import { timelineFields } from '../src/lib/timeline.js';
import { buildEventSuggester, EVENT_SUGGEST_POOL_DAYS } from '../src/lib/eventSuggest.js';

export const topicCatalog = civilAiTopics.map(t => ({id:t.id,name:t.name,categoryLabel:t.categoryLabel,sector:t.sector}));
const TOPIC_IDS = new Set(topicCatalog.map(t => t.id));
const SECTORS = new Set(SECTOR_LIST);
const SCOPES = new Set(['国内','海外']);
const STATUSES = new Set(['pending','approved','rejected','archived']);
const BATCH_ACTIONS = new Set(['approved','rejected','pending']);
const LIST_FILTERS = new Set(['work','pending','archived','approved','rejected','all']);
const PRIORITY_RANK = {P0:0,P1:1,P2:2,P3:3};
const MATURITIES = new Set(['预告','研究','试点','已部署','已发布','待判断']);
const STAGES = new Set(['勘察设计','智慧施工','运行维护','防灾与水利','水利数字孪生','待判断']);
const LAYERS = new Set(['自动采集','项目落地','行业活动','研究','专业单位','集团总部','赛事活动']);
const FIELDS = ['featuredRank','topicIds','summary','implication','quote','sector','scope','region','maturity','layer','engineeringStage','ai','verificationRecord','metrics','deploymentRequirements','eventId'];
const EVENT_ID_PATTERN = /^ev-[a-z0-9-]{2,40}$/;

function text(value, max, field) {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, field + '格式不正确。');
  const next = value.trim();
  if (next.length > max) throw new HttpError(400, field + '过长。');
  return next;
}
function paragraphs(value) {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 40 || !value.every(p => typeof p === 'string' && p.trim() && p.length <= 4000)) {
    throw new HttpError(400, '正文段落需为非空字符串列表。');
  }
  return value.map(p => p.trim());
}
function publicMachineReview(article) {
  const machine = article.machineReview;
  if (machine?.status !== 'ready') return {};
  const overlay = {
    machineReview: {
      status: machine.status,
      model: machine.model,
      summary: machine.summary,
      implication: machine.implication,
      needsHuman: Boolean(machine.needsHuman),
      note: machine.note,
      ...(machine.extracted ? {extracted: machine.extracted} : {}),
    },
  };
  if (machine.summary && (!article.summary || String(article.summary).startsWith('由公开订阅源自动发现'))) overlay.summary = machine.summary;
  if (machine.implication) overlay.implication = machine.implication;
  return overlay;
}

export function applyEditorial(article) {
  const ed = article.editorial;
  const {editorial, ...base} = article;
  if (ed?.status === 'rejected') return base;
  if (ed?.status === 'approved') {
    const out = {...base, reviewStatus:'approved', reviewed:true};
    for (const key of FIELDS) {
      if (ed[key] === undefined) continue;
      if (key === 'featuredRank') { out.featuredRank = ed.featuredRank || undefined; continue; }
      if (key === 'verificationRecord') {
        if (completeVerification(ed.verificationRecord)) out.verificationRecord = ed.verificationRecord;
        continue;
      }
      if (key === 'metrics') {
        out.metrics = Array.isArray(ed.metrics) ? ed.metrics : [];
        continue;
      }
      if (ed[key] !== null && ed[key] !== '') out[key] = ed[key];
    }
    if (ed.reading?.paragraphs) out.reading = ed.reading;
    return out;
  }
  return {
    ...base,
    ...publicMachineReview(article),
    ...(ed?.eventId && EVENT_ID_PATTERN.test(ed.eventId) ? {eventId: ed.eventId} : {}),
    reviewStatus: ed?.status === 'archived' ? 'archived' : 'pending',
  };
}
function parseEditorial(input, reviewer, extraOrgs = []) {
  const status = input.status;
  if (!STATUSES.has(status)) throw new HttpError(400, '请选择待复核、发布、归档或驳回。');
  const editorial = {status, reviewer: text(input.reviewer, 80, '复核人') || reviewer, reviewedAt: new Date().toISOString(), notes: text(input.notes, 2000, '内部备注') || ''};
  if (input.featuredRank == null || input.featuredRank === '') editorial.featuredRank = null;
  else if (!Number.isInteger(input.featuredRank) || input.featuredRank < 1 || input.featuredRank > 20) throw new HttpError(400, '精选排序应为 1–20 的整数，或留空。');
  else editorial.featuredRank = input.featuredRank;
  if (input.topicIds !== undefined) {
    if (!Array.isArray(input.topicIds) || input.topicIds.length > 8 || !input.topicIds.every(id => TOPIC_IDS.has(id))) throw new HttpError(400, '主题需从主题库中选择，最多 8 个。');
    editorial.topicIds = [...new Set(input.topicIds)];
  }
  for (const [key, max] of [['summary',2000],['implication',2000],['quote',500],['region',40],['ai',40],['deploymentRequirements',1000]]) {
    if (input[key] !== undefined) editorial[key] = text(input[key], max, key) || '';
  }
  if (input.sector !== undefined) { if (!SECTORS.has(input.sector)) throw new HttpError(400, '领域无效。'); editorial.sector = input.sector; }
  if (input.scope !== undefined) { if (!SCOPES.has(input.scope)) throw new HttpError(400, '地区范围无效。'); editorial.scope = input.scope; }
  if (input.maturity !== undefined) { if (!MATURITIES.has(input.maturity)) throw new HttpError(400, '成熟度无效。'); editorial.maturity = input.maturity; }
  if (input.layer !== undefined) { if (!LAYERS.has(input.layer)) throw new HttpError(400, '条目类型无效。'); editorial.layer = input.layer; }
  if (input.engineeringStage !== undefined) { if (!STAGES.has(input.engineeringStage)) throw new HttpError(400, '工程阶段无效。'); editorial.engineeringStage = input.engineeringStage; }
  const sales = parseSalesTags(input, extraOrgs);
  if (sales.error) throw new HttpError(400, sales.error);
  if (sales.offerings) editorial.offerings = sales.offerings;
  if (sales.buyerRole) editorial.buyerRole = sales.buyerRole;
  if (sales.salesStage) editorial.salesStage = sales.salesStage;
  if (sales.watchOrgId !== undefined) editorial.watchOrgId = sales.watchOrgId;
  // 事件组编号：显式人工合并才产生；null/空串清除。词面相似建议只在复核台展示，不写这里。
  if (input.eventId !== undefined) {
    if (input.eventId === null || input.eventId === '') editorial.eventId = null;
    else if (typeof input.eventId === 'string' && EVENT_ID_PATTERN.test(input.eventId.trim())) editorial.eventId = input.eventId.trim();
    else throw new HttpError(400, '事件组编号格式无效。');
  }
  if (input.verificationRecord) {
    const record = input.verificationRecord;
    if (record.status !== 'verified' || typeof record.reviewer !== 'string' || typeof record.checkedAt !== 'string' || typeof record.notes !== 'string' || !Array.isArray(record.references)) {
      throw new HttpError(400, '核验记录字段不完整。');
    }
    editorial.verificationRecord = {
      status:'verified',
      reviewer: text(record.reviewer, 80, '核验人') || editorial.reviewer,
      checkedAt: record.checkedAt.trim(),
      notes: text(record.notes, 2000, '核验说明') || '',
      references: record.references.slice(0, 12).map(r => ({title: text(r.title, 120, '证据标题') || '', url: typeof r.url === 'string' ? r.url.trim() : ''})),
    };
    if (!completeVerification(editorial.verificationRecord)) throw new HttpError(400, '已核验需要复核人、时间和指向具体文章的证据链接，不能用网站首页代替。');
  } else if (input.verificationRecord === null) editorial.verificationRecord = null;
  if (input.metrics !== undefined) {
    if (!Array.isArray(input.metrics) || input.metrics.length > 8) throw new HttpError(400, '指标条数过多。');
    const refs = new Set((editorial.verificationRecord?.references || []).map(r => r.url));
    editorial.metrics = input.metrics.map(m => {
      if (!m || typeof m.label !== 'string' || typeof m.value !== 'string' || !isHttpUrl(m.sourceUrl)) throw new HttpError(400, '指标需要名称、数值和来源链接。');
      if (!refs.has(m.sourceUrl)) throw new HttpError(400, '指标来源必须属于核验记录中的证据链接。');
      return {label:m.label.trim().slice(0,80), value:m.value.trim().slice(0,80), sourceUrl:m.sourceUrl, limitations: typeof m.limitations === 'string' ? m.limitations.trim().slice(0,200) : ''};
    });
  }
  const zh = paragraphs(input.reading?.zh);
  const en = paragraphs(input.reading?.en);
  if (zh) {
    editorial.reading = {kind:'editorial', originalLanguage:'zh', translationLabel:'编辑整理', paragraphs:{zh}};
    if (en) {
      if (en.length !== zh.length) throw new HttpError(400, '中英文段落数量需一致。');
      editorial.reading.paragraphs.en = en;
    }
  } else if (input.reading === null) editorial.reading = null;
  return editorial;
}
function matchesFilter(status, current, priority) {
  if (status === 'all') return true;
  if (status === 'work') return current === 'pending' && (priority === 'P0' || priority === 'P1');
  return current === status;
}

export function createReview({db, now=Date.now, watchlist=null}) {
  // parseSalesTags 需要接受界面新增的附加观察单位；未提供时退回静态名单。
  const extraOrgs = () => watchlist ? watchlist.extras() : [];
  function registerOne(input, user) {
    // 人工登记只保存登记人填写的内容，不抓取网页全文，也不回填任何未提供的字段。
    const url = typeof input.sourceUrl === 'string' ? input.sourceUrl.trim() : '';
    if (!isHttpUrl(url)) throw new HttpError(400, '请粘贴 http(s) 开头的原文链接。');
    const title = text(input.title, 300, '标题');
    if (!title) throw new HttpError(400, '请填写线索标题。');
    const quote = text(input.quote, 2000, '引文');
    const note = text(input.note, 2000, '说明');
    const sourceLabel = text(input.sourceLabel, 80, '来源名称');
    const sectorInput = text(input.sector, 8, '领域');
    const sector = SECTORS.has(sectorInput) ? sectorInput : (guessSector([title, quote, note].join('\n')) || '施工');
    const day = /^\d{4}-\d{2}-\d{2}$/.test(text(input.publishedDate, 10, '公开日期') || '') ? input.publishedDate.trim() : '未披露';
    const sales = parseSalesTags({watchOrgId: input.watchOrgId}, extraOrgs());
    if (sales.error) throw new HttpError(400, sales.error);
    if (db.prepare('SELECT id FROM articles WHERE url=?').get(url)) throw new HttpError(409, '该链接已入库，请在列表中直接处理。');
    const paragraphs = [quote, note ? `登记说明：${note}` : ''].filter(Boolean);
    const known = day !== '未披露';
    const article = {
      id: 'feed-' + hash(url).slice(0, 24),
      sourceUrl: url,
      title,
      source: sourceLabel || '人工登记线索',
      sourceId: 'manual-intake',
      reading: paragraphs.length ? {kind:'manual-clip', originalLanguage:'zh', paragraphs:{zh:paragraphs}, notice:'以下为登记人摘录与说明，不是原文全文；请打开来源链接核对原文。'} : undefined,
      summary: note || '人工登记线索。内容以登记摘录为准，尚未经编辑复核。',
      quote: quote || '登记时未摘录原文，请查看来源链接。',
      implication: '待编辑结合原文补充工程启示。',
      sector, scope: '国内', region: '中国', topicIds: [],
      time: '未披露', eventDate: '未披露', eventSort: 0,
      publishedDate: day,
      publishSort: known ? Number(day.replaceAll('-','')) * 10000 : 0,
      publishedAt: known ? new Date(day + 'T00:00:00+08:00').toISOString() : null,
      ai: 'AI 相关线索', maturity: '待判断', layer: '人工登记', engineeringStage: '待判断',
      evidence: '待复核', dataOrigin: 'manual', firstSeenAt: new Date(now()).toISOString(),
      editorial: {
        status: 'pending', reviewer: user, reviewedAt: new Date(now()).toISOString(),
        notes: sales.watchOrgId ? '人工登记；观察单位由登记人指定，仍需回链确认。' : '人工登记。',
        ...(sales.watchOrgId ? {watchOrgId: sales.watchOrgId} : {}),
      },
    };
    const stored = applyLane({...article, ...timelineFields(article)});
    db.prepare('INSERT INTO articles VALUES(?,?,?,?,?,?)').run(stored.id, url, JSON.stringify(stored), hash(JSON.stringify([stored.title, stored.publishedDate, stored.sourceUrl, stored.reading])), now(), now());
    return {article: stored};
  }
  // 批量登记：逐条校验、逐条入库，单条失败（如链接已入库）不影响其余条目；不抓取任何网页。
  function register(input, user) {
    if (Array.isArray(input?.items)) {
      const items = input.items.slice(0, 20);
      if (!items.length) throw new HttpError(400, '批量登记至少需要一条线索。');
      const results = [];
      for (let index = 0; index < items.length; index++) {
        try {
          const one = registerOne(items[index], user);
          results.push({index, ok: true, id: one.article.id, title: one.article.title});
        } catch (error) {
          results.push({index, ok: false, error: error.message});
        }
      }
      return {batch: true, results};
    }
    return registerOne(input, user);
  }
  function counts() {
    const rows = db.prepare('SELECT data FROM articles').all();
    const result = {pending:0, approved:0, rejected:0, archived:0, work:0};
    for (const row of rows) {
      const article = JSON.parse(row.data);
      const current = article.editorial?.status || 'pending';
      result[current] = (result[current] || 0) + 1;
      const priority = scoreArticle(article).priority;
      if (current === 'pending' && (priority === 'P0' || priority === 'P1')) result.work++;
    }
    return result;
  }
  function list(status='work') {
    if (!LIST_FILTERS.has(status)) throw new HttpError(400, '审核状态无效。');
    const rows = db.prepare('SELECT data,updated_at FROM articles ORDER BY updated_at DESC LIMIT 500').all();
    // 疑似同一事件建议：近 14 天入库记录做候选池，词面相似只做提示（待人工确认），不写 eventId。
    const poolRows = db.prepare('SELECT data FROM articles WHERE first_seen>=? ORDER BY first_seen DESC LIMIT 400')
      .all(now() - EVENT_SUGGEST_POOL_DAYS * 86400000)
      .map(row => JSON.parse(row.data))
      .map(a => ({id: a.id, title: a.title, sourceUrl: a.sourceUrl, source: a.source, publishedDate: a.publishedDate, eventId: a.editorial?.eventId}));
    const suggest = buildEventSuggester(poolRows);
    const articles = [];
    for (const row of rows) {
      const article = JSON.parse(row.data);
      const current = article.editorial?.status || 'pending';
      const scored = {...article, assistScore:scoreArticle(article)};
      if (!matchesFilter(status, current, scored.assistScore.priority)) continue;
      const eventHint = articles.length < 200 ? suggest(article) : [];
      articles.push({id:article.id, status:current, updatedAt:row.updated_at, article:scored, public: applyEditorial(article), ...(eventHint.length ? {eventHint} : {})});
    }
    if (status === 'work' || status === 'pending' || status === 'archived') {
      // 待办按 AI 销售价值分优先（机器判定，销售假设），其次按代码优先级与销售分。
      articles.sort((a, b) => (b.article.machineReview?.salesValue ?? -1) - (a.article.machineReview?.salesValue ?? -1) || (PRIORITY_RANK[a.article.assistScore?.priority] ?? 9) - (PRIORITY_RANK[b.article.assistScore?.priority] ?? 9) || (b.article.assistScore?.total || 0) - (a.article.assistScore?.total || 0) || b.updatedAt - a.updatedAt);
    }
    return {articles, counts:counts(), topics:topicCatalog, sales:salesCatalog()};
  }
  function save(id, input, reviewer) {
    const row = db.prepare('SELECT * FROM articles WHERE id=?').get(id);
    if (!row) throw new HttpError(404, '找不到这条入库记录。');
    const article = JSON.parse(row.data);
    article.editorial = parseEditorial(input, reviewer, extraOrgs());
    db.prepare('UPDATE articles SET data=?,updated_at=? WHERE id=?').run(JSON.stringify(article), now(), id);
    return {article, public: applyEditorial(article)};
  }
  // 批量人工审核：只改状态、复核人与时间，不覆盖已填的销售标签、核验记录与正文；逐条独立成败。
  function batchSave(input, reviewer) {
    const action = input.action;
    if (!BATCH_ACTIONS.has(action)) throw new HttpError(400, '批量操作仅支持发布、驳回或恢复待复核。');
    const ids = Array.isArray(input.ids) ? input.ids.filter(id => typeof id === 'string').slice(0, 100) : [];
    if (!ids.length) throw new HttpError(400, '请先勾选要处理的记录。');
    const results = [];
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      try {
        const row = db.prepare('SELECT * FROM articles WHERE id=?').get(id);
        if (!row) throw new HttpError(404, '找不到这条入库记录。');
        const article = JSON.parse(row.data);
        const ed = article.editorial || {};
        article.editorial = {...ed, status: action, reviewer, reviewedAt: new Date(now()).toISOString()};
        db.prepare('UPDATE articles SET data=?,updated_at=? WHERE id=?').run(JSON.stringify(article), now(), id);
        results.push({index, ok: true, id, title: article.title});
      } catch (error) {
        results.push({index, ok: false, id, error: error.message});
      }
    }
    return {batch: true, action, results};
  }
  // 人工合并/解除事件组：只在管理员显式操作下写/清 editorial.eventId，不改审核状态与核验字段。
  // 复用已有人工事件的编号；词面相似建议本身永远不会走到这里，只有管理员的确认会。
  function mergeEvents(input, reviewer) {
    const action = input?.action === 'clear' ? 'clear' : 'merge';
    const ids = [...new Set(Array.isArray(input?.ids) ? input.ids.filter(id => typeof id === 'string') : [])].slice(0, 20);
    if (ids.length < (action === 'clear' ? 1 : 2)) throw new HttpError(400, action === 'clear' ? '请选择要解除事件的记录。' : '合并事件至少需要两条记录。');
    const targets = ids.map(id => db.prepare('SELECT * FROM articles WHERE id=?').get(id)).filter(Boolean);
    if (targets.length < (action === 'clear' ? 1 : 2)) throw new HttpError(404, '部分记录不存在。');
    const existingEvent = targets.map(t => JSON.parse(t.data).editorial?.eventId).find(eventId => eventId && EVENT_ID_PATTERN.test(eventId));
    const eventId = action === 'clear' ? null : (existingEvent || 'ev-' + hash(ids.join('|')).slice(0, 10));
    const results = [];
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index];
      try {
        const row = db.prepare('SELECT * FROM articles WHERE id=?').get(id);
        if (!row) throw new HttpError(404, '找不到这条入库记录。');
        const article = JSON.parse(row.data);
        const notes = (article.editorial?.notes ? article.editorial.notes + '；' : '') + (action === 'clear' ? '人工解除事件组（' + reviewer + '）' : '人工合并为同一事件 ' + eventId + '（' + reviewer + '）');
        article.editorial = {...(article.editorial || {}), notes, ...(eventId ? {eventId} : {eventId: null})};
        db.prepare('UPDATE articles SET data=?,updated_at=? WHERE id=?').run(JSON.stringify(article), now(), id);
        results.push({index, ok: true, id, title: article.title});
      } catch (error) {
        results.push({index, ok: false, id, error: error.message});
      }
    }
    return {batch: true, action, eventId, results};
  }
  return {list, save, batchSave, counts, register, mergeEvents};
}
