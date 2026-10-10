// Code-only sales scoring. Never writes featuredRank or verification records.
import { offeringLabel, orgWatchlist, PRODUCT_OFFERINGS } from '../data/orgWatchlist.js';

export const AI = /\bAI\b|\bLLM\b|artificial intelligence|machine learning|deep learning|digital twin|computer vision|neural network|\bintelligent\b|robot|smart construction|smart site|intelligent construction|智能|人工智能|数字孪生|大模型|智慧|数智|机器学习|深度学习|计算机视觉|机器视觉|机器人/i;
export const ENGINEERING = /construction|infrastructure|\bAEC\b|\bBIM\b|bridge|civil|rail|pavement|tunnel|hydropower|hydraulic|highway|railway|concrete|geotechnical|petrochemical|refinery|pipeline|solar|photovoltaic|wind farm|energy storage|power plant|substation|transmission|nuclear power|风电|电网|电力|水电|隧道|公路|铁路|大坝|基建|水库|交通|建筑|工程|施工|建造|桥梁|水利|装配式|盾构|基坑|选线|勘察|岩土|设计院|市政|工地|石化|炼化|油气|油田|化工|管道|乙烯|炼油|光伏|储能|新能源|抽水蓄能|电厂|变电站|输电|配电|核电|风电场/i;

export const SOURCE_TIER_LABELS = {t1:'一手信源', t1_5:'官方渠道', t2:'转载发现'};
const SOURCE_SCORE = {t1:90, t1_5:70, t2:40};
const BUYER_LAYER_SCORE = {unit:100, overseas:95, standard:82, group:78};
const FEATURED_MIN = 50;
const FEATURED_BUYER_MIN = 50;

const OFFERING_PATTERNS = {
  咨询: /数智化|数字化转型|数字化部|智能建造|数据治理|组织落地|信息化规划|智慧工地|enterprise.?ai|digital transformation|data governance|copilot|智能体|大模型战略|场景落地|大模型应用/i,
  知识库: /知识库|知识中台|规范审查|标准数字化|岗位问答|图纸检索|规程|knowledge base|specification review|企业知识|智能问答|条文检索|规范库|标准库|知识管理/i,
  翻译: /翻译|海外工程|一带一路|FIDIC|英文招标|国际工程|联合体|中文交付|language barrier|bilingual|localization|overseas project|belt and road|global best practice|翻译服务|多语言|出海|属地化|境外项目/i,
  算量: /算量|造价|工程量清单|计量支付|技经|takeoff|quantity takeoff|bill of quantities|cost estimat|\bBOQ\b|quantity surveying|算量软件|造价软件|清单编制/i,
  培训: /培训|大赛|竞赛|认证|党校|管理学院|技能竞赛|智能建造人才|workshop|upskilling|academy|innovation contest/i,
};

const ACTION_HIGH = /招标|采购|试点|部署|成立.{0,10}(中心|部门|学院)|可复制经验|报名|培训班|签约|破冰|征集|招聘|诚聘|人才引进/i;
const ACTION_MID = /发布|推出|合作|规划|战略|路线图|launch|partner|pilot/i;
const RESEARCH_HINT = /mdpi|frontiers|nature\.com|sciencedaily|sciencenet|cae-|engineering\.org\.cn|中国工程院|中国工程科学|arxiv|crossref|openalex|doi\.org|special issue|call for papers/i;
const VENDOR_HINT = /autodesk|trimble|bentley|revit|navisworks|buildingsmart|广联达|glodon/i;
const FRONTIER_HIGH = /智能体|\bagents?\b|workflow.?orchestr|规范审查|图纸.{0,8}(大模型|检索|审查)|point.?cloud|点云|现场视频|现场影像|多模态|digital twin|数字孪生|BIM.{0,24}(决策|AI|人工智能)|AI.{0,16}(算量|造价)|quantity takeoff|computer vision.{0,24}(site|construction|bridge)/i;
const FRONTIER_MID = /安全视觉|进度识别|缺陷识别|\bdrone\b|无人机|行业大模型|construction copilot|扫描决策/i;
const FRONTIER_LOW = /autodesk university|\bAU 20\d{2}\b|special issue|call for papers|webinar|office copilot|chatgpt|hydraulic fracturing|油气|压裂|innovation sessions|session agenda|40 under 40/i;
export const REVIEW_PRIORITIES = ['P0','P1','P2','P3'];

export function normalizeTier(value) {
  return SOURCE_TIER_LABELS[value] ? value : 't2';
}

function articleText(article) {
  return [
    article.title,
    article.summary,
    article.source,
    ...(article.reading?.paragraphs?.zh || []),
    ...(article.reading?.paragraphs?.en || []),
  ].join('\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function aliasPattern(alias) {
  const escaped = escapeRegExp(alias);
  if (/^[A-Za-z0-9]{2,8}$/.test(alias)) return new RegExp(`\\b${escaped}\\b`, 'i');
  return new RegExp(escaped, 'i');
}

// 附加观察名单：管理端在界面新增的单位（存后台 meta 表），与静态名单合并参与关键词计分。
// 只影响代码评分与发现统计，不写任何「已核验」字段。
let extraWatchOrgs = [];
export function setWatchOrgExtras(list) {
  extraWatchOrgs = Array.isArray(list) ? list.filter(o => o && o.id && o.name) : [];
}
export function getWatchOrgs() {
  return [...orgWatchlist, ...extraWatchOrgs];
}

export function matchWatchOrgs(text) {
  const haystack = String(text || '');
  const needles = [];
  for (const org of getWatchOrgs()) {
    for (const alias of [org.name, ...(org.aliases || [])]) {
      if (alias && alias.length >= 2) needles.push({org, alias});
    }
  }
  needles.sort((a, b) => b.alias.length - a.alias.length);
  const used = [];
  const matched = new Map();
  for (const {org, alias} of needles) {
    if (matched.has(org.id)) continue;
    const found = haystack.match(aliasPattern(alias));
    if (!found || found.index == null) continue;
    const start = found.index;
    const end = start + found[0].length;
    // 中国石油大学、三峡学院等以单位名开头的院校不是该单位的参与证据。
    if (/^(大学|学院)/.test(haystack.slice(end, end + 2))) continue;
    if (used.some(span => start < span.end && end > span.start)) continue;
    used.push({start, end});
    matched.set(org.id, {id: org.id, name: org.name, layer: org.layer, isBuyer: org.isBuyer, offerings: org.offerings});
  }
  return [...matched.values()];
}

export function matchOfferings(text) {
  return PRODUCT_OFFERINGS.filter(id => OFFERING_PATTERNS[id].test(text));
}

function offeringScore(offerings) {
  if (!offerings.length) return 12;
  const product = offerings.filter(id => id !== '咨询').length;
  return Math.min(100, 52 + offerings.length * 16 + product * 12);
}

function buyerScore(watchOrgs, vendorIntel) {
  const buyers = watchOrgs.filter(org => org.isBuyer);
  if (buyers.length) {
    const best = Math.max(...buyers.map(org => BUYER_LAYER_SCORE[org.layer] || 70));
    return Math.min(100, best + (buyers.length > 1 ? 8 : 0));
  }
  if (watchOrgs.length) return 28;
  if (vendorIntel) return 12;
  return 8;
}

function actionScore(text) {
  if (ACTION_HIGH.test(text)) return 88;
  if (ACTION_MID.test(text)) return 62;
  return 28;
}

function freshnessScore(article) {
  const kind = article.timelineKind;
  if (kind === 'discovered') return 100;
  if (kind === 'backfill') return 28;
  if (kind === 'same-day' || kind === 'published') return 72;
  return 55;
}

function isResearch(article, text) {
  const blob = [article.sourceId, article.source, article.sourceUrl, article.layer, text].join(' ');
  return article.layer === '研究' || RESEARCH_HINT.test(blob);
}

function salesStageFor({buyers, watchOrgs, vendorIntel, offerings}) {
  if (!offerings.length) return '待判断';
  if (buyers.length) return '了解需求';
  if (watchOrgs.length || vendorIntel) return '仅市场观察';
  return '待判断';
}

function canAutoFeature({offerings, buyers, vendorIntel, research, total}) {
  if (!offerings.length) return false;
  if (research && !buyers.length) return false;
  if (vendorIntel && !buyers.length) return false;
  if (buyers.length) return total >= FEATURED_BUYER_MIN;
  if (offerings.length === 1 && offerings[0] === '咨询') return total >= 60;
  return total >= FEATURED_MIN;
}

function frontierScore(text, {research, vendorIntel}) {
  if (FRONTIER_LOW.test(text) && !FRONTIER_HIGH.test(text)) return 18;
  if (FRONTIER_HIGH.test(text)) return research ? 72 : 90;
  if (FRONTIER_MID.test(text)) return 62;
  if (research) return 22;
  if (vendorIntel) return 28;
  return 24;
}

export function reviewPriority({offerings, buyers, vendorIntel, research, total, frontier, action, featured}) {
  const product = (offerings || []).filter(id => PRODUCT_OFFERINGS.includes(id));
  if (buyers?.length && product.length && action >= 80) return 'P0';
  if (research && !buyers?.length) return 'P3';
  if (!product.length && frontier < 55) return 'P3';
  if (vendorIntel && !buyers?.length) return 'P2';
  if (featured || frontier >= 70 || total >= 60) return 'P1';
  if (vendorIntel || product.length) return 'P2';
  return 'P3';
}

function salesReason({offerings, watchOrgs, buyers, vendorIntel, research, featured, priority}) {
  const bits = [];
  if (offerings.length) bits.push(`可能切口：${offerings.map(offeringLabel).join('、')}`);
  if (buyers.length) bits.push(`观察名单命中 ${buyers.map(org => org.name).join('、')}（关键词命中，待回链确认）`);
  else if (watchOrgs.length) bits.push(`命中市场观察对象 ${watchOrgs.map(org => org.name).join('、')}，不是买家线索`);
  else if (vendorIntel) bits.push('厂商/市场观察，不是买家线索');
  if (research) bits.push('偏研究公开，销售优先级较低');
  if (priority === 'P0') bits.push('P0 可破冰候选，需人工回链');
  else if (priority === 'P1') bits.push(featured ? 'P1 机器发布，已按销售价值进入推荐' : 'P1 机器发布');
  else if (priority === 'P2') bits.push('P2 市场观察');
  else bits.push('P3 自动归档，全部动态仍可见');
  bits.push('自动评分，待复核，不代表正在采购');
  return bits.join('。') + '。';
}

export function scoreArticle(article, source = {}) {
  const tier = normalizeTier(source.tier || article.sourceTier);
  const text = articleText(article);
  const offerings = matchOfferings(text);
  const watchOrgs = matchWatchOrgs(text);
  const buyers = watchOrgs.filter(org => org.isBuyer);
  const vendorIntel = VENDOR_HINT.test([text, article.source, article.sourceId].join(' ')) || watchOrgs.some(org => !org.isBuyer);
  const academic = Boolean(article.academic) || source.kind === 'crossref' || source.kind === 'openalex' || /crossref|openalex/.test(String(article.sourceId||''));
  const research = academic || isResearch(article, text);
  const dimensions = {
    offering: offeringScore(offerings),
    buyer: buyerScore(watchOrgs, vendorIntel),
    action: actionScore(text),
    source: SOURCE_SCORE[tier],
    freshness: freshnessScore(article),
  };
  let total = Math.round(
    dimensions.offering * 0.35 +
    dimensions.buyer * 0.25 +
    dimensions.action * 0.18 +
    dimensions.source * 0.12 +
    dimensions.freshness * 0.10
  );
  if (research && !buyers.length) total = Math.min(total, 48);
  if (vendorIntel && !buyers.length) total = Math.min(total, 64);
  const salesStage = salesStageFor({buyers, watchOrgs, vendorIntel, offerings});
  const frontier = frontierScore(text, {research, vendorIntel});
  const featured = !academic && canAutoFeature({offerings, buyers, vendorIntel, research, total}) && !article.isDemo;
  const priority = reviewPriority({offerings, buyers, vendorIntel, research, total, frontier, action: dimensions.action, featured});
  const reason = salesReason({offerings, watchOrgs, buyers, vendorIntel, research, featured, priority});
  return {
    total,
    dimensions: {...dimensions, frontier},
    sourceTier: tier,
    offerings,
    watchOrgs,
    salesStage,
    vendorIntel,
    research,
    featured,
    frontier,
    priority,
    suggestPriority: priority === 'P0' || priority === 'P1',
    suggestFeatured: featured,
    reason,
    note: '销售价值与前沿相关度为代码计算，用于分流和自动推荐；不能代替核验，也不会写成已核验或实时热度。',
  };
}
