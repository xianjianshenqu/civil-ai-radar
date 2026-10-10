import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { configFromEnv } from './config.mjs';
import { openDatabase } from './database.mjs';
import { createApp } from './app.mjs';
import { createScheduler } from './scheduler.mjs';
import { sources } from './sources.mjs';
import { createPublicFeeds, injectDetailMeta } from './feeds.mjs';
import { createAgentAccess } from './agentAccess.mjs';
import { createBackups } from './backup.mjs';
const config=configFromEnv(),db=openDatabase(config.database),app=createApp({db,config,sources});
const feeds=createPublicFeeds({db,config});
const agent=createAgentAccess({db,config});
// Recover ambiguous in-flight sends conservatively: do not replay after a process crash automatically.
db.prepare("UPDATE outbox SET status='failed',error='服务重启，投递结果待确认' WHERE status='sending'").run();
const root=path.resolve('dist/client');
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  // Agent 接入层（/api/v1、/api/mcp、/llms.txt、/skills/*）在主应用同源校验之前：
  // 这些端点是给外部 Agent 与跨域工具用的匿名只读路径，由 agentAccess 自行限流。
  if(await agent.handler(req,res))return;
  if(req.url.startsWith('/api/'))return app.handler(req,res);
  // 公开读取层（RSS/sitemap/robots）不分生产/开发，始终由 Node 服务提供。
  if(await feeds.handler(req,res))return;
  if(!config.production){res.writeHead(404);return res.end('Use the Vite preview');}
  try{
    const url=new URL(req.url,config.publicUrl),relative=decodeURIComponent(url.pathname).replace(/^\/+/,''),filename=path.resolve(root,relative);
    if(filename!==root&&!filename.startsWith(root+path.sep))throw new Error();
    // SPA 回退对任何客户端生效：无扩展名路径（/、/detail/x）一律回 index.html；缺失的带扩展名资源保持 404。
    let target=filename;try{if(!(await stat(target)).isFile())throw new Error();}catch{if(path.extname(url.pathname))throw new Error();target=path.join(root,'index.html');}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
    let content=await readFile(target);
    // 详情页在服务端注入标题与 OG meta：分享卡片与搜索引擎看到真实条目信息（只注入已存字段，不虚构）。
    if(target===path.join(root,'index.html')&&url.pathname.startsWith('/detail/')){
      const article=feeds.articleForDetail(url.pathname);
      if(article)content=Buffer.from(injectDetailMeta(content.toString('utf8'),article,config.publicUrl));
    }
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':target.endsWith('index.html')?'no-cache':'public,max-age=3600'});res.end(req.method==='HEAD'?undefined:content);
  }catch{res.writeHead(404);res.end('Not found');}
});
let work=Promise.resolve();
server.listen(config.port,config.host,()=>{
  const model=app.modelSettings.effective();
  const translation=app.translator.status();
  console.log(`Radar API ready on ${config.host}:${config.port}; mail=${config.mailMode}; translation=${translation.enabled?translation.via:'off'}; reviewModel=${model.url&&model.key?'on':'rules'}`);
  if(config.translationUrl){
    const ids=app.translator.pendingArticleIds();
    work=work.then(()=>app.translator.translateMany(ids)).then(report=>console.log('Translation backfill',report)).catch(error=>console.error('Translation backfill failed:',error.message));
  }
  work=work.then(()=>app.machineReview.backfill()).then(report=>console.log('Review triage backfill',report)).catch(error=>console.error('Review triage backfill failed:',error.message));
});
const scheduler=createScheduler({db,collector:app.collector,config});
const backups=createBackups({db,config});
// 每日数据库备份放在后台串行队列里，与采集、维护不并发；失败只记日志，不影响服务。
const backup=()=>{try{const result=backups.runDaily();if(result)console.log('Database backup',result);}catch(error){console.error('Database backup failed:',error.message);}};
const tick=()=>{work=work.then(()=>scheduler.tick()).then(()=>app.maintenance()).then(backup).catch(error=>console.error('Background task failed:',error.message));};
const timer=setInterval(tick,30000);
const initial=setTimeout(tick,1500);
let closing=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{
  if(closing)return;closing=true;clearInterval(timer);clearTimeout(initial);
  server.close(async()=>{await work;while(app.collector.running)await new Promise(r=>setTimeout(r,100));await app.collector.ready();await app.translator.idle();db.close();process.exit(0);});
});
