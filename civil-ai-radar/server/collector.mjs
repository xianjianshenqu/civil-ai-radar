import { XMLParser } from 'fast-xml-parser';
import robotsParser from 'robots-parser';
import { randomUUID } from 'node:crypto';
import { hash, HttpError } from './auth.mjs';
import { collectAcademic } from './academic.mjs';
import { collectProcurement, CCGP_SEARCH_TIMEOUT_MS } from './procurement.mjs';
import { collectGgzy, GGZY_SEARCH_TIMEOUT_MS } from './ggzy.mjs';
import { collectSzggzy, SZGGZY_SEARCH_TIMEOUT_MS } from './szggzy.mjs';
import { collectGzggzy, GZGGZY_SEARCH_TIMEOUT_MS } from './gzggzy.mjs';
import { AI, ENGINEERING, normalizeTier } from '../src/lib/scoring.js';
import { applyLane } from '../src/lib/machineReview.js';
import { timelineFields } from '../src/lib/timeline.js';
const UA='CivilAIRadar/1.0';
const DEFAULT_FETCH_TIMEOUT_MS=20000;
// robots.txt 在广州等源上常被网关 502/503/504 或超时打掉，列表页本身仍可抓。
// 只对瞬时失败等待后重试一次；明确 Disallow 与其它 HTTP 状态仍按原逻辑失败。404 视为无限制。
export const ROBOTS_RETRY_WAIT_MS=400;
const TRANSIENT_ROBOTS_HTTP=new Set([502,503,504]);
const TRANSIENT_NETWORK_CODES=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','EPIPE','ECONNABORTED','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET']);
export function isTransientRobotsFailure(error) {
  const seen=new Set();
  let current=error;
  for(let depth=0;current&&depth<4;depth++){
    if(typeof current!=='object'||seen.has(current))break;
    seen.add(current);
    if(current.name==='AbortError'||current.name==='TimeoutError')return true;
    if(typeof current.code==='string'&&TRANSIENT_NETWORK_CODES.has(current.code))return true;
    current=current.cause;
  }
  return false;
}
// 调用方传入的 signal 优先，避免政采网检索被这里的短超时覆盖。
export function collectorFetchSignal(options={},defaultMs=DEFAULT_FETCH_TIMEOUT_MS) {
  if(options.signal)return options.signal;
  const timeoutMs=Number.isFinite(options.timeoutMs)?options.timeoutMs:defaultMs;
  return AbortSignal.timeout(timeoutMs);
}
const array=x=>x===undefined?[]:Array.isArray(x)?x:[x];
const decodeText=value=>value.replace(/&#(x[0-9a-f]+|[0-9]+);|&(amp|quot|apos|lt|gt|nbsp);/gi,(match,number,named)=>{if(named)return {amp:'&',quot:'\"',apos:"'",lt:'<',gt:'>',nbsp:' '}[named.toLowerCase()];const n=number[0].toLowerCase()==='x'?parseInt(number.slice(1),16):Number(number);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';});
const text=x=>typeof x==='string'?x:typeof x?.['#text']==='string'?x['#text']:'';
function allowedHost(host, source) {
  const origin=new URL(source.url).hostname;
  return host===origin || (source.articleHosts||[]).includes(host);
}
export function feedParagraphs(value) {
  // Store plain text only; never execute or render feed HTML, images or embeds.
  return decodeText(value.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'')
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>|<br\s*\/?\s*>/gi,'\n\n').replace(/<[^>]*>/g,''))
    .replace(/\r/g,'').slice(0,30000).split(/\n\s*\n/).map(p=>p.replace(/[ \t]+/g,' ').trim()).filter(Boolean);
}
export function canonicalUrl(value,base,extraHosts=[]) {
  try{
    const u=new URL(value,base);
    if(u.username||u.password)return null;
    const originHost=new URL(base).hostname;
    if(u.hostname!==originHost && !extraHosts.includes(u.hostname))return null;
    if(u.protocol==='http:')u.protocol='https:';
    if(u.protocol!=='https:')return null;
    u.hash='';for(const key of [...u.searchParams.keys()])if(/^utm_|^fbclid$|^gclid$/i.test(key))u.searchParams.delete(key);
    u.searchParams.sort();return u.href;
  }catch{return null;}
}
function enrich(article,source) {
  return applyLane({...article,...timelineFields(article),sourceTier:normalizeTier(source.tier||article.sourceTier)},source);
}
export function parseFeed(xml,source,now=Date.now()) {
  if(Buffer.byteLength(xml)>2000000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Feed rejected: unsafe or oversized XML');
  const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:false}).parse(xml);
  const records=parsed.rss?.channel?.item || parsed.feed?.entry || parsed['rdf:RDF']?.item;
  if(!parsed.rss&&!parsed.feed&&!parsed['rdf:RDF'])throw new Error('Source is not RSS or Atom');
  const result=new Map();
  for(const record of array(records).slice(0,150)) {
    const title=decodeText(text(record.title)).replace(/<[^>]*>/g,'').trim().slice(0,300);
    const haystack=title+' '+text(record.description)+' '+text(record.summary)+' '+text(record['content:encoded']);
    if(!AI.test(haystack)||!ENGINEERING.test(haystack))continue;
    const link=typeof record.link==='string'?record.link:array(record.link).find(l=>!l['@_rel']||l['@_rel']==='alternate')?.['@_href']||text(record['@_rdf:about']);
    if(typeof link!=='string'||!link.trim())continue;
    const url=canonicalUrl(link,source.url,source.articleHosts||[]);
    if(!url||!allowedHost(new URL(url).hostname,source)||!title)continue;
    const published=text(record.pubDate)||text(record.published)||text(record['dc:date']); // Atom updated is not publication evidence.
    const stamp=Date.parse(published),known=Number.isFinite(stamp);
    const day=known?new Date(stamp).toISOString().slice(0,10):'未披露';
    const content=text(record['content:encoded'])||text(record.content);
    const raw=content||text(record.description)||text(record.summary);
    const paragraphs=feedParagraphs(raw);
    const language=/[\u3400-\u9fff]/u.test(paragraphs.join('')||title)?'zh':'en';
    const reading=paragraphs.length?{kind:content?'feed-content':'feed-summary',originalLanguage:language,paragraphs:{[language]:paragraphs},
      notice:'订阅源内容未经编辑复核；网页全文及配图请查看来源。'+(raw.length>30000?'内容过长，仅保留前段。':'')}:undefined;
    result.set(url,enrich({id:'feed-'+hash(url).slice(0,24),sourceUrl:url,title,source:source.name,sourceId:source.id,
      reading,
      summary:'由公开订阅源自动发现的工程 AI 线索。请查阅原文确认具体内容，尚未经编辑复核。',
      quote:'订阅源标题与发布时间；不代表已核验工程事实。',implication:'待编辑结合原文补充工程启示。',
      sector:source.sector,scope:source.scope,region:source.region,topicIds:source.topicIds || [],
      time:'未披露',eventDate:'未披露',eventSort:0,publishedDate:day,publishSort:known?Number(day.replaceAll('-',''))*10000:0,
      publishedAt:known?new Date(stamp).toISOString():null,ai:'AI 相关线索',maturity:'待判断',layer:'自动采集',engineeringStage:'待判断',evidence:'待复核',dataOrigin:'collector',firstSeenAt:new Date(now).toISOString()},source));
  }
  return [...result.values()];
}
async function boundedText(response,max=2000000) {
  if(Number(response.headers.get('content-length'))>max)throw new Error('Response too large');
  let size=0;const chunks=[];
  for await(const chunk of response.body){size+=chunk.length;if(size>max)throw new Error('Response too large');chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8');
}
// 采集节奏（2026-09-29，参考 AIHOT per-source 调度）：每个源有自己的 next_attempt——
// 成功排到 interval 之后；失败按 60/120/240/360 分钟阶梯退避（封顶不超过常规周期），
// 连续失败不再占用整轮等待。调度器每 30 秒 tick，只跑到期源；手动「立即采集」仍全量跑。
const BACKOFF_LADDER_MINUTES=[60,120,240,360];
function backoffMs(failCount,interval){
  const minutes=BACKOFF_LADDER_MINUTES[Math.min(Math.max(failCount,1),BACKOFF_LADDER_MINUTES.length)-1];
  return Math.min(interval,minutes*60000);
}
export function createCollector({db,sources,fetchImpl=fetch,now=Date.now,mailto='',onChange=async()=>{},afterCollect=async()=>{},intervalMs=86400000,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  let running=false,followUp=Promise.resolve();
  for(const s of sources){db.prepare('INSERT OR IGNORE INTO sources(id) VALUES(?)').run(s.id);if(s.disabledReason)db.prepare('UPDATE sources SET enabled=0 WHERE id=?').run(s.id);}
  const robotsCache=new Map();
  const intervalFor=state=>Number.isFinite(state?.interval_minutes)&&state.interval_minutes>0?state.interval_minutes*60000:intervalMs;
  async function safeFetch(url,options={}) {
    const {signal,timeoutMs,headers,...rest}=options;
    const response=await fetchImpl(url,{...rest,headers:{'User-Agent':UA,...headers},redirect:'manual',signal:collectorFetchSignal({signal,timeoutMs})});
    if(response.status>=300&&response.status<400&&response.status!==304)throw new Error('Source redirect requires operator review');
    return response;
  }
  async function fetchRobots(robotsUrl,fetchOptions) {
    try {
      const response=await safeFetch(robotsUrl,fetchOptions);
      if(response.ok||response.status===404||!TRANSIENT_ROBOTS_HTTP.has(response.status))return response;
    }catch(error){
      if(!isTransientRobotsFailure(error))throw error;
      await sleep(ROBOTS_RETRY_WAIT_MS);
      return safeFetch(robotsUrl,fetchOptions);
    }
    await sleep(ROBOTS_RETRY_WAIT_MS);
    return safeFetch(robotsUrl,fetchOptions);
  }
  async function allowed(url,fetchOptions={}) {
    const origin=new URL(url).origin;let cached=robotsCache.get(origin);
    if(!cached || now()-cached.at>3600000){
      const robotsUrl=origin+'/robots.txt',response=await fetchRobots(robotsUrl,fetchOptions);
      if(!response.ok&&response.status!==404)throw new Error(`Cannot check robots.txt: HTTP ${response.status}`);
      cached={at:now(),rules:robotsParser(robotsUrl,response.status===404?'':await boundedText(response,512000)),lastFetch:0};robotsCache.set(origin,cached);
    }
    if(cached.rules.isAllowed(url,UA)===false)throw new Error('Source disallows automated collection in robots.txt');
    const delay=Math.max(0,(cached.rules.getCrawlDelay(UA)||0)*1000-(now()-cached.lastFetch));
    if(delay>30000)throw new Error('Source crawl delay exceeds this run budget; deferred');
    if(delay)await new Promise(r=>setTimeout(r,delay));
    cached.lastFetch=now();
  }
  async function run(options={}){
    if(running)throw new HttpError(409,'采集正在运行，请稍后查看结果。');
    // 调度器按 next_attempt 只跑到期源；手动触发不传 only，全量跑。
    const only=Array.isArray(options.only)?new Set(options.only):null;
    running=true;const id=randomUUID();db.prepare('INSERT INTO runs(id,started_at) VALUES(?,?)').run(id,now());const results=[];const changedIds=[];
    try {
      for(const source of sources){
        if(only&&!only.has(source.id))continue;
        const state=db.prepare('SELECT * FROM sources WHERE id=?').get(source.id);if(!state.enabled||source.disabledReason)continue;
        const firstImport=!state.last_success;
        db.prepare('UPDATE sources SET last_attempt=? WHERE id=?').run(now(),source.id);
        try {
          const kind=source.kind||'rss';
          const searchTimeouts={ccgp:CCGP_SEARCH_TIMEOUT_MS,ggzy:GGZY_SEARCH_TIMEOUT_MS,szggzy:SZGGZY_SEARCH_TIMEOUT_MS,gzggzy:GZGGZY_SEARCH_TIMEOUT_MS};
          await allowed(source.url,searchTimeouts[kind]?{timeoutMs:searchTimeouts[kind]}:{});
          let articles, etag=null, lastModified=null, warnings=[];
          if(kind==='crossref'||kind==='openalex'){
            articles=await collectAcademic(source,{safeFetch,boundedText,now,mailto});
          }else if(kind==='ccgp'){
            articles=await collectProcurement(source,{safeFetch,boundedText,now});
            warnings=articles.warnings||[];
            if(warnings.length)console.warn(`[ccgp] ${source.id} 部分关键词未取回：${warnings.join('; ')}`);
          }else if(kind==='ggzy'){
            articles=await collectGgzy(source,{safeFetch,boundedText,now});
            warnings=articles.warnings||[];
            if(warnings.length)console.warn(`[ggzy] ${source.id} 部分关键词未取回：${warnings.join('; ')}`);
          }else if(kind==='szggzy'){
            articles=await collectSzggzy(source,{safeFetch,boundedText,now});
            warnings=articles.warnings||[];
            if(warnings.length)console.warn(`[szggzy] ${source.id} 部分关键词未取回：${warnings.join('; ')}`);
          }else if(kind==='gzggzy'){
            articles=await collectGzggzy(source,{safeFetch,boundedText,now});
            warnings=articles.warnings||[];
            if(warnings.length)console.warn(`[gzggzy] ${source.id} 部分栏目关键词未取回：${warnings.join('; ')}`);
          }else{
            const headers={};if(state.etag)headers['If-None-Match']=state.etag;if(state.last_modified)headers['If-Modified-Since']=state.last_modified;
            const response=await safeFetch(source.url,{headers});
            if(response.status===304){db.prepare('UPDATE sources SET last_success=?,error=NULL,fail_count=0,next_attempt=? WHERE id=?').run(now(),now()+intervalFor(state),source.id);results.push({source:source.id,status:'unchanged',added:0});continue;}
            if(!response.ok)throw new Error(`Source HTTP ${response.status}`);
            articles=parseFeed(await boundedText(response),source,now());
            etag=response.headers.get('etag');lastModified=response.headers.get('last-modified');
          }
          // 新源首采回灌上限（参考 AIHOT first-import 限制）：一次最多入库 30 条，防止新订阅源
          // 一次灌入海量历史条目刷屏；已成功的源不受限。72 小时时间线规则另行管分组。
          const firstCapped=firstImport&&Array.isArray(articles)&&articles.length>30;
          if(firstCapped)articles=articles.slice(0,30);
          let added=0,updated=0;
          for(const article of articles){
            const contentHash=hash(JSON.stringify([article.title,article.publishedDate,article.sourceUrl,article.reading]));
            const previous=db.prepare('SELECT * FROM articles WHERE url=?').get(article.sourceUrl);
            if(!previous){db.prepare('INSERT INTO articles VALUES(?,?,?,?,?,?)').run(article.id,article.sourceUrl,JSON.stringify(article),contentHash,now(),now());added++;changedIds.push(article.id);}
            else if(previous.content_hash!==contentHash){
              const prior=JSON.parse(previous.data);
              article.id=previous.id;article.firstSeenAt=new Date(previous.first_seen).toISOString();
              if(prior.editorial)article.editorial=prior.editorial;
              if(prior.machineReview)article.machineReview=prior.machineReview;
              const stored=enrich(article,source);
              db.prepare('UPDATE articles SET data=?,content_hash=?,updated_at=? WHERE id=?').run(JSON.stringify(stored),contentHash,now(),previous.id);updated++;changedIds.push(previous.id);
            }
          }
          db.prepare('UPDATE sources SET etag=?,last_modified=?,last_success=?,error=NULL,fail_count=0,next_attempt=? WHERE id=?').run(etag,lastModified,now(),now()+intervalFor(state),source.id);
          results.push({source:source.id,status:'ok',added,updated,matched:articles.length,...(warnings.length?{warnings}:{}),...(firstCapped?{firstImportCapped:true}:{})});
        }catch(error){
          // 失败退避：fail_count 递增，按阶梯提前重试；成功即清零回到常规周期。
          const fail=(state.fail_count||0)+1;
          db.prepare('UPDATE sources SET error=?,fail_count=?,next_attempt=? WHERE id=?').run(error.message,fail,now()+backoffMs(fail,intervalFor(state)),source.id);
          results.push({source:source.id,status:'error',error:error.message});
        }
      }
      db.prepare('UPDATE runs SET finished_at=?,results=? WHERE id=?').run(now(),JSON.stringify(results),id);
      followUp=followUp.then(()=>afterCollect(changedIds),()=>afterCollect(changedIds));
      await onChange();return {id,results};
    }finally{running=false;}
  }
  return {run,get running(){return running;},ready:()=>followUp,status:()=>({running,sources:sources.map(s=>{
    const row=db.prepare('SELECT enabled,last_attempt,last_success,error,fail_count,next_attempt,interval_minutes FROM sources WHERE id=?').get(s.id);
    return {...s,...row};
  }),runs:db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT 10').all().map(r=>({...r,results:r.results?JSON.parse(r.results):null}))})};
}
