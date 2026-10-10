import { AI, ENGINEERING } from '../src/lib/scoring.js';
import { applyLane } from '../src/lib/machineReview.js';
import { timelineFields } from '../src/lib/timeline.js';
import { hash } from './auth.mjs';

const WINDOW_DAYS = 30;
const CROSSREF_ROWS = 40;
const OPENALEX_ROWS = 50;
export const ACADEMIC_NOTICE = '论文摘要来自 Crossref 或 OpenAlex 登记元数据，不是出版社全文，也不是采购或部署证据。作者单位取自论文署名，不等于该机构正在采购。';

function array(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function asText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(' ');
  if (value && typeof value === 'object' && typeof value['#text'] === 'string') return value['#text'];
  return '';
}
function stripXml(value) {
  return asText(value).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
export function sinceDay(now, days = WINDOW_DAYS) {
  const stamp = typeof now === 'function' ? now() : now;
  return new Date(stamp - days * 86400000).toISOString().slice(0, 10);
}
export function doiHref(value) {
  const id = String(value || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  if (!/^10\.\d{4,9}\/\S+$/i.test(id)) return null;
  try {
    const url = new URL('https://doi.org/' + id.replace(/\/+$/, ''));
    if (url.hostname !== 'doi.org' || url.username || url.password) return null;
    url.hash = '';
    url.protocol = 'https:';
    return url.href;
  } catch {
    return null;
  }
}
export function openAlexHref(value) {
  const match = String(value || '').match(/\bW\d+\b/i);
  return match ? 'https://openalex.org/' + match[0] : null;
}
function issuedDay(record) {
  const parts = record?.issued?.['date-parts']?.[0] || record?.published?.['date-parts']?.[0] || record?.['published-online']?.['date-parts']?.[0];
  if (!Array.isArray(parts) || !parts[0]) return {day:'未披露', stamp:NaN};
  const year = Number(parts[0]);
  const month = Number(parts[1] || 1);
  const day = Number(parts[2] || 1);
  if (!Number.isInteger(year) || year < 1900) return {day:'未披露', stamp:NaN};
  const iso = new Date(Date.UTC(year, Math.max(0, month - 1), Math.max(1, day))).toISOString();
  return {day: iso.slice(0, 10), stamp: Date.parse(iso)};
}
function affiliationsFromCrossref(record) {
  const names = [];
  for (const author of array(record.author)) {
    for (const aff of array(author.affiliation)) {
      const name = stripXml(aff.name || aff);
      if (name) names.push(name);
    }
  }
  return [...new Set(names)];
}
function affiliationsFromOpenAlex(work) {
  const names = [];
  for (const authorship of array(work.authorships)) {
    for (const inst of array(authorship.institutions)) {
      if (inst?.country_code && inst.country_code !== 'CN') continue;
      const name = stripXml(inst?.display_name);
      if (name) names.push(name);
    }
    const raw = stripXml(authorship.raw_affiliation_strings?.join?.(' ') || authorship.raw_affiliation_string);
    if (raw) names.push(raw);
  }
  return [...new Set(names)];
}
export function uninvertAbstract(index) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) return '';
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (Number.isInteger(pos) && pos >= 0 && pos < 4000) words[pos] = String(word);
    }
  }
  return words.filter(Boolean).join(' ').slice(0, 8000);
}
function academicArticle({url, title, sourceName, source, abstract, affiliations, publishedDay, publishedStamp, now}) {
  const affix = affiliations.length ? `作者单位（论文元数据）：${affiliations.slice(0, 8).join('；')}。单位出现不等于该机构正在采购。` : '';
  const haystack = [title, abstract, sourceName, affiliations.join(' ')].join('\n');
  if (!AI.test(haystack) || !ENGINEERING.test(haystack) || !title || !url) return null;
  const language = /[\u3400-\u9fff]/u.test(abstract || title) ? 'zh' : 'en';
  const paragraphs = [abstract, affix].map(text => stripXml(text)).filter(Boolean);
  const known = Number.isFinite(publishedStamp);
  const day = known ? publishedDay : '未披露';
  const reading = paragraphs.length ? {
    kind: 'academic-abstract',
    originalLanguage: language,
    paragraphs: {[language]: paragraphs},
    notice: ACADEMIC_NOTICE,
  } : undefined;
  const article = {
    id: 'feed-' + hash(url).slice(0, 24),
    sourceUrl: url,
    title: title.slice(0, 300),
    source: sourceName || source.name,
    sourceId: source.id,
    reading,
    summary: '由公开学术元数据自动发现的国内土木论文。请查阅 DOI 原文确认内容，尚未经编辑复核，不能当成采购信号。',
    quote: '论文题名、发表日期与作者单位来自 Crossref 或 OpenAlex；不代表已核验工程事实。',
    implication: '待编辑结合原文补充工程启示。',
    sector: source.sector,
    scope: source.scope || '国内',
    region: source.region || '中国',
    topicIds: source.topicIds || [],
    time: '未披露',
    eventDate: '未披露',
    eventSort: 0,
    publishedDate: day,
    publishSort: known ? Number(day.replaceAll('-', '')) * 10000 : 0,
    publishedAt: known ? new Date(publishedStamp).toISOString() : null,
    ai: 'AI 相关线索',
    maturity: '研究',
    layer: '研究',
    engineeringStage: '待判断',
    evidence: '待复核',
    dataOrigin: 'collector',
    academic: true,
    firstSeenAt: new Date(now).toISOString(),
  };
  return applyLane({...article, ...timelineFields(article)}, source);
}
export function parseCrossrefWorks(json, source, now = Date.now()) {
  const items = json?.message?.items;
  if (!json || typeof json !== 'object' || !Array.isArray(items)) throw new Error('Crossref response is not a work list');
  const result = new Map();
  for (const record of items.slice(0, CROSSREF_ROWS)) {
    const title = stripXml(array(record.title)[0]).slice(0, 300);
    const url = doiHref(record.DOI);
    if (!url || !title) continue;
    const issued = issuedDay(record);
    const journal = stripXml(array(record['container-title'])[0]) || source.name;
    const article = academicArticle({
      url, title, sourceName: journal, source,
      abstract: stripXml(record.abstract),
      affiliations: affiliationsFromCrossref(record),
      publishedDay: issued.day, publishedStamp: issued.stamp, now,
    });
    if (article) result.set(url, article);
  }
  return [...result.values()];
}
export function parseOpenAlexWorks(json, source, now = Date.now()) {
  const items = json?.results;
  if (!json || typeof json !== 'object' || !Array.isArray(items)) throw new Error('OpenAlex response is not a work list');
  const result = new Map();
  for (const work of items.slice(0, OPENALEX_ROWS)) {
    const title = stripXml(work.display_name || work.title).slice(0, 300);
    const url = doiHref(work.doi) || ((source.articleHosts || []).includes('openalex.org') ? openAlexHref(work.id) : null);
    if (!url || !title) continue;
    const stamp = Date.parse(work.publication_date);
    const known = Number.isFinite(stamp);
    const journal = stripXml(work.primary_location?.source?.display_name) || source.name;
    const article = academicArticle({
      url, title, sourceName: journal, source,
      abstract: uninvertAbstract(work.abstract_inverted_index) || stripXml(work.abstract),
      affiliations: affiliationsFromOpenAlex(work),
      publishedDay: known ? new Date(stamp).toISOString().slice(0, 10) : '未披露',
      publishedStamp: stamp, now,
    });
    if (article) result.set(url, article);
  }
  return [...result.values()];
}
function academicHeaders(mailto) {
  const ua = mailto ? `CivilAIRadar/1.0 (mailto:${mailto})` : 'CivilAIRadar/1.0';
  return {'User-Agent': ua, Accept: 'application/json'};
}
export function crossrefUrl(issn, fromDay) {
  const url = new URL('https://api.crossref.org/works');
  url.searchParams.set('filter', `issn:${issn},from-created-date:${fromDay},type:journal-article`);
  url.searchParams.set('rows', String(CROSSREF_ROWS));
  url.searchParams.set('sort', 'published');
  url.searchParams.set('order', 'desc');
  return url.href;
}
export function openAlexUrl(source, fromDay, mailto) {
  const url = new URL(source.url || 'https://api.openalex.org/works');
  const topics = array(source.topics).filter(id => /^T\d+$/.test(id)).join('|');
  const country = source.country || 'CN';
  const filters = [
    `authorships.institutions.country_code:${country}`,
    `from_publication_date:${fromDay}`,
    'type:article',
  ];
  if (topics) filters.push(`topics.id:${topics}`);
  url.searchParams.set('filter', filters.join(','));
  url.searchParams.set('search', 'intelligent construction digital twin BIM 智能建造 智慧工地 数字孪生 人工智能 机器学习 智慧电厂 变电站巡检 风电场 光伏电站 油气管道 智能巡检');
  url.searchParams.set('per_page', String(OPENALEX_ROWS));
  url.searchParams.set('sort', 'publication_date:desc');
  if (mailto) url.searchParams.set('mailto', mailto);
  return url.href;
}
async function readJson(response, boundedText) {
  if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
  const raw = await boundedText(response);
  if (raw.length > 1500000) throw new Error('Academic response too large');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Academic source is not JSON');
  }
}
export async function collectAcademic(source, {safeFetch, boundedText, now = Date.now, mailto = ''} = {}) {
  const kind = source.kind;
  const fromDay = sinceDay(now);
  const stamp = typeof now === 'function' ? now() : now;
  if (kind === 'crossref') {
    const journals = array(source.issns).filter(item => item && /^[0-9]{4}-[0-9]{3}[0-9Xx]$/.test(item.issn));
    if (!journals.length) throw new Error('Crossref source has no verified ISSN list');
    const merged = new Map();
    const errors = [];
    for (const journal of journals) {
      try {
        const response = await safeFetch(crossrefUrl(journal.issn, fromDay), {headers: academicHeaders(mailto)});
        for (const article of parseCrossrefWorks(await readJson(response, boundedText), {...source, name: journal.name || source.name}, stamp)) {
          merged.set(article.sourceUrl, article);
        }
      } catch (error) {
        errors.push(`${journal.issn}: ${error.message}`);
      }
    }
    if (!merged.size && errors.length) throw new Error(errors.join('; '));
    return [...merged.values()];
  }
  if (kind === 'openalex') {
    const response = await safeFetch(openAlexUrl(source, fromDay, mailto), {headers: academicHeaders(mailto)});
    return parseOpenAlexWorks(await readJson(response, boundedText), source, stamp);
  }
  throw new Error('Source is not an academic API');
}
