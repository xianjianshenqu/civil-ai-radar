import {HttpError,hash} from './auth.mjs';
import { parseModelJson } from './machineReview.mjs';
import { translatePrompt } from './prompts.mjs';
import { createModelCalls } from './modelCalls.mjs';
import { bumpPublicVersionOnWrite } from './database.mjs';

const CJK=/[\u3400-\u9fff]/u;
const MAX_BATCH_CHARS=4000;
const REQUEST_TIMEOUT_MS=180000;
const MODEL_TIMEOUT_MS=180000;

function targetOf(reading) {
  return reading?.originalLanguage==='zh'?'en':reading?.originalLanguage==='en'?'zh':null;
}
function cacheKey(id,reading,target) {
  return hash(JSON.stringify([id,reading,target]));
}
export function batches(paragraphs,limit=MAX_BATCH_CHARS) {
  const out=[];
  let cur=[],size=0;
  for(const p of paragraphs){
    const n=String(p).length;
    if(cur.length && size+n>limit){out.push(cur);cur=[];size=0;}
    cur.push(p);size+=n;
  }
  if(cur.length)out.push(cur);
  return out;
}
function isEchoOrMock(sources,translations) {
  return translations.every((p,i)=>{
    const src=String(sources[i]||'').trim();
    const dst=String(p).trim();
    return !dst || dst===src || dst===`【译】${src}` || dst.startsWith('【译】');
  });
}
export function isRealTranslation(sourceLang,targetLang,sources,translations) {
  if(!Array.isArray(translations)||translations.length!==sources.length)return false;
  if(!translations.every(p=>typeof p==='string'&&p.trim()&&p.length<=60000))return false;
  if(isEchoOrMock(sources,translations))return false;
  const joined=translations.join('\n');
  if(joined.trim()===sources.join('\n').trim())return false;
  if(targetLang==='zh')return CJK.test(joined);
  if(targetLang==='en')return /[A-Za-z]{3,}/.test(joined);
  return false;
}

// Only persisted public articles can be translated. No caller-supplied text or URLs.
// 翻译提供商动态解析：自建 LibreTranslate（TRANSLATION_URL）优先；未配置时若设置页已接入
// 大模型且开关开启，则复用该 OpenAI 兼容端点做翻译（2026-09-24 用户确认的方向）。
export function createTranslator({db,config,fetchImpl=fetch,now=Date.now,modelSettings=null,modelCalls=null}) {
  db.exec('CREATE TABLE IF NOT EXISTS translations (cache_key TEXT PRIMARY KEY, reading TEXT NOT NULL, created_at INTEGER NOT NULL)');
  // 翻译缓存变化会改变公开列表里的译文，同样推进公开池版本号。
  bumpPublicVersionOnWrite(db,'translations');
  const calls = modelCalls || createModelCalls({db, now});
  // 站点 Key 的近 24 小时调用上限（0 = 不限制），读自动化设置，改配置无需重启。
  const siteCap = () => {
    const automation = modelSettings && modelSettings.automation ? modelSettings.automation() : null;
    return Number.isInteger(automation?.dailyModelCallCap) ? automation.dailyModelCallCap : 500;
  };
  const pending=new Map();
  // 翻译提供商动态解析：自建 LibreTranslate（TRANSLATION_URL）优先；用户请求优先用该用户
  // 自己保存的接口（只花他自己的额度）；管理员未配个人接口时回落站点全局配置（全局即站长本人）。
  // 后台任务（采集后自动翻译）不带用户上下文，走全局链路并受 automation 开关约束。
  function resolveProvider(options) {
    if(config.translationUrl)return {kind:'libretranslate'};
    if(options&&options.userCall){
      const own=options.userSettings&&options.userSettings.effective();
      if(own&&own.url&&own.key)return {kind:'model',url:own.url,key:own.key,model:own.model,personal:true};
      if(!options.siteFallback)return null;
    }
    if(!modelSettings)return null;
    const automation=modelSettings.automation&&modelSettings.automation();
    if(automation&&automation.useModelTranslation===false)return null;
    const model=modelSettings.effective();
    return model.url&&model.key?{kind:'model',url:model.url,key:model.key,model:model.model}:null;
  }
  function provider() {
    return resolveProvider(null);
  }
  function usableCached(reading,target) {
    const source=reading?.originalLanguage;
    return isRealTranslation(source,target,reading?.paragraphs?.[source]||[],reading?.paragraphs?.[target]||[]);
  }
  function readCache(id,reading,target) {
    const key=cacheKey(id,reading,target);
    const cached=db.prepare('SELECT reading FROM translations WHERE cache_key=?').get(key);
    if(!cached)return null;
    const updated=JSON.parse(cached.reading);
    if(!usableCached(updated,target)){
      db.prepare('DELETE FROM translations WHERE cache_key=?').run(key);
      return null;
    }
    return updated;
  }
  function overlay(article) {
    const reading=article?.reading;
    const target=targetOf(reading);
    if(!reading?.paragraphs?.[reading.originalLanguage]?.length || !target || reading.paragraphs[target]?.length) return article;
    const cached=readCache(article.id,reading,target);
    return cached?{...article,reading:cached}:article;
  }
  async function postTranslate(q,source,target) {
    const response=await fetchImpl(config.translationUrl,{method:'POST',redirect:'error',signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS),headers:{'Content-Type':'application/json'},
      body:JSON.stringify({q,source,target,format:'text',...(config.translationKey?{api_key:config.translationKey}:{})})});
    if(!response.ok){
      const err=new Error('provider failure');
      err.httpStatus=response.status;
      throw err;
    }
    const result=await response.json();
    let translated=result.translatedText;
    const expected=Array.isArray(q)?q.length:1;
    if(typeof translated==='string')translated=[translated];
    if(!Array.isArray(translated)||translated.length!==expected)throw new Error('invalid translation');
    return translated;
  }
  async function postModelTranslate(q,source,target,providerInfo,articleId) {
    const modelId=providerInfo.model||'gpt-4o-mini';
    // 预算熔断只约束站点作用域：用户自己的 Key 花自己的额度，不设上限。
    if(!providerInfo.personal){
      const cap=siteCap();
      if(calls.overBudget(cap))throw new HttpError(503,'站点模型调用已达近 24 小时上限（'+cap+' 次），后台自动翻译暂停。可在 设置 → 大模型接入 调整每日上限，或接入你自己的接口翻译；已有缓存翻译不受影响。');
    }
    // 模型翻译是计费调用：逐批过 model_calls 台账（用户自己的 Key 记 user 作用域）。
    const result=await calls.track(
      {purpose:'translate',scope:providerInfo.personal?'user':'site',model:modelId,promptVersion:translatePrompt.version,
        logicalKey:calls.key(['translate',articleId||null,source,target,modelId,translatePrompt.version,q.join('\n')]),target:articleId||null},
      async()=>{
        // 不发 thinking 字段：glm-5.3 属"始终思考"模型，发 thinking:{type:'disabled'} 或 {type:'low'} 都会 400（错误码 1210）。
        // 默认参数实测长批次约 25s，在 180s 上限内；其他 OpenAI 兼容服务商同样安全。
        const response=await fetchImpl(providerInfo.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(MODEL_TIMEOUT_MS),headers:{'Content-Type':'application/json',Authorization:'Bearer '+providerInfo.key},
          body:JSON.stringify({model:modelId,temperature:0,response_format:{type:'json_object'},messages:[
            {role:'system',content:translatePrompt.content},
            {role:'user',content:JSON.stringify({source,target,paragraphs:q})},
          ]})});
        if(!response.ok){
          const detail=(await response.text().catch(()=>'')).replace(/\s+/g,' ').slice(0, 160);
          const err=new Error('provider failure');
          err.httpStatus=response.status;
          err.providerDetail=detail;
          err.personal=Boolean(providerInfo.personal);
          throw err;
        }
        // 校验放进台账回调内：200 但格式不对也如实记失败，不让台账把坏响应算成成功。
        const json=await response.json();
        const translations=parseModelJson(json.choices?.[0]?.message?.content)?.translations;
        if(!Array.isArray(translations)||translations.length!==q.length||!translations.every(p=>typeof p==='string'))throw new Error('invalid translation');
        return {translations,usage:json.usage};
      });
    return result.translations;
  }
  async function requestParagraphs(paragraphs,source,target,providerInfo,articleId) {
    if(!providerInfo)throw new HttpError(503,'自动翻译服务尚未连接。可切换至原文语言阅读。');
    const call=providerInfo.kind==='model'
      ?batch=>postModelTranslate(batch,source,target,providerInfo,articleId)
      :batch=>postTranslate(batch,source,target);
    const out=[];
    for(const batch of batches(paragraphs)){
      try {
        out.push(...await call(batch));
      }catch(error){
        // 401/403/429 逐段重发不会成功，只会把一次失败放大成 N 次计费，直接如实失败。
        if(batch.length===1 || error.httpStatus===undefined || [401,403,429].includes(error.httpStatus))throw error;
        for(const paragraph of batch) out.push((await call([paragraph]))[0]);
      }
    }
    return out;
  }
  async function translate(id,target,options) {
    if(typeof id!=='string'||!['zh','en'].includes(target))throw new HttpError(400,'请选择中文或英文。');
    const row=db.prepare('SELECT data FROM articles WHERE id=?').get(id);
    if(!row)throw new HttpError(404,'找不到已入库的正文。');
    const article=JSON.parse(row.data);
    const reading=article.editorial?.reading || article.reading;
    if(!reading?.paragraphs?.[reading.originalLanguage]?.length)throw new HttpError(409,'这条记录尚未保存正文，暂时无法翻译。');
    if(reading.paragraphs[target]?.length)return {reading};
    const cached=readCache(id,reading,target);
    if(cached)return {reading:cached};
    const providerInfo=resolveProvider(options);
    if(!providerInfo){
      // 普通用户未接入自己的接口：如实指路，绝不回落站长的全局 Key。
      if(options&&options.userCall&&!options.siteFallback)throw new HttpError(503,'尚未接入你自己的大模型接口：请到 设置 → 大模型接入 保存你的 API Key 后再翻译；可先切换至原文语言阅读。');
      throw new HttpError(503,'自动翻译服务尚未连接。可切换至原文语言阅读。');
    }
    const key=cacheKey(id,reading,target);
    if(pending.has(key))return pending.get(key);
    if(pending.size>=3)throw new HttpError(429,'翻译服务繁忙，请稍后重试。');
  // 翻译失败必须可行动：把提供商状态如实映射给界面，而不是一律“稍后重试”。
  function translateError(error) {
    if (error instanceof HttpError) return error;
    const status = error?.httpStatus;
    const detail = error?.providerDetail ? '：' + error.providerDetail : '';
    console.error('[translate] failed:', status || '', error?.name, error?.message, detail);
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return new HttpError(502, '翻译模型响应超时，原有内容仍可阅读。可稍后重试。');
    if (status === 401 || status === 403) return new HttpError(502, '模型调用被拒绝（HTTP ' + status + '，Key 校验未通过' + detail + '）。' + (error?.personal ? '请到 设置 → 大模型接入 检查你自己的 API Key 是否有效、与接口地址是否配套。' : '请到设置页检查 API Key 是否有效、与接口地址是否配套。'));
    if (status === 404) return new HttpError(502, '模型调用失败（HTTP 404' + detail + '）。' + (error?.personal ? '请到 设置 → 大模型接入 检查你的接口地址是否为完整的 chat/completions 端点。' : '请到设置页检查接口地址是否为完整的 chat/completions 端点。'));
    if (status === 429) return new HttpError(502, '模型调用触发限流或配额不足（HTTP 429）。请稍后重试，或到供应商控制台确认余额。');
    if (status) return new HttpError(502, '模型调用失败（HTTP ' + status + detail + '）。原有内容仍可阅读，可稍后重试。');
    if (String(error?.message) === 'invalid translation') return new HttpError(502, '模型返回内容未通过校验，已放弃本次翻译，原有内容仍可阅读。可重试一次。');
    return new HttpError(502, '翻译暂未完成（' + (error?.message || '未知原因') + '）。原有内容仍可阅读。');
  }
  const work=(async()=>{
      try {
        const source=reading.originalLanguage;
        if(target===source)return {reading};
        const translated=await requestParagraphs(reading.paragraphs[source],source,target,providerInfo,id);
        if(!isRealTranslation(source,target,reading.paragraphs[source],translated))throw new Error('invalid translation');
        const updated={...reading,paragraphs:{...reading.paragraphs,[target]:translated},translationLabel:'机器翻译 · 待校对'};
        db.prepare('INSERT OR REPLACE INTO translations VALUES(?,?,?)').run(key,JSON.stringify(updated),now());
        db.prepare('DELETE FROM translations WHERE cache_key NOT IN (SELECT cache_key FROM translations ORDER BY created_at DESC LIMIT 1000)').run();
        return {reading:updated};
      }catch(error){throw translateError(error);}
    })();
    pending.set(key,work);try{return await work;}finally{pending.delete(key);}
  }
  async function translateMany(ids=[]) {
    const report={translated:0,skipped:0,failed:0};
    if(!provider()) return report;
    for(const id of ids){
      try {
        const row=db.prepare('SELECT data FROM articles WHERE id=?').get(id);
        if(!row){report.skipped++;continue;}
        const article=JSON.parse(row.data);
        if(article.editorial?.reading){report.skipped++;continue;}
        const reading=article.reading;
        const target=targetOf(reading);
        if(!reading?.paragraphs?.[reading.originalLanguage]?.length || !target){report.skipped++;continue;}
        if(reading.paragraphs[target]?.length){report.skipped++;continue;}
        await translate(id,target);
        report.translated++;
      }catch(error){report.failed++;console.error('[translate] backfill failed for',id,':',error?.httpStatus||'',error?.message||error);}
    }
    return report;
  }
  async function idle() {
    while(pending.size) await Promise.race([...pending.values()]).catch(()=>{});
  }
  function pendingArticleIds() {
    return db.prepare('SELECT id, data FROM articles').all().map(row=>{
      const article=JSON.parse(row.data);
      const reading=article.reading;
      const n=reading?.paragraphs?.[reading.originalLanguage]?.length||0;
      return {id:row.id,n};
    }).sort((a,b)=>a.n-b.n).map(row=>row.id);
  }
  function status() {
    const p=provider();
    return {enabled:Boolean(p),via:p?p.kind:null};
  }
  return {translate,translateMany,overlay,idle,pendingArticleIds,status};
}
