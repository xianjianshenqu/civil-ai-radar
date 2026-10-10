// 情报分析（管理端）：新买家发现、观察覆盖盲区、信源产出统计。
// 全部基于已入库记录做代码统计：关键词频率与命中都不代表单位参与或采购；
// 覆盖统计在查询时用当前观察名单（含界面新增）重新匹配，新增单位立即生效。
import { matchWatchOrgs } from '../src/lib/scoring.js';
import { extractOrgNames, filterKnownOrgs } from '../src/lib/intel.js';

const DISCOVERY_NOTE = '按入库文本统计的单位名出现频率，是待回链确认的发现线索，不代表该单位参与或采购。';
const COVERAGE_NOTE = '按当前观察名单（含界面新增）对入库文本重新匹配；零命中可能是单位安静，也可能是信源盲区。';
const SOURCE_NOTE = '基于入库时的机器评分快照统计，用于决定扩源优先级，不是核验结果。';
// 招标/造价/项目代理机构在公告语料里高频出现，但不是买家观察对象，从发现候选中过滤（仍可手动加入名单）。
const AGENCY_HINT = /(招标|采购代理|造价咨询|管理咨询|项目管理|工程咨询|招标代理|监理)/;

function articleText(article) {
  return [
    article.title,
    article.summary,
    article.source,
    article.quote,
    ...(article.reading?.paragraphs?.zh || []),
  ].filter(Boolean).join('\n');
}
function articleStamp(article) {
  const stamp = Date.parse(article.publishedAt || '') || Date.parse(article.firstSeenAt || '');
  return Number.isFinite(stamp) ? stamp : 0;
}
function dayLabel(article) {
  return typeof article.publishedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(article.publishedDate) ? article.publishedDate : '';
}

export function createIntel({db, watchlist, now = Date.now}) {
  function loadArticles() {
    return db.prepare('SELECT data FROM articles ORDER BY updated_at DESC').all()
      .map(row => JSON.parse(row.data))
      .filter(article => article.editorial?.status !== 'rejected');
  }
  function inWindow(article, days) {
    return days <= 0 || articleStamp(article) >= now() - days * 86400000;
  }
  function discovery({days = 30, min = 2, limit = 15} = {}) {
    const orgs = watchlist.list();
    const aliases = orgs.flatMap(org => [org.name, ...(org.aliases || [])]);
    const counter = new Map();
    for (const article of loadArticles()) {
      if (!inWindow(article, days)) continue;
      const text = articleText(article);
      const names = filterKnownOrgs(extractOrgNames(text), aliases)
        .filter(name => name !== article.source && !article.source?.includes(name))
        .filter(name => !(AGENCY_HINT.test(name) && /公司|中心/.test(name)));
      for (const name of new Set(names)) {
        const bucket = counter.get(name) || {name, count: 0, last: '', samples: []};
        bucket.count += 1;
        const day = dayLabel(article);
        if (day && day > bucket.last) bucket.last = day;
        if (bucket.samples.length < 3) bucket.samples.push({id: article.id, title: article.title, url: article.sourceUrl});
        counter.set(name, bucket);
      }
    }
    const rows = [...counter.values()]
      .filter(row => row.count >= min)
      .sort((a, b) => b.count - a.count || (b.last || '').localeCompare(a.last || ''))
      .slice(0, limit);
    return {days, min, note: DISCOVERY_NOTE, candidates: rows};
  }
  function coverage({days = 90} = {}) {
    const orgs = watchlist.list();
    const stats = new Map(orgs.map(org => [org.id, {id: org.id, name: org.name, layer: org.layer, isBuyer: org.isBuyer, count: 0, last: ''}]));
    for (const article of loadArticles()) {
      if (!inWindow(article, days)) continue;
      const tagged = article.editorial?.watchOrgId;
      const hit = new Set(matchWatchOrgs(articleText(article)).map(w => w.id));
      if (tagged) hit.add(tagged);
      for (const id of hit) {
        const bucket = stats.get(id);
        if (!bucket) continue;
        bucket.count += 1;
        const day = dayLabel(article);
        if (day && day > bucket.last) bucket.last = day;
      }
    }
    const rows = [...stats.values()].sort((a, b) => a.count - b.count || a.name.localeCompare(b.name, 'zh'));
    return {days, note: COVERAGE_NOTE, zeroCount: rows.filter(r => !r.count).length, orgs: rows};
  }
  function sourceStats() {
    const stats = new Map();
    for (const article of loadArticles()) {
      const key = article.sourceId || (article.dataOrigin === 'manual' ? 'manual-intake' : article.source);
      const bucket = stats.get(key) || {sourceId: key, source: article.source, dataOrigin: article.dataOrigin || 'collector', total: 0, work: 0, approved: 0, archived: 0};
      bucket.total += 1;
      const priority = article.assistScore?.priority;
      if (priority === 'P0' || priority === 'P1') bucket.work += 1;
      const status = article.editorial?.status || 'pending';
      if (status === 'approved') bucket.approved += 1;
      if (status === 'archived') bucket.archived += 1;
      stats.set(key, bucket);
    }
    const rows = [...stats.values()].sort((a, b) => b.work - a.work || b.total - a.total);
    return {note: SOURCE_NOTE, sources: rows};
  }
  return {discovery, coverage, sourceStats};
}
