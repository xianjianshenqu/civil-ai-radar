// Agent 中心流水线状态卡的纯展示模型。只整理已有接口字段，不补造次数或时间。
const LANE_ORDER = [
  {id: 'collection', title: '自动采集'},
  {id: 'review', title: '机器审核'},
  {id: 'translation', title: '自动翻译'},
];

export function formatPipelineTime(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false});
}

function intervalLabel(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 60 && n % 60 === 0) return `${n / 60} 小时`;
  return `${n} 分钟`;
}

function flag(value) {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && typeof value.enabled === 'boolean') return value.enabled;
  return null;
}

function lane(id, title, state, label, summary) {
  return {id, title, state, label, summary};
}

function unknownLane(id, title) {
  return lane(id, title, 'unknown', '未读到', '暂时读不到，可稍后刷新。');
}

function collectionPublic(health) {
  const enabled = flag(health?.collectionEnabled);
  if (enabled === null) return unknownLane('collection', '自动采集');
  if (!enabled) return lane('collection', '自动采集', 'off', '已关闭', '定时采集已关闭。');
  const every = intervalLabel(health.intervalMinutes);
  return lane('collection', '自动采集', 'on', '已开启', every ? `定时采集已开启，常规周期 ${every}。` : '定时采集已开启。');
}

function reviewPublic(health) {
  const enabled = flag(health?.reviewModel);
  if (enabled === null) return unknownLane('review', '机器审核');
  if (!enabled) return lane('review', '机器审核', 'off', '规则模式', '大模型未启用，机器审核为规则模式。');
  return lane('review', '机器审核', 'on', '已启用', '大模型机器审核已启用。');
}

function translationPublic(health) {
  const enabled = flag(health?.translation);
  if (enabled === null) return unknownLane('translation', '自动翻译');
  if (!enabled) return lane('translation', '自动翻译', 'off', '未连接', '自动翻译未连接。新采集仅保留原文。');
  return lane('translation', '自动翻译', 'on', '已连接', '自动翻译已连接。');
}

function countOf(results, key) {
  return results.reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0);
}

export function summarizeLatestRun(runs) {
  const run = Array.isArray(runs) ? runs.find(Boolean) : null;
  if (!run) return '尚无采集记录。';
  const when = formatPipelineTime(run.started_at);
  const prefix = when ? `${when} ` : '';
  if (!run.finished_at) return `${prefix}最近一次采集仍在进行。`;
  const results = Array.isArray(run.results) ? run.results : null;
  if (!results) return `${prefix}最近一次采集没有返回来源结果。`;
  if (!results.length) return `${prefix}最近一次采集没有启用的来源。`;
  const failed = results.filter(row => row?.status === 'error');
  const added = countOf(results, 'added');
  const updated = countOf(results, 'updated');
  if (failed.length) {
    const names = failed.map(row => row.source).filter(Boolean).slice(0, 3).join('、');
    return `${prefix}最近一次有 ${failed.length} 个来源失败${names ? `（${names}）` : ''}；新增 ${added}，更新 ${updated}。`;
  }
  return `${prefix}最近一次采集成功：新增 ${added}，更新 ${updated}。`;
}

function collectionDetail(status) {
  const enabled = flag(status?.enabled);
  if (enabled === null) return null;
  const every = intervalLabel(status.intervalMinutes);
  const when = formatPipelineTime(status.nextRunAt);
  let summary;
  if (status.running) summary = '当前正在采集。';
  else if (!enabled) summary = '定时采集已关闭。';
  else summary = `定时采集已开启${every ? `，常规周期 ${every}` : ''}。下次计划：${when || '时间未返回'}。`;
  summary += summarizeLatestRun(status.runs);
  const state = status.running ? 'busy' : enabled ? 'on' : 'off';
  const label = status.running ? '采集中' : enabled ? '已开启' : '已关闭';
  return lane('collection', '自动采集', state, label, summary);
}

function backfillCounts(report) {
  if (!report || typeof report !== 'object') return '';
  const bits = [
    `归档 ${report.archived ?? 0}`,
    `机器整理 ${report.extracted ?? 0}`,
    `失败 ${report.failed ?? 0}`,
    `跳过 ${report.skipped ?? 0}`,
  ];
  if (report.autoArchived) bits.push(`AI 归档低价值 ${report.autoArchived}`);
  if (report.reopened) bits.push(`恢复 ${report.reopened}`);
  if (report.throttled) bits.push(`失败退避 ${report.throttled}`);
  if (report.budgetBlocked) bits.push(`超预算回落规则 ${report.budgetBlocked}`);
  return bits.join('，');
}

function reviewDetail(status, modelConfig) {
  const fromStatus = status?.modelReview && typeof status.modelReview === 'object' ? status.modelReview : null;
  const fromConfig = modelConfig && typeof modelConfig === 'object' ? {
    enabled: modelConfig.enabled,
    model: modelConfig.model,
    running: modelConfig.review?.running,
    lastRun: modelConfig.review?.lastRun,
  } : null;
  if (!fromStatus && !fromConfig) return null;
  const enabled = flag(fromConfig?.enabled) ?? flag(fromStatus?.enabled);
  if (enabled === null) return null;
  const running = Boolean(fromConfig?.running ?? fromStatus?.running);
  const lastRun = fromConfig?.lastRun || fromStatus?.lastRun || null;
  if (!enabled) return lane('review', '机器审核', running ? 'busy' : 'off', running ? '补跑中' : '规则模式', running ? '正在补跑机器审核。大模型未启用，完成后仍是规则模式。' : '大模型未启用，机器审核为规则模式。');
  const model = (fromConfig?.enabled ? fromConfig.model : '') || (fromStatus?.enabled ? fromStatus.model : '');
  const parts = [`大模型机器审核已启用${model ? `（模型 ${model}）` : ''}。`];
  if (running) parts.push('正在补跑机器审核。');
  if (lastRun?.report) {
    const when = formatPipelineTime(lastRun.at);
    parts.push(`${when ? `${when} ` : ''}上次补跑：${backfillCounts(lastRun.report)}。`);
  } else if (!running) parts.push('尚无补跑记录。');
  return lane('review', '机器审核', running ? 'busy' : 'on', running ? '补跑中' : '已启用', parts.join(''));
}

function translationDetail(status, modelConfig) {
  const raw = status?.translation;
  const enabled = flag(raw);
  const via = raw && typeof raw === 'object' ? raw.via : null;
  const switchedOff = modelConfig?.automation?.useModelTranslation === false;
  if (enabled === true && via === 'libretranslate') {
    return lane('translation', '自动翻译', 'on', '已连接', '已连接自建翻译服务。新采集会自动生成中英对照（机器翻译，待校对）。');
  }
  if (enabled === true && via === 'model') {
    return lane('translation', '自动翻译', 'on', '已连接', '已连接站点大模型。新采集会自动翻译（机器翻译，待校对）。');
  }
  if (enabled === true) return lane('translation', '自动翻译', 'on', '已连接', '自动翻译已连接。');
  if (enabled === false && switchedOff) return lane('translation', '自动翻译', 'off', '未连接', '自动翻译开关已关闭。新采集仅保留原文。');
  if (enabled === false) return lane('translation', '自动翻译', 'off', '未连接', '自动翻译未连接。新采集仅保留原文。');
  if (switchedOff) return lane('translation', '自动翻译', 'off', '未连接', '自动翻译开关已关闭。新采集仅保留原文。');
  return null;
}

function normalizeRole(role) {
  return role === 'admin' || role === 'member' ? role : 'guest';
}

export function buildAgentPipeline({role: roleInput = 'guest', health = null, collectorStatus = null, modelConfig = null, healthError = '', detailErrors = []} = {}) {
  const role = normalizeRole(roleInput);
  const admin = role === 'admin';
  const status = admin ? collectorStatus : null;
  const model = admin ? modelConfig : null;
  const lanes = LANE_ORDER.map(item => {
    if (item.id === 'collection') return (admin && collectionDetail(status)) || (health ? collectionPublic(health) : unknownLane(item.id, item.title));
    if (item.id === 'review') return (admin && reviewDetail(status, model)) || (health ? reviewPublic(health) : unknownLane(item.id, item.title));
    return (admin && translationDetail(status, model)) || (health ? translationPublic(health) : unknownLane(item.id, item.title));
  });
  const banners = [];
  if (healthError) banners.push({tone: 'error', text: health || status || model ? `健康检查暂时失败：${healthError}` : healthError});
  if (admin && Array.isArray(detailErrors)) {
    for (const text of detailErrors) if (text) banners.push({tone: 'error', text});
  }
  if (!admin) {
    banners.push({tone: 'info', text: role === 'guest'
      ? '当前为公开健康检查。登录管理员账号可查看下次计划、最近采集成败和补跑计数。'
      : '当前账号无管理员权限。以上为公开健康检查；下次计划、最近成败和补跑计数仅管理员可见。'});
  }
  if (!health && !status && !model && !healthError && !(admin && detailErrors.length)) {
    banners.push({tone: 'info', text: '正在读取流水线状态…'});
  }
  return {role, lanes, banners, showLogin: role === 'guest'};
}
