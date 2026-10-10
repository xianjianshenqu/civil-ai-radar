import { radarEntries as rawEntries, dailyRadarMeta } from '../data/radarData.js';
import { completeVerification, isHttpUrl } from './evidence.js';
import { topicAssignments } from '../data/topicAssignments.js';
import { dailyRadarEntries } from '../data/generatedRadarEntries.js';
import { getReading } from './reading.js';
import { SOURCE_TIER_LABELS, scoreArticle } from './scoring.js';
import { matchTopics } from './topicMatch.js';
import { timelineFields } from './timeline.js';
import { noticeClassOf } from './intel.js';
import { procurementRecordIds } from './procurementIdentity.js';
const importedIds = new Set(dailyRadarEntries.map(e => e.id));
export const batchDate = dailyRadarMeta.updatedAt || '未入库';
export const HOT_LIMIT = 10;
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0,10) === value;
}
export function localDay(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai'}).format(now);
}
export function publishedDay(item) { return validDate(item.publishedDate) ? item.publishedDate : ''; }
export function timelineDay(item) {
  if (validDate(item?.timelineDay)) return item.timelineDay;
  return publishedDay(item);
}
export function listDateLabel(item) {
  if (item?.time && item.time !== '未披露') return item.time;
  return timelineDay(item) || item?.publishedDate || '未披露';
}
export function publishedCaption(item) {
  const published = publishedDay(item);
  const collected = validDate(item?.timelineDay) ? item.timelineDay : '';
  if (!published && collected) return `收录 ${collected}（公开日期未披露）`;
  if (published && collected && published !== collected && item.timelineKind === 'discovered') {
    return `首次公开 ${published} · 收录 ${collected}`;
  }
  if (published) return `首次公开 ${published}`;
  return '公开日期未披露';
}
export function inWindow(item, days, now = new Date()) {
  const day = timelineDay(item);
  if (!day) return false;
  const age = +new Date(localDay(now)+'T00:00:00+08:00') - +new Date(day+'T00:00:00+08:00');
  return age >= 0 && age < days * 86400000;
}
export function isUpcoming(item, now = new Date()) {
  return /^\d{4}-\d{2}-\d{2}/.test(item.eventDate) && item.eventDate.slice(0,10) > localDay(now);
}
export function isFeatured(item) {
  if (Number.isInteger(item?.featuredRank) && item.featuredRank >= 1) return true;
  return item?.salesScore?.featured === true;
}
// 同分、且没有更靠前的编辑置顶时，仍在招标的公告排在已中标/更正以及同分的其他条目前。
// 这是可传递的排序键，不改 salesScore。分数更高的中标公告、以及 featuredRank 更小的编辑置顶，仍排在前面。
function noticeFollowKey(item) {
  return noticeClassOf(item) === 'tender' ? 0 : 1;
}
export function featuredSort(a, b) {
  const score = (item) => (item.salesScore?.featured ? 100 : 0) + (item.salesScore?.total || 0);
  return score(b) - score(a) || (a.featuredRank || 999) - (b.featuredRank || 999) || noticeFollowKey(a) - noticeFollowKey(b) || (b.publishSort || 0) - (a.publishSort || 0);
}
export function recommendReason(item) {
  if (item?.isDemo) return {text: item.verification, kind: 'demo'};
  const implication = String(item?.implication || '');
  const editorial = implication && !implication.startsWith('待编辑') && (item?.reviewed || item?.dataOrigin !== 'collector');
  if (editorial) return {text: implication, kind: item?.reviewed ? 'editorial' : 'catalog'};
  const machine = item?.machineReview;
  if (machine?.implication || machine?.summary) {
    return {text: machine.implication || machine.summary, kind: 'machine'};
  }
  if (item?.salesScore?.reason) return {text: item.salesScore.reason, kind: 'auto'};
  return implication && !implication.startsWith('待编辑') ? {text: implication, kind: 'catalog'} : null;
}
export function recommendReasonLabel(kind) {
  if (kind === 'auto') return '自动评分理由';
  if (kind === 'machine') return '机器整理';
  if (kind === 'editorial' || kind === 'catalog') return '推荐理由';
  if (kind === 'demo') return '演示说明';
  return '';
}
export function entryOrigin(item) {
  if (isFeatured(item)) return '精选';
  if (item?.dataOrigin === 'manual') return '登记';
  if (item?.dataOrigin === 'collector') return '采集';
  return '入库';
}
function isArticleUrl(url) {
  if (!isHttpUrl(url)) return false;
  try { return new URL(url).pathname !== '/'; } catch { return false; }
}
export function editorialSources(item) {
  const out = [];
  const seen = new Set();
  const add = (name, url, type) => {
    if (!isArticleUrl(url) || seen.has(url)) return;
    seen.add(url);
    out.push({name: name || item.source, url, type});
  };
  add(item.source, item.sourceUrl, '入库来源');
  for (const extra of item.procurement?.sources || []) add(extra.source, extra.sourceUrl, '公告来源');
  for (const ref of item.verificationRecord?.references || []) add(ref.title, ref.url, '核验引用');
  return out;
}
export function groupByDay(list) {
  const groups = [];
  const map = new Map();
  for (const item of list) {
    const day = timelineDay(item);
    if (!map.has(day)) {
      const group = {day, items: []};
      map.set(day, group);
      groups.push(group);
    }
    map.get(day).items.push(item);
  }
  return groups.sort((a, b) => !a.day ? 1 : !b.day ? -1 : b.day.localeCompare(a.day));
}
export function formatDayLabel(day) {
  if (!validDate(day)) return '公开日期未披露';
  const [, month, date] = day.split('-');
  return `${Number(month)}月${Number(date)}日`;
}
export function buildHotEvents(list) {
  const groups = new Map();
  for (const item of list) {
    if (!isFeatured(item)) continue;
    const key = item.eventId || item.id;
    const group = groups.get(key) || {id: key, items: []};
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const items = group.items.slice().sort(featuredSort);
    const lead = items[0];
    const rec = recommendReason(lead);
    const seen = new Set();
    const sources = [];
    for (const item of items) {
      for (const source of editorialSources(item)) {
        if (seen.has(source.url)) continue;
        seen.add(source.url);
        sources.push(source);
      }
    }
    return {
      id: group.id,
      leadId: lead.id,
      title: lead.title,
      summary: lead.summary,
      implication: rec?.text || '',
      recommendKind: rec?.kind || '',
      salesScore: lead.salesScore,
      featuredRank: lead.featuredRank,
      publishSort: Math.max(...items.map(item => item.publishSort || 0)),
      eventDate: lead.eventDate,
      publishedDate: lead.publishedDate,
      sector: lead.sector,
      noticeClass: noticeClassOf(lead),
      source: lead.source,
      evidence: lead.evidence,
      upcoming: items.some(item => isUpcoming(item)),
      itemCount: items.length,
      items,
      sources,
    };
  }).sort((a, b) => featuredSort(a, b)).slice(0, HOT_LIMIT);
}
export function normalizeEntry(e, isDemo = !importedIds.has(e.id)) {
  const verified = !isDemo && completeVerification(e.verificationRecord);
  const sourceUrl = !isDemo && isHttpUrl(e.sourceUrl) ? e.sourceUrl : '';
  const featuredRank = Number.isInteger(e.featuredRank) && e.featuredRank >= 1 ? e.featuredRank : undefined;
  const timeline = e.timelineDay ? e : timelineFields(e);
  const salesScore = scoreArticle({...e, ...timeline, isDemo});
  // 主题库自动归题：关键词命中只代表主题相关性；编辑/信源指定的主题保持优先展示。
  const editorialTopicIds = e.topicIds || topicAssignments[e.id] || [];
  const autoTopicIds = isDemo ? [] : matchTopics([e.title, e.summary, e.source, e.ai, e.region, ...(e.reading?.paragraphs?.zh || []).slice(0, 3)].join('\n'));
  const topicIds = [...new Set([...editorialTopicIds, ...autoTopicIds])];
  return {...e, ...timeline, isDemo, featuredRank, topicIds, autoTopicIds, sourceUrl, sourceDomain: sourceUrl ? new URL(sourceUrl).hostname : '',
    sourceTierLabel: SOURCE_TIER_LABELS[e.sourceTier] || SOURCE_TIER_LABELS[salesScore.sourceTier] || '',
    evidence: isDemo ? '演示数据' : verified ? '已核验' : '待复核',
    verificationRecord: verified ? e.verificationRecord : null,
    verification: isDemo ? '原型演示，不能作为工程事实引用。' : verified ? `已记录复核人：${e.verificationRecord.reviewer}；核验结论仅覆盖下列证据。` : e.dataOrigin==='collector' ? (e.academic ? '公开学术元数据自动发现的论文线索，尚未经编辑复核。' : '公开订阅源自动发现的线索，尚未经编辑复核。') : '历史入库条目保留来源入口；尚缺逐项核验记录，不能视作独立复核通过。',
    salesScore, assistScore: salesScore,
    heatScore: null, hotStatus: isDemo ? '演示' : featuredRank ? '编辑置顶' : salesScore.featured ? '销售推荐' : '待复核', hotTimeAgo: e.publishedDate,
    sourcesAggregated: editorialSources({...e, sourceUrl, verificationRecord: verified ? e.verificationRecord : null}),
    revision: JSON.stringify([e.title,e.summary,e.implication,e.sourceUrl,e.publishedDate,e.eventDate,e.maturity,e.verificationRecord,e.metrics,e.deploymentRequirements,getReading(e)]),
  };
}
export function mergeCollected(seedEntries, seedBatchDate, liveArticles = []) {
  const knownUrls = new Set(seedEntries.map(e => e.sourceUrl).filter(Boolean));
  const added = liveArticles.filter(e => !knownUrls.has(e.sourceUrl)).map(e => normalizeEntry(e, false));
  return {entries:[...added, ...seedEntries], batchDate: seedBatchDate, collectedEntries: added, collectedCount: added.length};
}
export function isDetailVisible(item, demo) {
  return Boolean(item) && (demo === 'yes' || !item.isDemo);
}
export const entries = rawEntries.map(e => normalizeEntry(e));
export const defaults = {nav:'今日精选',sector:'全部',q:'',time:'新公开',scope:'全部',stage:'全部',maturity:'全部',evidence:'全部',offering:'全部',from:'',to:'',window:'all',demo:'no',topic:'',category:'all',sort:'销售评分',group:'全部',date:'',origin:'全部',notice:'全部',period:'daily',agent:'接入'};
export function readRoute(search = window.location.search) {
  const p = new URLSearchParams(search);
  return Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,p.get(k) || v]));
}
export function filterEntries(list, f, {saved=[],followed=[]} = {}) {
  return list.filter(e => {
    if (f.demo !== 'yes' && e.isDemo) return false;
    if ((f.nav === '今日精选' || f.nav === '热点榜') && !isFeatured(e)) return false;
    if (f.nav === '全部动态' && f.origin === '精选' && !isFeatured(e)) return false;
    if (f.nav === '全部动态' && f.origin === '采集' && e.dataOrigin !== 'collector' && e.dataOrigin !== 'manual') return false;
    if (f.nav === '全部动态' && f.origin === '登记' && e.dataOrigin !== 'manual') return false;
    if (f.nav === '全部动态' && f.origin === '入库' && (e.dataOrigin === 'collector' || e.dataOrigin === 'manual')) return false;
    if (f.nav === '收藏' && !procurementRecordIds(e).some(id => saved.includes(id))) return false;
    if (f.nav === '我的关注' && !procurementRecordIds(e).some(id => followed.includes(id))) return false;
    if ((f.nav === '国内雷达' || f.scope === '国内') && e.scope !== '国内') return false;
    if (f.scope === '海外' && e.scope !== '海外') return false;
    if (f.nav === '工程案例' && (e.layer !== '项目落地' || !['试点','已部署'].includes(e.maturity))) return false;
    if (f.sector !== '全部' && e.sector !== f.sector) return false;
    if (f.stage !== '全部' && e.engineeringStage !== f.stage) return false;
    if (f.maturity !== '全部' && e.maturity !== f.maturity) return false;
    if (f.evidence !== '全部' && e.evidence !== f.evidence) return false;
    // 业务切口按自动评分的切口识别筛选；这是代码判断的销售假设，不是人工标签。
    if (f.offering && f.offering !== '全部' && !(e.salesScore?.offerings || []).includes(f.offering)) return false;
    const day = publishedDay(e);
    if ((f.from || f.to) && !day) return false;
    if (f.from && day < f.from || f.to && day > f.to) return false;
    if (f.window !== 'all' && !inWindow(e,Number(f.window))) return false;
    const text = [e.title,e.summary,e.source,e.region,e.sector,e.ai,e.engineeringStage,e.implication].join(' ').toLowerCase();
    return !f.q.trim() || text.includes(f.q.trim().toLowerCase());
  }).sort((a,b) => {
    if (f.nav === '今日精选' || f.nav === '热点榜') {
      const ranked = featuredSort(a, b);
      if (ranked) return ranked;
    }
    return f.time === '新发生' ? b.eventSort-a.eventSort : (b.timelineSort||b.publishSort||0)-(a.timelineSort||a.publishSort||0);
  });
}
export function formatReport(list, title='土木 AI 雷达 · 情报摘录') {
  return [title,`导出日期：${localDay()} · 数据批次：${batchDate}`, ...list.flatMap(e => [
    '',e.title,`状态：${e.evidence} · ${e.verification}`,`来源：${e.source} · 首次公开：${e.publishedDate}`,`摘要：${e.summary}`,`工程启示（编辑分析）：${e.implication || '未提供'}`,`原文：${e.sourceUrl || '演示条目无可引用来源'}`
  ])].join('\n');
}
export function downloadText(text,name,type='text/plain;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([text],{type})); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
