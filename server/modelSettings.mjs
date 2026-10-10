import { isAllowedTranslationUrl } from './config.mjs';
import { HttpError } from './auth.mjs';

const META_KEY = 'review-model-config';
const FIELDS = ['url', 'key', 'model'];

// 掩码保留前 6 后 6 位，足够操作者辨认当前生效的是哪一把 Key。
function maskKey(key) {
  return key.length <= 16 ? '•••' : key.slice(0, 6) + '…' + key.slice(-6);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

// 同一套字段校验、连通性探测与模型列表逻辑，按存储作用域实例化：
// - 站点作用域（meta 表）：回落 REVIEW_MODEL_* 环境变量，带 automation 开关，
//   供后台任务（采集后自动翻译、机器审核）与管理员本人使用；
// - 用户作用域（user_model_configs 表）：仅该用户阅读翻译调用，
//   无环境回落、不接受 automation——用户的花销永远只走自己的 Key。
function createScopedSettings({load, persist, env = {}, withAutomation = false, userScope = false, config, now = Date.now}) {
  // 开放注册后，个人接口地址在生产环境只允许公网 HTTPS 域名：
  // 任意注册用户不能把站点当作内网探测器（http 内网 IP / 单标签主机名仅限本地开发与站点作用域）。
  function allowedUrl(value) {
    if (!isAllowedTranslationUrl(value, config.production)) return false;
    if (!userScope || !config.production) return true;
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && u.hostname.includes('.');
    } catch {
      return false;
    }
  }
  function urlRuleError() {
    return userScope && config.production ? '个人接口地址需为公网 HTTPS 域名。' : 'API 地址需为 HTTPS，或本机/内网地址。';
  }
  function stored() {
    const value = load();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  function effective() {
    const s = stored();
    const url = nonEmpty(s.url) || env.url || '';
    const key = nonEmpty(s.key) || env.key || '';
    const model = nonEmpty(s.model) || env.model || '';
    return {url, key, model, enabled: Boolean(url && key)};
  }
  function sourceOf(field, envValue) {
    if (stored()[field] !== undefined) return 'settings';
    return envValue ? 'env' : 'none';
  }
  // AI 预审自动化开关；默认开启低价值自动归档。useModelTranslation 控制无自建翻译服务时是否复用模型翻译（默认开）。
  // dailyModelCallCap 是站点 Key 的近 24 小时调用上限（默认 500，0 表示不限制）：后台自动翻译与
  // 机器审核超限即停并如实提示；用户自己的 Key 只记台账不设上限（花的是用户自己的额度）。
  function automation() {
    const value = stored().automation;
    const flags = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const cap = flags.dailyModelCallCap;
    return {
      autoArchiveLow: flags.autoArchiveLow !== false,
      useModelTranslation: flags.useModelTranslation !== false,
      // 双次独立评分（默认开）：第二次调用只输出销售价值三字段；关闭则回到单次评分省一半调用。
      dualScoring: flags.dualScoring !== false,
      dailyModelCallCap: Number.isInteger(cap) && cap >= 0 && cap <= 100000 ? cap : 500,
    };
  }
  function view() {
    const eff = effective();
    const s = stored();
    const out = {
      enabled: eff.enabled,
      url: eff.url,
      model: eff.model || 'gpt-4o-mini',
      keySet: Boolean(eff.key),
      keyMasked: eff.key ? maskKey(eff.key) : '',
      overrides: {url: s.url !== undefined, key: s.key !== undefined, model: s.model !== undefined},
      source: {
        url: sourceOf('url', env.url),
        key: sourceOf('key', env.key),
        model: sourceOf('model', env.model),
      },
      updatedAt: now(),
    };
    if (withAutomation) out.automation = automation();
    return out;
  }
  function save(patch = {}) {
    const previous = stored();
    const next = {...previous};
    if (Object.prototype.hasOwnProperty.call(patch, 'automation')) {
      if (!withAutomation) throw new HttpError(400, '个人接口不支持自动化设置。');
      const value = patch.automation;
      if (value === null || value === undefined) delete next.automation;
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const merged = {...(next.automation && typeof next.automation === 'object' ? next.automation : {})};
        let changed = false;
        for (const flag of ['autoArchiveLow', 'useModelTranslation', 'dualScoring']) {
          if (typeof value[flag] === 'boolean') { merged[flag] = value[flag]; changed = true; }
        }
        if (value.dailyModelCallCap !== undefined) {
          const cap = value.dailyModelCallCap;
          if (cap === null) { delete merged.dailyModelCallCap; changed = true; }
          else if (!Number.isInteger(cap) || cap < 0 || cap > 100000) throw new HttpError(400, '每日调用上限需为 0–100000 的整数（0 表示不限制）。');
          else { merged.dailyModelCallCap = cap; changed = true; }
        }
        if (!changed) throw new HttpError(400, '自动化设置无效。');
        next.automation = merged;
      } else throw new HttpError(400, '自动化设置无效。');
    }
    for (const field of FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
      const value = patch[field];
      if (value === null || value === '') { delete next[field]; continue; }
      if (typeof value !== 'string') throw new HttpError(400, '大模型配置字段无效。');
      const trimmed = value.trim();
      if (!trimmed) { delete next[field]; continue; }
      if (trimmed.length > (field === 'url' ? 500 : field === 'key' ? 300 : 120)) throw new HttpError(400, '大模型配置内容过长。');
      next[field] = trimmed;
    }
    if (next.url && !allowedUrl(next.url)) throw new HttpError(400, urlRuleError());
    persist(next);
    return {...view(), keyUnchanged: Boolean(next.key && previous.key && next.key === previous.key)};
  }
  // 「查看」按需返回当前生效 Key 的原文（界面设置优先，回落环境变量）。
  // 只在显式请求时离开服务器；日常列表仍只给掩码。
  function reveal() {
    const eff = effective();
    if (!eff.key) throw new HttpError(400, '尚未保存 API Key。');
    return {key: eff.key, source: sourceOf('key', env.key)};
  }
  // 用传入值（缺省回落到已保存/环境变量）探测一次最小补全请求；只用于连通性诊断。
  async function test(input = {}, fetchImpl = fetch) {
    const eff = effective();
    const url = nonEmpty(input.url) || eff.url;
    const key = nonEmpty(input.key) || eff.key;
    const model = nonEmpty(input.model) || eff.model || 'gpt-4o-mini';
    if (!url) throw new HttpError(400, '请先填写 API 地址。');
    if (!allowedUrl(url)) throw new HttpError(400, urlRuleError());
    if (!key) throw new HttpError(400, '请先填写 API Key。');
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + key},
        body: JSON.stringify({model, temperature: 0, max_tokens: 8, messages: [{role: 'user', content: '连接测试，请回复 ok。'}]}),
      });
    } catch (error) {
      throw new HttpError(400, '无法连接模型服务：' + (error.name === 'TimeoutError' ? '超时（15 秒）' : error.message));
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 160);
      throw new HttpError(400, `模型服务返回 HTTP ${response.status}${detail ? '：' + detail : ''}`);
    }
    let result;
    try { result = await response.json(); } catch { throw new HttpError(400, '模型服务返回的不是 JSON，请确认地址为 OpenAI 兼容的 chat/completions 端点。'); }
    if (!result.choices?.length) {
      const message = result.error?.message || result.error || '响应中没有 choices。';
      throw new HttpError(400, '模型服务错误：' + String(message).slice(0, 200));
    }
    return {ok: true, model};
  }
  // 供应商向导用：用传入或已保存的凭证请求 {base}/models，返回可选模型 id 列表。
  // 拉不到就如实报错，前端回落为手填模型名，绝不编造列表。
  async function listModels(input = {}, fetchImpl = fetch) {
    const eff = effective();
    const key = nonEmpty(input.key) || eff.key;
    const rawBase = nonEmpty(input.baseUrl)
      || (eff.url ? eff.url.replace(/\/chat\/completions\/?$/, '') : '');
    if (!rawBase) throw new HttpError(400, '请先选择供应商或填写地址。');
    if (!key) throw new HttpError(400, '请先填写 API Key。');
    const base = rawBase.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
    const modelsUrl = base + '/models';
    if (!allowedUrl(modelsUrl)) throw new HttpError(400, userScope && config.production ? '个人供应商地址需为公网 HTTPS 域名。' : '供应商地址需为 HTTPS，或本机/内网地址。');
    let response;
    try {
      response = await fetchImpl(modelsUrl, {method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: {Authorization: 'Bearer ' + key}});
    } catch (error) {
      throw new HttpError(400, '无法获取模型列表：' + (error.name === 'TimeoutError' ? '超时（15 秒）' : error.message));
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 160);
      throw new HttpError(400, `模型列表接口返回 HTTP ${response.status}${detail ? '：' + detail : ''}`);
    }
    let result;
    try { result = await response.json(); } catch { throw new HttpError(400, '供应商返回的不是 JSON，请改用手动填写模型名。'); }
    const list = Array.isArray(result?.data) ? result.data
      : Array.isArray(result?.models) ? result.models
      : Array.isArray(result) ? result : [];
    const models = [...new Set(list.map(item => typeof item === 'string' ? item : item?.id).filter(id => typeof id === 'string' && id))].sort().slice(0, 300);
    if (!models.length) throw new HttpError(400, '供应商未返回可用模型，请改用手动填写模型名。');
    return {models};
  }
  const api = {effective, view, save, test, listModels, reveal};
  if (withAutomation) api.automation = automation;
  return api;
}

// 大模型接入设置（站点作用域）：meta 表中的界面设置按字段覆盖 REVIEW_MODEL_* 环境变量。
// Key 只写入本机数据库，接口仅回显掩码，永不返回原文。
export function createModelSettings({db, config, now = Date.now}) {
  return createScopedSettings({
    load: () => {
      const row = db.prepare('SELECT value FROM meta WHERE key=?').get(META_KEY);
      if (!row) return {};
      try {
        const parsed = JSON.parse(row.value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    },
    persist: next => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(META_KEY, JSON.stringify(next)),
    env: {url: config.reviewModelUrl, key: config.reviewModelKey, model: config.reviewModel},
    withAutomation: true,
    config, now,
  });
}

// 每用户大模型配置（2026-09-27 产品决策）：翻译消耗请求用户自己的 Key，不吃站长额度。
// 存储按 user_id 隔离；不回落任何环境变量，也不接受 automation——那是站长后台任务的开关。
export function createUserModelSettings({db, config, now = Date.now}) {
  db.exec('CREATE TABLE IF NOT EXISTS user_model_configs (user_id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  const instances = new Map();
  function forUser(userId) {
    if (typeof userId !== 'string' || !userId) throw new HttpError(400, '缺少用户标识。');
    if (instances.has(userId)) return instances.get(userId);
    const instance = createScopedSettings({
      load: () => {
        const row = db.prepare('SELECT value FROM user_model_configs WHERE user_id=?').get(userId);
        if (!row) return {};
        try { return JSON.parse(row.value); } catch { return {}; }
      },
      persist: next => db.prepare('INSERT INTO user_model_configs(user_id,value,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
        .run(userId, JSON.stringify(next), now()),
      env: {},
      withAutomation: false,
      userScope: true,
      config, now,
    });
    instances.set(userId, instance);
    return instance;
  }
  return {forUser};
}
