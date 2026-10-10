import { collectionSchedule } from './scheduler.mjs';
import { createTranslator } from './translation.mjs';
import { createAuth, HttpError } from './auth.mjs';
import { createMailer } from './mail.mjs';
import { createCollector } from './collector.mjs';
import { createNotifications } from './notifications.mjs';
import { applyEditorial, createReview } from './review.mjs';
import { createMachineReview } from './machineReview.mjs';
import { createModelSettings, createUserModelSettings } from './modelSettings.mjs';
import { createModelCalls } from './modelCalls.mjs';
import { loadPublicArticles, memoByPublicVersion } from './feeds.mjs';
import { createWatchlist } from './watchlist.mjs';
import { createIntel } from './intel.mjs';
import { WATCH_LAYERS } from '../src/data/orgWatchlist.js';
import { scoreArticle } from '../src/lib/scoring.js';
import { collapseProcurementDuplicates } from '../src/lib/procurementIdentity.js';
import { parseBackup } from '../src/lib/backup.js';
import { clientIp } from './config.mjs';
const json=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));};
function withSalesScore(article) {
  const assistScore = scoreArticle(article);
  return {...article, assistScore, salesScore: assistScore};
}
async function body(req){let text='';for await(const part of req){text+=part;if(Buffer.byteLength(text)>512000)throw new HttpError(413,'数据过大，请减少资料数量。');}try{return JSON.parse(text||'{}');}catch{throw new HttpError(400,'请求格式不正确。');}}
export function createApp({db,config,sources,fetchImpl=fetch,smtpSend,now=Date.now}) {
  const mailer=createMailer({db,config,fetchImpl,smtpSend,now});
  const auth=createAuth({db,config,mailer,now});
  const notifications=createNotifications({db,config,mailer,now});
  const modelSettings=createModelSettings({db,config,now});
  const userModels=createUserModelSettings({db,config,now});
  const modelCalls=createModelCalls({db,now});
  const translator=createTranslator({db,config,fetchImpl,now,modelSettings,modelCalls});
  const machineReview=createMachineReview({db,config,fetchImpl,now,modelSettings,modelCalls});
  const watchlist=createWatchlist({db,now});
  const intel=createIntel({db,watchlist,now});
  const collector=createCollector({db,sources,fetchImpl,now,mailto:config.academicMailto||'',intervalMs:config.intervalMs,afterCollect:async ids=>{await translator.translateMany(ids);await machineReview.triage(ids);},onChange:async()=>{await notifications.queueDigests();await mailer.flush();}});
  const review=createReview({db,now,watchlist});
  // 公开列表：只在文章、翻译缓存或观察名单变化时重算，浏览器 30 秒轮询直接复用上次结果。
  const publicArticles=memoByPublicVersion(db,()=>{
    // 公开可见性规则（过滤已驳回）统一在 feeds.mjs 的 loadPublicArticles，RSS/sitemap 同源。
    const list=loadPublicArticles(db);
    // 跨来源的同一采购公告在公开列表合并为一条；库内原记录保留。
    const articles=collapseProcurementDuplicates(list.map(entry=>entry.article).map(applyEditorial).map(withSalesScore)).map(translator.overlay);
    return {articles,updatedAt:list[0]?new Date(list[0].updatedAt).toISOString():null};
  });
  let maintenanceRunning=false;
  async function maintenance(){if(maintenanceRunning)return;maintenanceRunning=true;try{
    db.prepare('DELETE FROM challenges WHERE expires<?').run(now()-86400000);
    db.prepare('DELETE FROM sessions WHERE expires<?').run(now());
    db.prepare('DELETE FROM limits WHERE reset_at<?').run(now());
    db.prepare("DELETE FROM outbox WHERE kind='login' AND status IN ('sent','expired')").run();
    db.prepare("DELETE FROM outbox WHERE kind='login' AND created_at<?").run(now()-3600000);
    // 模型调用台账只留 90 天：观测窗口足够，不让台账无限增长。
    db.prepare('DELETE FROM model_calls WHERE created_at<?').run(now()-90*86400000);
    await notifications.queueDigests();await mailer.flush();
  }finally{maintenanceRunning=false;}}
  function requireUser(req){const user=auth.session(req.headers.cookie);if(!user)throw new HttpError(401,'请先登录。');return user;}
  async function handler(req,res){
    try {
      const url=new URL(req.url,config.publicUrl),p=url.pathname,method=req.method;
      if(!p.startsWith('/api/'))return json(res,404,{error:'Not found'});
      const allowedHosts=new Set([new URL(config.publicUrl).host,...(!config.production?[`127.0.0.1:${config.port}`,`localhost:${config.port}`]:[])]);
      if(!allowedHosts.has(req.headers.host))throw new HttpError(403,'不允许的访问地址。');
      if(req.headers.origin&&req.headers.origin!==config.publicUrl)throw new HttpError(403,'不允许的跨站请求。');
      if(!['GET','HEAD'].includes(method)&&req.headers.origin!==config.publicUrl)throw new HttpError(403,'缺少有效来源。');
      if(p==='/api/health'&&method==='GET')return json(res,200,{ok:true,mailMode:config.mailMode,local:!config.production,collectionEnabled:config.collectorEnabled,intervalMinutes:config.intervalMs/60000,translation:translator.status().enabled,reviewModel:modelSettings.view().enabled,feedback:Boolean(config.feedbackTo)});
      if(p==='/api/auth/request'&&method==='POST'){const input=await body(req);return json(res,200,await auth.requestCode(input.email,clientIp(req,config)));}
      if(p==='/api/auth/verify'&&method==='POST'){const input=await body(req);const result=auth.verify(input.challengeId,input.code,clientIp(req,config));return json(res,200,{user:result.user},{'Set-Cookie':auth.cookie(result.token)});}
      if(p==='/api/auth/me'&&method==='GET')return json(res,200,{user:auth.session(req.headers.cookie)});
      if(p==='/api/auth/logout'&&method==='POST'){auth.logout(req.headers.cookie);return json(res,200,{ok:true},{'Set-Cookie':auth.cookie('',true)});}
      if(p==='/api/dev/login-mail'&&method==='GET'&&!config.production&&config.mailMode==='local'){
        const id=url.searchParams.get('challengeId');const row=db.prepare("SELECT o.payload FROM outbox o JOIN challenges c ON c.id=o.id WHERE o.id=? AND o.status='local' AND c.expires>? AND c.used=0").get(id,now());
        if(!row)throw new HttpError(404,'测试邮件不存在或已过期。');return json(res,200,JSON.parse(row.payload));
      }
      if(p==='/api/articles'&&method==='GET'){
        return json(res,200,publicArticles());
      }
      if(p==='/api/articles/translate'&&method==='POST'){
        const user=requireUser(req);
        auth.limit('translate:'+user.id,12,60000);
        const input=await body(req);
        // 翻译花请求用户自己的 Key；管理员未配个人接口时回落站点全局配置。
        const own=userModels.forUser(user.id);
        return json(res,200,await translator.translate(input.id,input.target,{userCall:true,userSettings:own.effective().enabled?own:null,siteFallback:user.isAdmin}));
      }
      if(p==='/api/feedback'&&method==='POST'){
        auth.limit('feedback:'+clientIp(req,config),3,3600000);
        if(!config.feedbackTo)throw new HttpError(503,'反馈投递尚未配置管理员邮箱。');
        const user=auth.session(req.headers.cookie);
        const input=await body(req);
        if(typeof input.text!=='string'||!input.text.trim()||input.text.length>5000)throw new HttpError(400,'请填写有效反馈。');
        const page=typeof input.page==='string'&&input.page.startsWith('/')?input.page.slice(0,300):'/';
        const text=`页面：${page}\n账号：${user?.email||'未登录'}\n\n${input.text.trim()}`;
        const id=mailer.enqueue({kind:'feedback',userId:user?.id||null,to:config.feedbackTo,subject:'土木雷达用户反馈',text});
        await mailer.deliver(id);
        return json(res,200,{id,status:db.prepare('SELECT status FROM outbox WHERE id=?').get(id).status});
      }
      if(p==='/api/collector/status'&&method==='GET'){
        const modelView=modelSettings.view(),reviewState=machineReview.status();
        return json(res,200,{...collector.status(),...collectionSchedule({db,config,now}),review:review.counts(),translation:translator.status(),modelReview:{enabled:modelView.enabled,model:modelView.model,running:reviewState.running,lastRun:reviewState.lastRun}});
      }
      if(p==='/api/model-config'&&method==='GET'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可查看大模型设置。');
        return json(res,200,{...modelSettings.view(),review:machineReview.status()});
      }
      if(p==='/api/model-config'&&method==='PUT'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可配置大模型。');
        auth.limit('model-config:'+user.id,10,60000);
        const input=await body(req);if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'设置内容无效。');
        return json(res,200,{...modelSettings.save(input),review:machineReview.status()});
      }
      if(p==='/api/model-config/reveal'&&method==='GET'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可查看大模型 Key。');
        auth.limit('model-reveal:'+user.id,10,60000);
        return json(res,200,modelSettings.reveal());
      }
      if(p==='/api/model-config/test'&&method==='POST'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可测试大模型连接。');
        auth.limit('model-test:'+user.id,5,60000);
        const input=await body(req);
        return json(res,200,await modelSettings.test(input&&typeof input==='object'&&!Array.isArray(input)?input:{},fetchImpl));
      }
      if(p==='/api/model-config/models'&&method==='POST'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可获取模型列表。');
        auth.limit('model-list:'+user.id,5,60000);
        const input=await body(req);
        return json(res,200,await modelSettings.listModels(input&&typeof input==='object'&&!Array.isArray(input)?input:{},fetchImpl));
      }
      if(p==='/api/model-config/usage'&&method==='GET'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可查看模型调用台账。');
        auth.limit('model-usage:'+user.id,30,60000);
        const days=Math.min(365,Math.max(1,Number(url.searchParams.get('days'))||30));
        return json(res,200,modelCalls.summary(days));
      }
      if(p==='/api/model-config/backfill'&&method==='POST'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可触发机器审核。');
        auth.limit('model-backfill:'+user.id,2,60000);
        if(machineReview.status().running)return json(res,200,{started:false,running:true});
        machineReview.backfill().catch(()=>{});
        return json(res,200,{started:true});
      }
      // 每用户自己的大模型接口：所有登录账号可管理，只读写本人的配置，驱动本人的文章翻译。
      if(p==='/api/my-model-config'&&method==='GET'){
        const user=requireUser(req);
        return json(res,200,userModels.forUser(user.id).view());
      }
      if(p==='/api/my-model-config'&&method==='PUT'){
        const user=requireUser(req);
        auth.limit('my-model-config:'+user.id,10,60000);
        const input=await body(req);if(!input||typeof input!=='object'||Array.isArray(input))throw new HttpError(400,'设置内容无效。');
        return json(res,200,userModels.forUser(user.id).save(input));
      }
      if(p==='/api/my-model-config/reveal'&&method==='GET'){
        const user=requireUser(req);
        auth.limit('my-model-reveal:'+user.id,10,60000);
        return json(res,200,userModels.forUser(user.id).reveal());
      }
      if(p==='/api/my-model-config/test'&&method==='POST'){
        const user=requireUser(req);
        auth.limit('my-model-test:'+user.id,5,60000);
        const input=await body(req);
        return json(res,200,await userModels.forUser(user.id).test(input&&typeof input==='object'&&!Array.isArray(input)?input:{},fetchImpl));
      }
      if(p==='/api/my-model-config/models'&&method==='POST'){
        const user=requireUser(req);
        auth.limit('my-model-list:'+user.id,5,60000);
        const input=await body(req);
        return json(res,200,await userModels.forUser(user.id).listModels(input&&typeof input==='object'&&!Array.isArray(input)?input:{},fetchImpl));
      }
      if(p==='/api/users'&&method==='GET'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可查看注册用户。');
        const t=now();
        const rows=db.prepare(`SELECT u.email,u.created_at,
          (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id AND s.expires>?) AS active_sessions,
          (SELECT MAX(s.expires) FROM sessions s WHERE s.user_id=u.id AND s.expires>?) AS session_until,
          (SELECT COUNT(*) FROM user_model_configs m WHERE m.user_id=u.id AND json_extract(m.value,'$.key') IS NOT NULL) AS own_key
          FROM users u ORDER BY u.created_at`).all(t,t);
        // 只返回注册元数据；不含任何会话令牌或 Key 内容。
        return json(res,200,{users:rows.map(r=>({email:r.email,isAdmin:config.adminEmails.includes(r.email),createdAt:r.created_at,activeSessions:r.active_sessions,sessionUntil:r.session_until,ownModelKey:Boolean(r.own_key)}))});
      }
      if(p==='/api/watchlist'&&method==='GET'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可查看观察名单。');
        return json(res,200,{layers:WATCH_LAYERS,orgs:watchlist.list().map(({addedBy,...org})=>org)});
      }
      if(p==='/api/watchlist'&&method==='POST'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可管理观察名单。');
        auth.limit('watchlist:'+user.id,20,60000);
        watchlist.add(await body(req),user.email);
        return json(res,200,{layers:WATCH_LAYERS,orgs:watchlist.list().map(({addedBy,...org})=>org)});
      }
      if(p==='/api/watchlist'&&method==='DELETE'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可管理观察名单。');
        auth.limit('watchlist:'+user.id,20,60000);
        const input=await body(req);
        watchlist.remove(typeof input?.id==='string'?input.id:'');
        return json(res,200,{layers:WATCH_LAYERS,orgs:watchlist.list().map(({addedBy,...org})=>org)});
      }
      if(p==='/api/intel/discovery'&&method==='GET'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可查看发现分析。');
        const days=Math.min(180,Math.max(7,Number(url.searchParams.get('days'))||30));
        return json(res,200,intel.discovery({days}));
      }
      if(p==='/api/intel/coverage'&&method==='GET'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可查看覆盖分析。');
        const days=Math.min(365,Math.max(30,Number(url.searchParams.get('days'))||90));
        return json(res,200,intel.coverage({days}));
      }
      if(p==='/api/intel/sources'&&method==='GET'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可查看信源产出。');
        return json(res,200,intel.sourceStats());
      }
      if(p==='/api/review/articles'&&method==='GET'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可进入审核台。');
        return json(res,200,review.list(url.searchParams.get('status')||'work'));
      }
      if(p==='/api/review/article'&&method==='PUT'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可审核条目。');
        auth.limit('review:'+user.id,30,60000);
        const input=await body(req);if(typeof input.id!=='string')throw new HttpError(400,'缺少条目编号。');
        return json(res,200,review.save(input.id,input,user.email));
      }
      if(p==='/api/review/batch'&&method==='POST'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可批量审核。');
        auth.limit('review-batch:'+user.id,10,60000);
        const input=await body(req);
        return json(res,200,review.batchSave(input,user.email));
      }
      // 事件组只由管理员显式合并/解除；词面相似建议（eventHint）只做展示，永远不自动写入。
      if(p==='/api/review/event'&&method==='POST'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可合并事件。');
        auth.limit('review-event:'+user.id,20,60000);
        const input=await body(req);
        return json(res,200,review.mergeEvents(input,user.email));
      }
      if(p==='/api/intake'&&method==='POST'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可登记线索。');
        auth.limit('intake:'+user.id,20,60000);
        const input=await body(req);
        const result=review.register(input,user.email);
        await notifications.queueDigests();await mailer.flush();
        return json(res,200,result);
      }
      if(p==='/api/collector/run'&&method==='POST'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可触发采集。');auth.limit('collect:'+user.id,1,60000);
        return json(res,200,await collector.run());
      }
      if(p==='/api/collector/source'&&method==='PUT'){
        const user=requireUser(req);if(!user.isAdmin)throw new HttpError(403,'仅管理员可管理来源。');const input=await body(req);
        if(!sources.some(s=>s.id===input.id)||typeof input.enabled!=='boolean')throw new HttpError(400,'来源配置无效。');
        if(input.enabled&&sources.find(s=>s.id===input.id)?.disabledReason)throw new HttpError(400,'该来源暂不允许自动采集。');
        db.prepare('UPDATE sources SET enabled=? WHERE id=?').run(input.enabled?1:0,input.id);return json(res,200,{ok:true});
      }
      if(p==='/api/notifications/unsubscribe'){
        const token=url.searchParams.get('token')||'';if(!/^[a-zA-Z0-9_-]{40,64}$/.test(token))throw new HttpError(400,'退订链接无效。');
        if(method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; form-action 'self'; frame-ancestors 'none'"});return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>土木雷达邮件退订</title><h1>停止邮件通知</h1><p>确认后将停止该账号的自动邮件通知。</p><form method="post"><button>确认退订</button></form></html>');}
        if(method==='POST'){notifications.unsubscribe(token);return json(res,200,{ok:true,message:'已停止邮件通知。'});}
      }
      const user=requireUser(req);
      if(p==='/api/workspace'&&method==='GET'){
        const row=db.prepare('SELECT * FROM workspaces WHERE user_id=?').get(user.id);return json(res,200,row?{userId:user.id,data:JSON.parse(row.data),revision:row.revision,updatedAt:row.updated_at}:{userId:user.id,data:null,revision:0});
      }
      if(p==='/api/workspace'&&method==='PUT'){
        const input=await body(req);if(input.userId!==user.id)throw new HttpError(403,'登录账号已改变，请重新载入资料。');if(!Number.isInteger(input.revision)||input.revision<0)throw new HttpError(400,'资料版本无效。');
        let data;try{data=parseBackup(JSON.stringify(input.data));}catch{throw new HttpError(400,'资料内容无效。');}
        const safe={version:1,saved:data.saved,followed:data.followed,notes:data.notes,seen:data.seen||{},prefs:data.prefs||{large:false},feedback:(data.feedback||[]).map(f=>({id:f.id,date:f.date,text:f.text,...(f.status?{status:f.status}:{}),...(f.deliveryId?{deliveryId:f.deliveryId}:{})}))};
        let changed;
        if(input.revision===0)changed=db.prepare('INSERT OR IGNORE INTO workspaces VALUES(?,?,1,?)').run(user.id,JSON.stringify(safe),now()).changes;
        else changed=db.prepare('UPDATE workspaces SET data=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?').run(JSON.stringify(safe),now(),user.id,input.revision).changes;
        if(!changed){const current=db.prepare('SELECT * FROM workspaces WHERE user_id=?').get(user.id);return json(res,409,{error:'另一设备已修改资料，请处理冲突。',data:current?JSON.parse(current.data):null,revision:current?.revision||0});}
        return json(res,200,{revision:input.revision+1,updatedAt:now()});
      }
      if(p==='/api/notifications'&&method==='GET')return json(res,200,notifications.settings(user.id));
      if(p==='/api/notifications'&&method==='PUT')return json(res,200,notifications.save(user.id,await body(req)));
      if(p==='/api/notifications/test'&&method==='POST'){auth.limit('test:'+user.id,1,60000);return json(res,200,await notifications.test(user));}
      if(p==='/api/notifications/history'&&method==='GET'){
        const rows=db.prepare("SELECT id,kind,status,attempts,created_at,sent_at,error FROM outbox WHERE user_id=? AND kind!='login' ORDER BY created_at DESC LIMIT 30").all(user.id);return json(res,200,{messages:rows});
      }
      if(p==='/api/notifications/retry'&&method==='POST'){
        const input=await body(req),row=db.prepare("SELECT * FROM outbox WHERE id=? AND user_id=? AND kind!='login'").get(input.id,user.id);
        if(!row||!['failed','retry'].includes(row.status)||now()-row.created_at>23*3600000)throw new HttpError(400,'该消息不可安全重试，请查看投递记录。');
        if(row.kind==='digest'&&!notifications.settings(user.id).enabled)throw new HttpError(400,'已退订，不能重试自动通知。');
        db.prepare("UPDATE outbox SET status='retry',attempts=0,next_attempt=? WHERE id=?").run(now(),row.id);await mailer.deliver(row.id);return json(res,200,{ok:true});
      }
      if(p==='/api/dev/mailbox'&&method==='GET'&&!config.production&&config.mailMode==='local'){
        return json(res,200,{messages:db.prepare("SELECT id,payload,created_at FROM outbox WHERE user_id=? AND status='local' AND kind!='login' ORDER BY created_at DESC LIMIT 20").all(user.id).map(r=>({...r,...JSON.parse(r.payload),payload:undefined}))});
      }
      return json(res,404,{error:'接口不存在。'});
    }catch(error){return json(res,error.status||500,{error:error.status?error.message:'服务暂时不可用，请稍后重试。'});}
  }
  return {handler,collector,notifications,mailer,auth,review,translator,machineReview,modelSettings,watchlist,intel,maintenance};
}
