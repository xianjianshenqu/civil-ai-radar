import { offeringLabel, PRODUCT_OFFERINGS } from '../data/orgWatchlist.js';
import { scoreArticle } from './scoring.js';
import { extractAmounts, extractDeadline } from './intel.js';

export const MACHINE_REVIEWER = 'machine-review';
const MATURITIES = new Set(['预告','研究','试点','已部署','已发布','待判断']);
const STAGES = new Set(['勘察设计','智慧施工','运行维护','防灾与水利','水利数字孪生','待判断']);
const METRIC = /\d+(\.\d+)?\s*(%|％|亿元|万元|美元|准确率|精度)/;
const SALES_VERDICTS = new Set(['重点跟进','观察','低价值']);
const AMOUNT_LIKE = /^\d[\d,]*(?:\.\d+)?\s*[亿万]?元(?:人民币|美元)?$/;
const DATE_LIKE = /\d{4}\s*[-年]\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日/;

// 机器提取（规则版）：金额与截止时间只从已入库的标题、摘要与段落原文里逐字截取；
// 客户单位需要理解上下文才能判断，规则版留空，交由模型或人工处理。
export function rulesExtraction(article = {}) {
  const text = [article.title, article.summary, ...(article.reading?.paragraphs?.zh || [])].filter(Boolean).join('\n');
  return {
    amounts: extractAmounts(text),
    deadline: extractDeadline(text),
    clientOrgs: [],
    basis: 'rules',
  };
}

// 模型输出的 extracted 必须逐字可在原文找到（忽略空白差异）；任何改写、换算或推测都丢弃并回退规则版。
function sanitizeExtracted(raw, source) {
  if (!raw || typeof raw !== 'object') return null;
  const flat = String(source).replace(/\s+/g, '');
  const verbatim = value => typeof value === 'string' && flat.includes(value.replace(/\s+/g, ''));
  const amounts = [...new Set((Array.isArray(raw.amounts) ? raw.amounts : []).map(a => String(a).trim()))]
    .filter(a => AMOUNT_LIKE.test(a) && verbatim(a)).slice(0, 4);
  const deadline = typeof raw.deadline === 'string' ? raw.deadline.trim().slice(0, 60) : '';
  const clientOrgs = [...new Set((Array.isArray(raw.clientOrgs) ? raw.clientOrgs : []).map(o => String(o).trim()))]
    .filter(o => o.length >= 4 && o.length <= 30 && verbatim(o)).slice(0, 5);
  return {
    amounts,
    deadline: deadline && DATE_LIKE.test(deadline) && verbatim(deadline) ? deadline : '',
    clientOrgs,
    basis: 'model',
  };
}

// 规则版预审：无模型时用代码销售分（0–100）分档，保证预审流程不依赖模型也可运行。
export function rulesVerdict(score) {
  const total = Math.max(0, Math.min(100, Math.round(score?.total ?? 0)));
  return {salesValue: total, salesVerdict: total >= 60 ? '重点跟进' : total >= 35 ? '观察' : '低价值'};
}

export function humanTouched(article) {
  const status = article?.editorial?.status;
  if (status === 'approved' || status === 'rejected') return true;
  const reviewer = article?.editorial?.reviewer || '';
  return Boolean(reviewer) && reviewer !== MACHINE_REVIEWER;
}

function clip(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function sourceText(article) {
  return [
    article.title,
    article.summary,
    ...(article.reading?.paragraphs?.zh || []),
    ...(article.reading?.paragraphs?.en || []),
  ].join('\n');
}

function hasInventedMetric(text, source) {
  if (!METRIC.test(text || '')) return false;
  const hits = String(text).match(/\d+(\.\d+)?/g) || [];
  return hits.some(n => n.length > 1 && !String(source).includes(n));
}

export function fallbackMachineReview(score, article = {}) {
  const offerings = score.offerings || [];
  const summary = clip(article.summary, 2000);
  const implication = score.reason || '机器整理，待复核，不代表正在采购。';
  const verdict = rulesVerdict(score);
  return {
    status: 'ready',
    model: 'rules',
    reviewedAt: new Date().toISOString(),
    summary: summary && !summary.startsWith('由公开订阅源自动发现') && !summary.startsWith('由公开学术元数据自动发现') ? summary : clip(article.title, 300),
    implication,
    offerings,
    maturity: article.maturity && MATURITIES.has(article.maturity) ? article.maturity : '待判断',
    engineeringStage: article.engineeringStage && STAGES.has(article.engineeringStage) ? article.engineeringStage : '待判断',
    salesStage: score.salesStage === '可破冰' ? '了解需求' : (score.salesStage || '待判断'),
    needsHuman: score.priority === 'P0' || (score.watchOrgs || []).some(org => org.isBuyer),
    salesValue: verdict.salesValue,
    salesVerdict: verdict.salesVerdict,
    verdictReason: '规则评分分档（销售价值 ' + verdict.salesValue + '），销售假设，待复核。',
    extracted: rulesExtraction(article),
    note: '机器整理，待复核，不代表正在采购，也不能写成已核验。金额与截止为原文截取，仍需回链核对。',
  };
}

export function sanitizeMachineReview(raw, score, article = {}) {
  const source = sourceText(article);
  const fallback = fallbackMachineReview(score, article);
  if (!raw || typeof raw !== 'object') return fallback;
  const summary = clip(raw.summary, 2000);
  const implication = clip(raw.implication, 2000);
  const offerings = Array.isArray(raw.offerings) ? raw.offerings.filter(id => PRODUCT_OFFERINGS.includes(id)).slice(0, 5) : fallback.offerings;
  let salesStage = typeof raw.salesStage === 'string' ? raw.salesStage : fallback.salesStage;
  if (salesStage === '可破冰') salesStage = score.watchOrgs?.some(org => org.isBuyer) ? '了解需求' : '待判断';
  if (!['待判断','了解需求','仅市场观察'].includes(salesStage)) salesStage = fallback.salesStage;
  const invented = hasInventedMetric(summary, source) || hasInventedMetric(implication, source) || /https?:\/\//i.test(summary + implication);
  let verdictReason = clip(raw.verdictReason, 500);
  if (verdictReason && (hasInventedMetric(verdictReason, source) || /https?:\/\//i.test(verdictReason))) verdictReason = fallback.verdictReason;
  const salesValue = Number.isInteger(raw.salesValue) && raw.salesValue >= 0 && raw.salesValue <= 100 ? raw.salesValue : fallback.salesValue;
  const salesVerdict = SALES_VERDICTS.has(raw.salesVerdict) ? raw.salesVerdict : fallback.salesVerdict;
  const extracted = sanitizeExtracted(raw.extracted, source) || fallback.extracted;
  return {
    status: 'ready',
    model: typeof raw.model === 'string' ? raw.model.slice(0, 80) : 'model',
    reviewedAt: new Date().toISOString(),
    summary: invented || !summary ? fallback.summary : summary,
    implication: invented || !implication ? fallback.implication : implication.replace(/可破冰/g, '待人工判断是否可拜访'),
    offerings: offerings.length ? offerings : fallback.offerings,
    maturity: MATURITIES.has(raw.maturity) ? raw.maturity : fallback.maturity,
    engineeringStage: STAGES.has(raw.engineeringStage) ? raw.engineeringStage : fallback.engineeringStage,
    salesStage,
    needsHuman: Boolean(raw.needsHuman) || fallback.needsHuman,
    salesValue,
    salesVerdict,
    verdictReason: verdictReason || fallback.verdictReason,
    extracted,
    note: fallback.note,
  };
}

export function lanePatch(score, article = {}) {
  const patch = {assistScore: score};
  if (humanTouched(article)) return patch;
  const reviewedAt = new Date().toISOString();
  if (score.priority === 'P3') {
    patch.editorial = {
      ...(article.editorial || {}),
      status: 'archived',
      reviewer: MACHINE_REVIEWER,
      notes: 'P3 自动归档：低销售且低前沿。公开站仍可见，不代表已核验。',
      reviewedAt,
    };
  } else if (article.editorial?.status === 'archived' && article.editorial?.reviewer === MACHINE_REVIEWER) {
    patch.editorial = {
      ...article.editorial,
      status: 'pending',
      reviewer: MACHINE_REVIEWER,
      notes: '优先级上升，已从自动归档回到待复核。',
      reviewedAt,
    };
  }
  if (score.priority === 'P0' || score.priority === 'P1') {
    patch.machineReview = article.machineReview?.status === 'ready' && article.machineReview?.model !== 'rules'
      ? article.machineReview
      : fallbackMachineReview(score, article);
  } else {
    patch.machineReview = undefined;
  }
  return patch;
}

export function applyLane(article, source = {}) {
  const score = scoreArticle(article, source);
  const patch = lanePatch(score, article);
  const next = {...article, ...patch, assistScore: score};
  if (patch.machineReview === undefined) delete next.machineReview;
  return next;
}

export function machineCopy(article) {
  const review = article?.machineReview;
  if (!review?.implication && !review?.summary) return null;
  const offerings = (review.offerings || []).map(offeringLabel).filter(Boolean);
  return {
    summary: review.summary || '',
    implication: review.implication || '',
    offerings,
    needsHuman: Boolean(review.needsHuman),
  };
}
