import { scoreArticle } from '../src/lib/scoring.js';
import { applyLane, humanTouched, sanitizeMachineReview, fallbackMachineReview, rulesVerdict, MACHINE_REVIEWER } from '../src/lib/machineReview.js';
import { reviewPrompt, scorePrompt } from './prompts.mjs';
import { createModelCalls } from './modelCalls.mjs';

const VERDICTS = new Set(['重点跟进', '观察', '低价值']);

function articlePayload(article, score) {
  const paragraphs = [
    ...(article.reading?.paragraphs?.zh || []),
    ...(article.reading?.paragraphs?.en || []),
  ].slice(0, 8);
  return {
    title: article.title,
    source: article.source,
    summary: article.summary,
    paragraphs,
    offerings: score.offerings,
    watchOrgs: (score.watchOrgs || []).map(org => ({name: org.name, isBuyer: org.isBuyer})),
    priority: score.priority,
    salesStage: score.salesStage,
  };
}

export function parseModelJson(text) {
  const raw = String(text || '').trim();
  const block = raw.match(/\{[\s\S]*\}/);
  if (!block) return null;
  try { return JSON.parse(block[0]); } catch { return null; }
}

// 第二次独立评分的输出校验：字段缺失或越界时回落规则分档（与主评审同一兜底口径）。
function scoreVerdictOf(raw, score) {
  const fallback = rulesVerdict(score);
  return {
    salesValue: Number.isInteger(raw?.salesValue) && raw.salesValue >= 0 && raw.salesValue <= 100 ? raw.salesValue : fallback.salesValue,
    salesVerdict: VERDICTS.has(raw?.salesVerdict) ? raw.salesVerdict : fallback.salesVerdict,
    verdictReason: typeof raw?.verdictReason === 'string' ? raw.verdictReason.trim().slice(0, 500) : '',
  };
}

export function createMachineReview({db, config, fetchImpl=fetch, now=Date.now, modelSettings=null, modelCalls=null}) {
  // 模型配置动态读取：界面保存的设置优先，环境变量兜底，改配置无需重启。
  const current = () => modelSettings
    ? modelSettings.effective()
    : {url: config.reviewModelUrl, key: config.reviewModelKey, model: config.reviewModel};
  const calls = modelCalls || createModelCalls({db, now});
  const callKey = (id, modelId) => calls.key(['review', id, modelId, reviewPrompt.version]);
  // 站点 Key 的近 24 小时调用上限（0 = 不限制）；超限时机器审核回落规则分档并如实计数。
  const capValue = () => {
    const automation = modelSettings ? modelSettings.automation() : null;
    return Number.isInteger(automation?.dailyModelCallCap) ? automation.dailyModelCallCap : 500;
  };
  // 双次独立评分可由设置页关闭（省一半调用）；默认开。
  const dualEnabled = () => {
    const automation = modelSettings ? modelSettings.automation() : null;
    return !automation || automation.dualScoring !== false;
  };
  let running = false;
  let lastRun = null;
  async function complete(article, score) {
    const {url, key, model} = current();
    if (!url || !key) return fallbackMachineReview(score, article);
    const modelId = model || 'gpt-4o-mini';
    // 每次付费调用过 model_calls 台账：成败、token 用量、耗时、提示词版本都可追溯。
    const result = await calls.track(
      {purpose:'review', scope:'site', model:modelId, promptVersion:reviewPrompt.version, logicalKey:callKey(article.id, modelId), target:article.id},
      async () => {
        const response = await fetchImpl(url, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(45000),
          headers: {'Content-Type':'application/json', Authorization: 'Bearer '+key},
          body: JSON.stringify({
            model: modelId,
            temperature: 0,
            response_format: {type:'json_object'},
            messages: [
              {role:'system', content: reviewPrompt.content},
              {role:'user', content: JSON.stringify(articlePayload(article, score))},
            ],
          }),
        });
        if (!response.ok) {
          const error = new Error('Review model HTTP '+response.status);
          error.httpStatus = response.status;
          throw error;
        }
        // 解析放进台账回调内：200 但不是合法 JSON 也记一次失败，24 小时内不再为同一条付费重试。
        const json = await response.json();
        const parsed = parseModelJson(json.choices?.[0]?.message?.content);
        if (!parsed) throw new Error('模型返回 200 但内容不是合法 JSON');
        return {parsed, usage: json.usage};
      });
    let combined = {...result.parsed};
    // 第二次独立评分（参考 AIHOT 双评降方差）：单独一次只输出销售价值的调用，与主评审互不干扰。
    // 两次分档一致 → 沿用该档，分数取两次均值的整数；不一致 → 保守归「观察」，避免单次波动触发自动归档。
    const scoreKey = calls.key(['review-score', article.id, modelId, scorePrompt.version]);
    if (dualEnabled() && !calls.failedRecently(scoreKey) && !calls.overBudget(capValue())) {
      try {
        const scoreResult = await calls.track(
          {purpose:'review-score', scope:'site', model:modelId, promptVersion:scorePrompt.version, logicalKey:scoreKey, target:article.id},
          async () => {
            const response = await fetchImpl(url, {
              method: 'POST',
              redirect: 'error',
              signal: AbortSignal.timeout(45000),
              headers: {'Content-Type':'application/json', Authorization: 'Bearer '+key},
              body: JSON.stringify({
                model: modelId,
                temperature: 0,
                response_format: {type:'json_object'},
                messages: [
                  {role:'system', content: scorePrompt.content},
                  {role:'user', content: JSON.stringify(articlePayload(article, score))},
                ],
              }),
            });
            if (!response.ok) {
              const error = new Error('Review model HTTP '+response.status);
              error.httpStatus = response.status;
              throw error;
            }
            const json = await response.json();
            const parsed = parseModelJson(json.choices?.[0]?.message?.content);
            if (!parsed) throw new Error('评分返回 200 但内容不是合法 JSON');
            return {parsed, usage: json.usage};
          });
        const second = scoreVerdictOf(scoreResult.parsed, score);
        const main = scoreVerdictOf(result.parsed, score);
        combined = {
          ...combined,
          salesValue: Math.floor((main.salesValue + second.salesValue) / 2),
          salesVerdict: main.salesVerdict === second.salesVerdict ? main.salesVerdict : '观察',
          verdictReason: main.salesVerdict === second.salesVerdict
            ? (second.verdictReason || combined.verdictReason)
            : '两次独立评分分档不一致（' + main.salesVerdict + '／' + second.salesVerdict + '），保守归为观察。' + second.verdictReason,
          scoreCalls: [main.salesValue, second.salesValue],
        };
      } catch { /* 评分调用失败不阻塞主评审结果 */ }
    }
    // 合并结果整体重过净化：分档理由里的编造数字/链接仍会被剥离。
    const review = sanitizeMachineReview({...combined, model: modelId}, score, article);
    review.promptVersion = reviewPrompt.version;
    if (Array.isArray(combined.scoreCalls)) review.scoreCalls = combined.scoreCalls;
    return review;
  }
  function save(id, article) {
    db.prepare('UPDATE articles SET data=?,updated_at=? WHERE id=?').run(JSON.stringify(article), now(), id);
  }
  async function triage(ids = []) {
    const report = {archived:0, extracted:0, skipped:0, failed:0, throttled:0, budgetBlocked:0, autoArchived:0, reopened:0};
    const {url, key} = current();
    const enabled = Boolean(url && key);
    const automation = modelSettings ? modelSettings.automation() : {autoArchiveLow:true};
    // AI 预审分案：低价值线索机器归档（公开仍可见、保持待复核），判定回升自动恢复；人工处理过的条目永不覆盖。
    function applyVerdictLane(previous, article) {
      if (!automation.autoArchiveLow || humanTouched(previous) || article.machineReview?.status !== 'ready') return;
      const verdict = article.machineReview.salesVerdict;
      const machineArchived = previous.editorial?.status === 'archived' && previous.editorial?.reviewer === MACHINE_REVIEWER && String(previous.editorial?.notes || '').includes('低价值');
      const reviewedAt = new Date(now()).toISOString();
      if (verdict === '低价值' && (article.editorial?.status || 'pending') === 'pending') {
        article.editorial = {...(article.editorial || {}), status:'archived', reviewer:MACHINE_REVIEWER, notes:'AI 销售价值预审判定低价值，自动归档；公开站仍可见并保持待复核，人工可随时恢复。', reviewedAt};
        report.autoArchived++;
      } else if (verdict && verdict !== '低价值' && machineArchived) {
        article.editorial = {...article.editorial, status:'pending', reviewer:MACHINE_REVIEWER, notes:'AI 销售价值判定回升，已从自动归档恢复为待复核。', reviewedAt};
        report.reopened++;
      }
    }
    for (const id of ids) {
      const row = db.prepare('SELECT * FROM articles WHERE id=?').get(id);
      if (!row) { report.skipped++; continue; }
      const previous = JSON.parse(row.data);
      if (humanTouched(previous)) { report.skipped++; continue; }
      const article = applyLane(previous);
      const score = article.assistScore || scoreArticle(article);
      if ((score.priority === 'P0' || score.priority === 'P1') && enabled) {
        // 已有模型整理且含销售价值判定则跳过；旧版无判定的记录升级重评一次。
        if (previous.machineReview?.status === 'ready' && previous.machineReview?.model && previous.machineReview.model !== 'rules' && previous.machineReview.salesVerdict !== undefined) {
          report.skipped++;
        } else if (calls.failedRecently(callKey(article.id, current().model || 'gpt-4o-mini'))) {
          // 失败退避：同一逻辑调用 24 小时内已失败过就不再重复付费（重启、全量补跑也不重放）；换模型或改提示词会换逻辑键，自然重新计窗。
          article.machineReview = fallbackMachineReview(score, article);
          report.throttled++;
        } else if (calls.overBudget(capValue())) {
          // 预算熔断：站点 Key 近 24 小时调用已达上限，本条回落规则分档；上限可在 设置 → 大模型接入 调整。
          article.machineReview = fallbackMachineReview(score, article);
          report.budgetBlocked++;
        } else {
          try {
            article.machineReview = await complete(article, score);
            report.extracted++;
          } catch {
            article.machineReview = fallbackMachineReview(score, article);
            report.failed++;
          }
        }
      } else if (score.priority === 'P3') report.archived++;
      else if (score.priority === 'P0' || score.priority === 'P1') {
        article.machineReview = article.machineReview || fallbackMachineReview(score, article);
        report.extracted++;
      } else report.skipped++;
      applyVerdictLane(previous, article);
      save(id, article);
    }
    return report;
  }
  async function backfill() {
    if (running) return {alreadyRunning: true};
    running = true;
    try {
      const ids = db.prepare('SELECT id FROM articles').all().map(row => row.id);
      const report = await triage(ids);
      lastRun = {at: new Date(now()).toISOString(), report};
      return report;
    } finally { running = false; }
  }
  function status() { return {running, lastRun}; }
  return {triage, backfill, status};
}
