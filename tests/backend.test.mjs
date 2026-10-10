import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {openDatabase} from '../server/database.mjs';
import {createApp} from '../server/app.mjs';
import {parseFeed,canonicalUrl} from '../server/collector.mjs';
import {clientIp,configFromEnv,isAllowedTranslationUrl} from '../server/config.mjs';
import {createModelSettings,createUserModelSettings} from '../server/modelSettings.mjs';
import {smtpTransportOptions} from '../server/mail.mjs';
const source={id:'fixture',name:'Public Engineering Feed',url:'https://example.org/feed',sector:'施工',scope:'海外',region:'未知'};
const xml=(items=1)=>`<rss><channel>${Array.from({length:items},(_,i)=>`<item><title>AI for construction ${i}</title><link>https://example.org/article/${i}?utm_source=test</link><pubDate>Mon, 07 Sep 2026 01:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;
const blank=()=>({version:1,saved:[],followed:[],notes:{},seen:{},prefs:{large:false},feedback:[]});
async function fixture(t,{feed=xml(),fetchImpl,smtpSend,config:extra={}}={}){
  const db=openDatabase(':memory:');let time=Date.parse('2026-09-07T09:00:00Z');
  const config={production:false,publicUrl:'http://127.0.0.1',port:0,mailMode:'local',adminEmails:['admin@example.test'],feedbackTo:'admin@example.test',collectorEnabled:true,intervalMs:3600000,...extra};
  let calls=0;
  const app=createApp({db,config,sources:[source],now:()=>time,smtpSend,fetchImpl:fetchImpl||(async url=>{calls++;return new Response(url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':feed,{headers:{'Content-Type':url.endsWith('/robots.txt')?'text/plain':'application/rss+xml'}});})});
  const server=createServer(app.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));config.port=server.address().port;
  const listenOrigin=`http://127.0.0.1:${config.port}`;
  if(!config.production)config.publicUrl=listenOrigin;
  t.after(async()=>{await new Promise(r=>server.close(r));db.close();});
  async function request(path,{method='GET',data,cookie,origin=config.publicUrl,headers={}}={}){
    const response=await fetch(listenOrigin+'/api'+path,{method,headers:{Host:new URL(config.publicUrl).host,...(origin?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined});
    const text=await response.text();let result;try{result=JSON.parse(text);}catch{result=text;}
    return {status:response.status,data:result,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  async function challenge(email='reader@example.test'){
    const sent=await request('/auth/request',{method:'POST',data:{email}});assert.equal(sent.status,200,JSON.stringify(sent.data));
    const payload=JSON.parse(db.prepare('SELECT payload FROM outbox WHERE id=?').get(sent.data.challengeId).payload);
    return {challengeId:sent.data.challengeId,code:payload.text.match(/\d{6}/)[0]};
  }
  async function login(email){const c=await challenge(email);const response=await request('/auth/verify',{method:'POST',data:c});assert.equal(response.status,200);return {...response.data,cookie:response.cookie};}
  return {app,db,config,request,challenge,login,advance:ms=>{time+=ms;},calls:()=>calls};
}
test('email codes are one-time, sessions are HttpOnly and logout revokes access',async t=>{
 const f=await fixture(t),c=await f.challenge();const response=await f.request('/auth/verify',{method:'POST',data:c});assert.equal(response.status,200);
 assert.equal((await f.request('/auth/verify',{method:'POST',data:c})).status,400);
 assert.equal((await f.request('/workspace',{cookie:response.cookie})).status,200);
 await f.request('/auth/logout',{method:'POST',data:{},cookie:response.cookie});assert.equal((await f.request('/workspace',{cookie:response.cookie})).status,401);
});
test('public article translation rejects arbitrary content and reports unavailable providers honestly',async t=>{
 const f=await fixture(t,{feed:xml().replace('</item>','<description>AI construction news.</description></item>')});await f.app.collector.run();
 const article=(await f.request('/articles')).data.articles[0];assert.equal(article.reading.kind,'feed-summary');
 assert.equal((await f.request('/articles/translate',{method:'POST',data:{id:article.id,target:'zh'}})).status,401);
 const user=await f.login();
 assert.equal((await f.request('/articles/translate',{method:'POST',data:{id:article.id,target:'zh'},cookie:user.cookie})).status,503);
 assert.equal((await f.request('/articles/translate',{method:'POST',data:{id:article.id,target:'en'},cookie:user.cookie})).status,200);
 assert.equal((await f.request('/articles/translate',{method:'POST',data:{text:'arbitrary user text',target:'zh'},cookie:user.cookie})).status,400);
 assert.equal((await f.request('/articles/translate',{method:'POST',origin:'https://evil.example',data:{id:article.id,target:'zh'},cookie:user.cookie})).status,403);
});
test('code expiry, brute-force limits and request rate limits are enforced',async t=>{
 const f=await fixture(t),c=await f.challenge();for(let i=0;i<5;i++)assert.equal((await f.request('/auth/verify',{method:'POST',data:{...c,code:c.code==='000000'?'111111':'000000'}})).status,400);
 assert.equal((await f.request('/auth/verify',{method:'POST',data:c})).status,400);
 assert.equal((await f.request('/auth/request',{method:'POST',data:{email:'reader@example.test'}})).status,429);
 f.advance(60001);const next=await f.challenge();f.advance(600001);assert.equal((await f.request('/auth/verify',{method:'POST',data:next})).status,400);
});
test('local mode rejects real recipients and cross-site mutations',async t=>{
 const f=await fixture(t);assert.equal((await f.request('/auth/request',{method:'POST',data:{email:'person@company.com'}})).status,503);
 assert.equal((await f.request('/auth/request',{method:'POST',origin:'https://evil.example',data:{email:'a@example.test'}})).status,403);
 assert.equal((await f.request('/auth/request',{method:'POST',origin:null,data:{email:'a@example.test'}})).status,403);
});
test('accounts isolate data and optimistic revisions preserve conflicting edits',async t=>{
 const f=await fixture(t),a=await f.login('a@example.test'),b=await f.login('b@example.test');const data={...blank(),saved:['article-1'],notes:{'article-1':{text:'private note'}}};
 assert.equal((await f.request('/workspace',{method:'PUT',cookie:a.cookie,data:{userId:a.user.id,revision:0,data}})).status,200);
 assert.deepEqual((await f.request('/workspace',{cookie:a.cookie})).data.data.saved,['article-1']);
 assert.equal((await f.request('/workspace',{cookie:b.cookie})).data.data,null);
 assert.equal((await f.request('/workspace',{method:'PUT',cookie:b.cookie,data:{userId:a.user.id,revision:0,data}})).status,403);
 const conflict=await f.request('/workspace',{method:'PUT',cookie:a.cookie,data:{userId:a.user.id,revision:0,data:blank()}});assert.equal(conflict.status,409);assert.equal(conflict.data.revision,1);
 const update=await f.request('/workspace',{method:'PUT',cookie:a.cookie,data:{userId:a.user.id,revision:1,data:blank()}});assert.equal(update.status,200);
 assert.deepEqual((await f.request('/workspace',{cookie:a.cookie})).data.data.saved,[]);
});
test('collector handles robots, deduplicates canonical URLs, and keeps unknown event dates',async t=>{
 const f=await fixture(t);await f.app.collector.run();await f.app.collector.run();const rows=f.db.prepare('SELECT * FROM articles').all();assert.equal(rows.length,1);
 assert.equal(parseFeed(xml().replace('AI for construction 0','AI for construction &#039;test&#039;'),source)[0].title,"AI for construction 'test'");
 const article=JSON.parse(rows[0].data);assert.equal(article.eventDate,'未披露');assert.equal(article.evidence,'待复核');assert.equal(article.sourceUrl,'https://example.org/article/0');
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,2);
});
test('robots denial is recorded without fetching feed or inventing success',async t=>{
 const seen=[];const f=await fixture(t,{fetchImpl:async url=>{seen.push(url);return new Response('User-agent: *\nDisallow: /feed');}});await f.app.collector.run();assert.equal(seen.length,1);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM articles').get().n,0);assert.match(f.app.collector.status().sources[0].error,/disallows/);
});
test('feed parsing rejects entities, unsafe links, missing links and generic AI news',()=>{
 assert.throws(()=>parseFeed('<!DOCTYPE rss [<!ENTITY x "bad">]><rss/>',source));
 assert.equal(canonicalUrl('http://127.0.0.1/private',source.url),null);
 assert.equal(parseFeed('<rss><channel><item><title>AI for construction</title></item><item><title>Generic AI model release</title><link>https://example.org/a</link></item></channel></rss>',source).length,0);
 const atom=parseFeed('<feed><entry><title>AI construction research</title><link href="https://example.org/atom"/><updated>2026-09-07T00:00:00Z</updated></entry></feed>',source);assert.equal(atom[0].publishedDate,'未披露');
 assert.equal(parseFeed('<rss><channel><item><title>水利工程数字孪生调度</title><link>https://example.org/cn</link><description>水库数字孪生试验</description></item></channel></rss>',source).length,1);
 assert.equal(parseFeed('<rss><channel><item><title>设计院智慧工地试点</title><link>https://example.org/site</link><description>勘察单位数智化巡检</description></item></channel></rss>',source).length,1);
 const rdf=parseFeed('<rdf:RDF xmlns="http://purl.org/rss/1.0/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><item rdf:about="https://example.org/rdf"><title>Deep learning bridge inspection</title><link>https://example.org/rdf</link><description>civil infrastructure</description><dc:date>2026-09-17T00:00:00Z</dc:date></item></rdf:RDF>',source);
 assert.equal(rdf[0].sourceUrl,'https://example.org/rdf');
 assert.equal(rdf[0].publishedDate,'2026-09-17');
});
test('collection management requires an administrator',async t=>{
 const f=await fixture(t),u=await f.login('reader@example.test');assert.equal((await f.request('/collector/run',{method:'POST',data:{},cookie:u.cookie})).status,403);
 const admin=await f.login('admin@example.test');assert.equal((await f.request('/collector/run',{method:'POST',data:{},cookie:admin.cookie})).status,200);
});
test('digest consent, deduplication, local delivery and unsubscribe confirmation',async t=>{
 const f=await fixture(t),u=await f.login('reader@example.test');const setting={enabled:true,frequency:'hourly',sectors:['施工'],keyword:'construction'};
 await f.request('/notifications',{method:'PUT',cookie:u.cookie,data:setting});f.advance(1000);await f.app.collector.run();
 let messages=(await f.request('/dev/mailbox',{cookie:u.cookie})).data.messages;assert.equal(messages.length,1);assert.match(messages[0].text,/尚待复核/);
 await f.app.notifications.queueDigests();await f.app.mailer.flush();assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind='digest'").get().n,1);
 const token=new URL(messages[0].text.match(/https?:\/\/[^\s]+unsubscribe[^\s]+/)[0]).searchParams.get('token');
 assert.equal((await f.request('/notifications/unsubscribe?token='+token,{origin:null})).status,200);assert.equal(f.app.notifications.settings(u.user.id).enabled,true);
 assert.equal((await f.request('/notifications/unsubscribe?token='+token,{method:'POST'})).status,200);assert.equal(f.app.notifications.settings(u.user.id).enabled,false);
});
test('digest pagination does not lose entries sharing one collection timestamp',async t=>{
 const f=await fixture(t,{feed:xml(25)}),u=await f.login('reader@example.test');f.app.notifications.save(u.user.id,{enabled:true,frequency:'hourly',sectors:[],keyword:''});f.advance(1);await f.app.collector.run();
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind='digest'").get().n,1);f.advance(3600001);await f.app.maintenance();
 const payloads=f.db.prepare("SELECT payload FROM outbox WHERE kind='digest'").all().map(r=>JSON.parse(r.payload).text);
 assert.equal(payloads.length,2);const urls=payloads.join('\n').match(/https:\/\/example.org\/article\/\d+/g);assert.equal(new Set(urls).size,25);
});
test('production configuration cannot enable the local test mailbox',()=>{
 assert.throws(()=>configFromEnv({NODE_ENV:'production',PUBLIC_URL:'https://radar.example',MAIL_MODE:'local',ADMIN_EMAILS:'ops@radar.example',DATABASE_PATH:'/data/radar.sqlite'}));
});
test('production requires HTTPS, mail, admin inbox, secret and persistent database path',()=>{
 const base={NODE_ENV:'production',PUBLIC_URL:'https://radar.example',MAIL_MODE:'resend',RESEND_API_KEY:'k',MAIL_FROM:'ops@radar.example',AUTH_SECRET:'x'.repeat(32),ADMIN_EMAILS:'ops@radar.example',DATABASE_PATH:'/data/radar.sqlite'};
 assert.equal(configFromEnv(base).feedbackTo,'ops@radar.example');
 assert.throws(()=>configFromEnv({...base,MAIL_MODE:'local'}));
 assert.throws(()=>configFromEnv({...base,ADMIN_EMAILS:''}));
 assert.throws(()=>configFromEnv({...base,ADMIN_EMAILS:'admin@example.test'}));
 assert.throws(()=>configFromEnv({...base,FEEDBACK_TO:'ops@example.test'}));
 assert.throws(()=>configFromEnv({...base,DATABASE_PATH:undefined}));
 assert.throws(()=>configFromEnv({...base,PUBLIC_URL:'http://radar.example'}));
});
test('smtp production configuration validates provider credentials',()=>{
 const smtpEnv={NODE_ENV:'production',PUBLIC_URL:'https://radar.example.com',MAIL_MODE:'smtp',SMTP_HOST:'smtpdm.aliyun.com',SMTP_PORT:'465',SMTP_USER:'noreply@example.com',SMTP_PASS:'secret',MAIL_FROM:'noreply@example.com',AUTH_SECRET:'x'.repeat(32),ADMIN_EMAILS:'ops@example.com',DATABASE_PATH:'/data/radar.sqlite'};
 const smtpConfig=configFromEnv(smtpEnv);
 assert.equal(smtpConfig.mailMode,'smtp');assert.equal(smtpConfig.smtp.secure,true);assert.equal(smtpConfig.smtp.host,'smtpdm.aliyun.com');
 assert.throws(()=>configFromEnv({...smtpEnv,SMTP_USER:undefined}));
 assert.throws(()=>configFromEnv({...smtpEnv,SMTP_PASS:undefined}));
 assert.throws(()=>configFromEnv({...smtpEnv,SMTP_PORT:'70000'}));
 assert.throws(()=>configFromEnv({...smtpEnv,MAIL_MODE:'smtp',RESEND_API_KEY:'k',SMTP_HOST:undefined}));
});
test('smtp transport options map credentials into the auth object',()=>{
 const opts=smtpTransportOptions({host:'smtpdm.aliyun.com',port:465,secure:true,user:'noreply@dm.example.com',pass:'secret',replyTo:'service@example.com'});
 assert.equal(opts.auth.user,'noreply@dm.example.com');assert.equal(opts.auth.pass,'secret');
 assert.equal(opts.host,'smtpdm.aliyun.com');assert.equal(opts.secure,true);assert.equal(opts.requireTLS,false);
 assert.equal(opts.user,undefined);assert.equal(opts.pass,undefined);
});
test('smtp delivery retries failures and stores the provider message id',async t=>{
 const sent=[];const f=await fixture(t,{smtpSend:async(payload,smtp)=>{sent.push({payload,smtp});if(sent.length===1)throw new Error('SMTP connection refused');return {id:'<smtp-message-id@example.com>'};}});
 f.config.mailMode='smtp';f.config.smtp={host:'smtpdm.aliyun.com',port:465,secure:true,user:'noreply@dm.example.com',pass:'secret',replyTo:'service@example.com'};
 const id=f.app.mailer.enqueue({kind:'test',to:'user@example.com',subject:'验证码 123456',text:'您的验证码是 123456，10 分钟内有效。'});
 await f.app.mailer.deliver(id);assert.equal(f.db.prepare('SELECT status FROM outbox WHERE id=?').get(id).status,'retry');
 await f.app.mailer.flush();assert.equal(sent.length,1);f.advance(60001);await f.app.mailer.flush();
 assert.equal(sent.length,2);assert.equal(sent[0].payload.subject,'验证码 123456');assert.equal(sent[0].smtp.host,'smtpdm.aliyun.com');assert.equal(sent[0].smtp.replyTo,'service@example.com');
 assert.equal(f.db.prepare('SELECT status FROM outbox WHERE id=?').get(id).status,'sent');
 assert.equal(f.db.prepare('SELECT provider_id FROM outbox WHERE id=?').get(id).provider_id,'<smtp-message-id@example.com>');
});
test('translation URL allows private HTTP translators and rejects public HTTP',()=>{
 assert.equal(isAllowedTranslationUrl('https://translate.example/translate',true),true);
 assert.equal(isAllowedTranslationUrl('http://translate:5000/translate',true),true);
 assert.equal(isAllowedTranslationUrl('http://127.0.0.1:5000/translate',false),true);
 assert.equal(isAllowedTranslationUrl('http://translate.example/translate',true),false);
 assert.equal(isAllowedTranslationUrl('https://127.0.0.1/translate',true),false);
 assert.equal(isAllowedTranslationUrl('https://169.254.169.254/translate',true),false);
 assert.equal(isAllowedTranslationUrl('https://metadata.google.internal/translate',true),false);
 assert.throws(()=>configFromEnv({TRANSLATION_URL:'http://translate.example/translate'}));
});
test('another session of the same email reads synchronized notes',async t=>{
 const f=await fixture(t),a=await f.login();const data={...blank(),saved:['shared'],notes:{shared:{text:'跨设备笔记'}}};
 await f.request('/workspace',{method:'PUT',cookie:a.cookie,data:{userId:a.user.id,revision:0,data}});
 f.advance(60001);const second=await f.login();assert.notEqual(second.cookie,a.cookie);assert.equal(second.user.id,a.user.id);
 assert.equal((await f.request('/workspace',{cookie:second.cookie})).data.data.notes.shared.text,'跨设备笔记');
});
test('failed mail delivery retries with the same immutable idempotency key',async t=>{
 const keys=[];const f=await fixture(t,{fetchImpl:async(url,options)=>{keys.push(options.headers['Idempotency-Key']);return keys.length===1?new Response('',{status:503}):Response.json({id:'provider-id'});}});
 f.config.mailMode='resend';f.config.resendKey='test-only';f.config.mailFrom='test@example.test';
 const id=f.app.mailer.enqueue({kind:'test',to:'recipient@example.test',subject:'test',text:'test'});
 await f.app.mailer.deliver(id);assert.equal(f.db.prepare('SELECT status FROM outbox WHERE id=?').get(id).status,'retry');
 await f.app.mailer.flush();assert.equal(keys.length,1);f.advance(60001);await f.app.mailer.flush();
 assert.deepEqual(keys,[id,id]);assert.equal(f.db.prepare('SELECT status FROM outbox WHERE id=?').get(id).status,'sent');
});
test('conditional collection preserves existing articles on HTTP 304',async t=>{
 let feedCalls=0;const f=await fixture(t,{fetchImpl:async(url,options)=>{
  if(url.endsWith('robots.txt'))return new Response('User-agent: *\nAllow: /');
  if(feedCalls++){assert.equal(options.headers['If-None-Match'],'"v1"');return new Response(null,{status:304});}
  return new Response(xml(),{headers:{etag:'"v1"'}});
 }});await f.app.collector.run();await f.app.collector.run();
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM articles').get().n,1);assert.equal(f.app.collector.status().sources[0].error,null);
});
test('review desk is admin-only, hides rejected items, and keeps editorial overlay after recrawl',async t=>{
 const f=await fixture(t,{feed:xml().replace('</item>','<description>AI construction hydraulic tunnel.</description></item>')});
 await f.app.collector.run();
 const id=f.db.prepare('SELECT id FROM articles').get().id;
 const reader=await f.login('reader@example.test');
 assert.equal((await f.request('/review/articles',{cookie:reader.cookie})).status,403);
 const admin=await f.login('admin@example.test');
 const queue=(await f.request('/review/articles?status=archived',{cookie:admin.cookie})).data;
 assert.equal(queue.counts.archived,1);
 assert.equal(queue.counts.work,0);
 assert.equal((await f.request('/review/article',{method:'PUT',cookie:admin.cookie,data:{id,status:'rejected'}})).status,200);
 assert.equal((await f.request('/articles')).data.articles.length,0);
 const published=await f.request('/review/article',{method:'PUT',cookie:admin.cookie,data:{
  id,status:'approved',sector:'水利',scope:'国内',region:'中国',maturity:'研究',layer:'研究',engineeringStage:'防灾与水利',
  summary:'编辑摘要。',implication:'先核对原文试验边界。',featuredRank:1,topicIds:['smart-reservoir-basin'],
  reading:{zh:['第一段。','第二段。']},
  verificationRecord:{status:'verified',reviewer:'值班编辑',checkedAt:'2026-09-14T12:00:00+08:00',notes:'已对照原文题目与摘要。',references:[{title:'入库原文',url:'https://example.org/article/0'}]}
 }});
 assert.equal(published.status,200,JSON.stringify(published.data));
 const visible=(await f.request('/articles')).data.articles[0];
 assert.equal(visible.reviewed,true);assert.equal(visible.sector,'水利');assert.equal(visible.featuredRank,1);
 assert.equal(visible.reading.kind,'editorial');assert.equal(visible.verificationRecord.reviewer,'值班编辑');
 const homepage=await f.request('/review/article',{method:'PUT',cookie:admin.cookie,data:{id,status:'approved',verificationRecord:{status:'verified',reviewer:'x',checkedAt:'2026-09-14T12:00:00+08:00',notes:'n',references:[{title:'官网',url:'https://example.org/'}]}}});
 assert.equal(homepage.status,400);
});
test('collector recrawl keeps editorial overlay and Chinese civil AI items match',async t=>{
 let feed='<rss><channel><item><title>水利工程数字孪生调度</title><link>https://example.org/cn/1</link><pubDate>Mon, 14 Sep 2026 01:00:00 GMT</pubDate><description>水库数字孪生。</description></item></channel></rss>';
 const f=await fixture(t,{fetchImpl:async url=>{
  if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
  return new Response(feed,{headers:{'Content-Type':'application/rss+xml'}});
 }});
 await f.app.collector.run();
 const id=f.db.prepare('SELECT id FROM articles').get().id;
 const admin=await f.login('admin@example.test');
 assert.equal((await f.request('/review/article',{method:'PUT',cookie:admin.cookie,data:{id,status:'approved',summary:'已发布摘要。',implication:'保留编辑判断。',featuredRank:2}})).status,200);
 feed='<rss><channel><item><title>水利工程数字孪生调度（修订）</title><link>https://example.org/cn/1</link><pubDate>Mon, 14 Sep 2026 01:00:00 GMT</pubDate><description>水库数字孪生更新。</description></item></channel></rss>';
 await f.app.collector.run();
 const article=JSON.parse(f.db.prepare('SELECT data FROM articles').get().data);
 assert.equal(article.title.includes('修订'),true);
 assert.equal(article.editorial.status,'approved');
 assert.equal(article.editorial.summary,'已发布摘要。');
 const publicItem=(await f.request('/articles')).data.articles[0];
 assert.equal(publicItem.summary,'已发布摘要。');assert.equal(publicItem.featuredRank,2);
});
test('homepage-only evidence and unknown topics are rejected by the review API',async t=>{
 const f=await fixture(t);await f.app.collector.run();
 const id=f.db.prepare('SELECT id FROM articles').get().id;
 const admin=await f.login('admin@example.test');
 assert.equal((await f.request('/review/article',{method:'PUT',cookie:admin.cookie,data:{id,status:'approved',topicIds:['not-a-topic']}})).status,400);
});
test('new collection is translated for bilingual reading and never scrapes article HTML',async t=>{
 const seen=[];
 const feed=xml().replace('</item>','<description>AI construction hydraulic tunnel.</description></item>');
 const f=await fixture(t,{config:{translationUrl:'http://127.0.0.1:5000/translate'},fetchImpl:async(url,opts)=>{
  seen.push(String(url));
  if(String(url).includes('/translate')){
   const body=JSON.parse(opts.body);
   return Response.json({translatedText:body.q.map(()=>'水利隧道工程人工智能摘要。')});
  }
  if(String(url).endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
  return new Response(feed,{headers:{'Content-Type':'application/rss+xml'}});
 }});
 await f.app.collector.run();await f.app.collector.ready();
 assert.equal(seen.some(url=>url.includes('/article/')),false);
 const health=(await f.request('/health')).data;
 assert.equal(health.translation,true);assert.equal(health.feedback,true);
 const article=(await f.request('/articles')).data.articles[0];
 assert.equal(article.reading.kind,'feed-summary');
 assert.equal(article.reading.paragraphs.zh[0],'水利隧道工程人工智能摘要。');
 assert.equal(article.reading.translationLabel,'机器翻译 · 待校对');
});
test('translation reuses the settings-page model when no dedicated translator is configured',async t=>{
 const feed=xml().replace('</item>','<description>AI construction hydraulic tunnel.</description></item>');
 const modelCalls=[];
 const f=await fixture(t,{config:{reviewModelUrl:'https://model.example/chat/completions',reviewModelKey:'sk-test',reviewModel:'glm-test'},fetchImpl:async(url,opts)=>{
  if(String(url)==='https://model.example/chat/completions'){
   const body=JSON.parse(opts.body);
   const content=String(body.messages[0].content);
   let payload;
   if(content.includes('专业翻译')){
    modelCalls.push({kind:'translate',paragraphs:body.messages[1]&&JSON.parse(body.messages[1].content).paragraphs});
    payload={translations:JSON.parse(body.messages[1].content).paragraphs.map(()=>'智能建造水利隧道摘要。')};
   }else{
    modelCalls.push({kind:'review'});
    payload={summary:'机器整理草稿',implication:'假设有参考价值。',offerings:[],maturity:'未披露',engineeringStage:'',salesStage:'',needsHuman:true,salesValue:50,salesVerdict:'观察',verdictReason:'证据不足，观察。',extracted:{amounts:[],deadline:'',clientOrgs:[]}};
   }
   return Response.json({choices:[{message:{content:JSON.stringify(payload)}}]});
  }
  if(String(url).endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
  return new Response(feed,{headers:{'Content-Type':'application/rss+xml'}});
 }});
 await f.app.collector.run();await f.app.collector.ready();
 assert.equal(modelCalls.some(call=>call.kind==='translate'),true);
 let health=(await f.request('/health')).data;
 assert.equal(health.translation,true);assert.equal(health.reviewModel,true);
 let status=(await f.request('/collector/status')).data;
 assert.deepEqual(status.translation,{enabled:true,via:'model'});
 const article=(await f.request('/articles')).data.articles[0];
 assert.equal(article.reading.paragraphs.zh[0],'智能建造水利隧道摘要。');
 assert.equal(article.reading.translationLabel,'机器翻译 · 待校对');
 // 关闭“复用模型翻译”后如实报告不可用；其余自动化开关不受影响。
 const admin=await f.login('admin@example.test');
 const saved=(await f.request('/model-config',{method:'PUT',cookie:admin.cookie,data:{automation:{useModelTranslation:false}}})).data;
 assert.equal(saved.automation.autoArchiveLow,true);assert.equal(saved.automation.useModelTranslation,false);
 health=(await f.request('/health')).data;assert.equal(health.translation,false);
 status=(await f.request('/collector/status')).data;assert.deepEqual(status.translation,{enabled:false,via:null});
});
 test('model translations that echo the source are rejected honestly',async t=>{
 const feed=xml().replace('</item>','<description>AI construction hydraulic tunnel.</description></item>');
 const f=await fixture(t,{config:{reviewModelUrl:'https://model.example/chat/completions',reviewModelKey:'sk-test',reviewModel:'glm-test'},fetchImpl:async(url,opts)=>{
  if(String(url)==='https://model.example/chat/completions'){
   const body=JSON.parse(opts.body);
   const content=String(body.messages[0].content);
   let payload;
   if(content.includes('专业翻译'))payload={translations:JSON.parse(body.messages[1].content).paragraphs.map(p=>p)};
   else payload={summary:'规则模式',implication:'',offerings:[],maturity:'未披露',engineeringStage:'',salesStage:'',needsHuman:true,salesValue:0,salesVerdict:'观察',verdictReason:'',extracted:{amounts:[],deadline:'',clientOrgs:[]}};
   return Response.json({choices:[{message:{content:JSON.stringify(payload)}}]});
  }
  if(String(url).endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
  return new Response(feed,{headers:{'Content-Type':'application/rss+xml'}});
 }});
 await f.app.collector.run();await f.app.collector.ready();
 let article=(await f.request('/articles')).data.articles[0];
 assert.equal(article.reading.paragraphs.zh,undefined);
 // 普通用户未接入自己的接口：不回落站长全局 Key，得到可行动提示而非伪翻译。
 const reader=await f.login();
 const blocked=(await f.request('/articles/translate',{method:'POST',cookie:reader.cookie,data:{id:article.id,target:'zh'}}));
 assert.equal(blocked.status,503);
 assert.match(blocked.data.error,/设置 → 大模型接入/);
 const admin=await f.login('admin@example.test');
 const refused=(await f.request('/articles/translate',{method:'POST',cookie:admin.cookie,data:{id:article.id,target:'zh'}}));
 assert.equal(refused.status,502);
 assert.match(refused.data.error,/未通过校验/);
 article=(await f.request('/articles')).data.articles[0];
 assert.equal(article.reading.paragraphs.zh,undefined);
});
test('model translation auth failures surface the provider status as an actionable error',async t=>{
 const feed=xml().replace('</item>','<description>AI construction hydraulic tunnel.</description></item>');
 const f=await fixture(t,{config:{reviewModelUrl:'https://model.example/chat/completions',reviewModelKey:'sk-stale',reviewModel:'glm-test'},fetchImpl:async(url,opts)=>{
  if(String(url)==='https://model.example/chat/completions'){
   const body=JSON.parse(opts.body);
   if(String(body.messages[0].content).includes('专业翻译'))return Response.json({error:{code:'401',message:'令牌已过期或验证不正确'}},{status:401});
   return Response.json({choices:[{message:{content:JSON.stringify({summary:'规则模式',implication:'',offerings:[],maturity:'未披露',engineeringStage:'',salesStage:'',needsHuman:true,salesValue:0,salesVerdict:'观察',verdictReason:'',extracted:{amounts:[],deadline:'',clientOrgs:[]}})}}]});
  }
  if(String(url).endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
  return new Response(feed,{headers:{'Content-Type':'application/rss+xml'}});
 }});
 await f.app.collector.run();await f.app.collector.ready();
 const article=(await f.request('/articles')).data.articles[0];
 assert.equal(article.reading.paragraphs.zh,undefined);
 const admin=await f.login('admin@example.test');
 const result=await f.request('/articles/translate',{method:'POST',cookie:admin.cookie,data:{id:article.id,target:'zh'}});
 assert.equal(result.status,502);
 assert.match(result.data.error,/HTTP 401/);
 assert.match(result.data.error,/API Key/);
 assert.doesNotMatch(result.data.error,/稍后重试/);
 const stored=JSON.parse(f.db.prepare('SELECT data FROM articles WHERE id=?').get(article.id).data);
 assert.equal(stored.reading.paragraphs.zh,undefined);
});
test('per-user model keys drive translation without spending the site key',async t=>{
 const feed='<rss><channel><item><title>AI for construction 0</title><link>https://example.org/article/0</link><pubDate>Mon, 07 Sep 2026 01:00:00 GMT</pubDate><description>AI construction hydraulic tunnel.</description></item><item><title>AI for construction 1</title><link>https://example.org/article/1</link><pubDate>Mon, 07 Sep 2026 01:00:00 GMT</pubDate><description>Smart inspection for bridges.</description></item></channel></rss>';
 const authHeaders=[];
 const f=await fixture(t,{config:{reviewModelUrl:'https://model.example/chat/completions',reviewModelKey:'sk-site',reviewModel:'glm-test'},fetchImpl:async(url,opts)=>{
  if(String(url)==='https://model.example/chat/completions'){
   authHeaders.push(String(opts.headers.Authorization));
   const body=JSON.parse(opts.body);
   if(String(body.messages[0].content).includes('专业翻译'))return Response.json({choices:[{message:{content:JSON.stringify({translations:JSON.parse(body.messages[1].content).paragraphs.map(()=>'智能建造水利隧道摘要。')})}}]});
   return Response.json({choices:[{message:{content:JSON.stringify({summary:'规则模式',implication:'',offerings:[],maturity:'未披露',engineeringStage:'',salesStage:'',needsHuman:true,salesValue:0,salesVerdict:'观察',verdictReason:'',extracted:{amounts:[],deadline:'',clientOrgs:[]}})}}]});
  }
  if(String(url).endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
  return new Response(feed,{headers:{'Content-Type':'application/rss+xml'}});
 }});
 // 先关闭后台自动翻译，保证条目保持未翻译，用于验证手动路径的按用户 Key。
 const admin=await f.login('admin@example.test');
 await f.request('/model-config',{method:'PUT',cookie:admin.cookie,data:{automation:{useModelTranslation:false}}});
 await f.app.collector.run();await f.app.collector.ready();
 const list=(await f.request('/articles')).data.articles;
 const first=list.find(a=>a.title==='AI for construction 0'),second=list.find(a=>a.title==='AI for construction 1');
 assert.equal(first.reading.paragraphs.zh,undefined);assert.equal(second.reading.paragraphs.zh,undefined);
 // 个人接口需要登录；未接入自己的接口时得到可行动提示，而不是回落站长 Key。
 const reader=await f.login();
 assert.equal((await f.request('/my-model-config')).status,401);
 const blocked=await f.request('/articles/translate',{method:'POST',cookie:reader.cookie,data:{id:first.id,target:'zh'}});
 assert.equal(blocked.status,503);assert.match(blocked.data.error,/设置 → 大模型接入/);
 // 保存自己的接口：回显只有掩码，绝不返回原文；automation 字段对个人接口无效。
 const saved=await f.request('/my-model-config',{method:'PUT',cookie:reader.cookie,data:{url:'https://model.example/chat/completions',key:'sk-reader-0123456789abcdef',model:'glm-reader'}});
 assert.equal(saved.status,200);assert.equal(saved.data.enabled,true);assert.equal(saved.data.keySet,true);
 assert.equal(JSON.stringify(saved.data).includes('sk-reader-0123456789abcdef'),false);assert.equal(saved.data.keyMasked,'sk-rea'+'…'+'abcdef');
 assert.equal((await f.request('/my-model-config/reveal',{cookie:reader.cookie})).data.key,'sk-reader-0123456789abcdef');
 assert.equal((await f.request('/my-model-config',{method:'PUT',cookie:reader.cookie,data:{automation:{autoArchiveLow:false}}})).status,400);
 // 手动翻译走 reader 自己的 Key。
 const done=await f.request('/articles/translate',{method:'POST',cookie:reader.cookie,data:{id:first.id,target:'zh'}});
 assert.equal(done.status,200);
 assert.equal(authHeaders[authHeaders.length-1],'Bearer sk-reader-0123456789abcdef');
 const after=await f.request('/articles');
 assert.equal(after.data.articles.find(a=>a.id===first.id).reading.paragraphs.zh[0],'智能建造水利隧道摘要。');
 // 其他账号看不到 reader 的配置；管理员未配个人接口时回落站点全局 Key（回落链路同样受“复用模型翻译”开关约束）。
 const other=await f.login('other@example.test');
 assert.equal((await f.request('/my-model-config',{cookie:other.cookie})).data.keySet,false);
 await f.request('/model-config',{method:'PUT',cookie:admin.cookie,data:{automation:{useModelTranslation:true}}});
 const adminDone=await f.request('/articles/translate',{method:'POST',cookie:admin.cookie,data:{id:second.id,target:'zh'}});
 assert.equal(adminDone.status,200);
 assert.equal(authHeaders[authHeaders.length-1],'Bearer sk-site');
});
test('personal model URLs are restricted to public HTTPS in production',async t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());
 const user=createUserModelSettings({db,config:{production:true},now:()=>0}).forUser('u1');
 // 开放注册下，个人接口不能指向内网/回环/单标签主机名，避免把站点当内网探测器。
 assert.throws(()=>user.save({url:'http://127.0.0.1:5001/v1/chat/completions',key:'k'}),/公网 HTTPS/);
 assert.throws(()=>user.save({url:'http://translate:5000/v1/chat/completions',key:'k'}),/公网 HTTPS/);
 assert.throws(()=>user.save({url:'https://127.0.0.1/v1/chat/completions',key:'k'}),/公网 HTTPS/);
 assert.equal(user.save({url:'https://api.deepseek.com/chat/completions',key:'sk-x'}).enabled,true);
 // 站点作用域（管理员）在生产仍允许 Docker 内网翻译服务名；本地开发允许回环地址自测。
 const site=createModelSettings({db,config:{production:true},now:()=>0});
 assert.equal(site.save({url:'http://translate:5000/translate',key:'k'}).enabled,true);
 const devUser=createUserModelSettings({db,config:{production:false},now:()=>0}).forUser('u2');
 assert.equal(devUser.save({url:'http://127.0.0.1:5001/v1/chat/completions',key:'k'}).enabled,true);
});
test('a failing personal model key points its owner at their own settings',async t=>{
 const feed=xml().replace('</item>','<description>AI construction hydraulic tunnel.</description></item>');
 const f=await fixture(t,{fetchImpl:async url=>{
  if(String(url)==='https://personal.example/chat/completions')return Response.json({error:{message:'bad key'}},{status:401});
  if(String(url).endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
  return new Response(feed,{headers:{'Content-Type':'application/rss+xml'}});
 }});
 await f.app.collector.run();await f.app.collector.ready();
 const article=(await f.request('/articles')).data.articles[0];
 const user=await f.login();
 await f.request('/my-model-config',{method:'PUT',cookie:user.cookie,data:{url:'https://personal.example/chat/completions',key:'sk-bad',model:'m'}});
 const result=await f.request('/articles/translate',{method:'POST',cookie:user.cookie,data:{id:article.id,target:'zh'}});
 assert.equal(result.status,502);
 assert.match(result.data.error,/设置 → 大模型接入/);
 assert.match(result.data.error,/你自己的 API Key/);
});
test('registered user list is admin-only registration metadata',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/users')).status,401);
 const reader=await f.login();
 assert.equal((await f.request('/users',{cookie:reader.cookie})).status,403);
 const admin=await f.login('admin@example.test');
 const list=(await f.request('/users',{cookie:admin.cookie})).data;
 assert.equal(Array.isArray(list.users),true);
 assert.deepEqual(list.users.map(u=>u.email).sort(),['admin@example.test','reader@example.test']);
 const mine=list.users.find(u=>u.email==='admin@example.test');
 assert.equal(mine.isAdmin,true);assert.equal(mine.ownModelKey,false);assert.ok(mine.activeSessions>=1);assert.ok(mine.sessionUntil>0);
 const other=list.users.find(u=>u.email==='reader@example.test');
 assert.equal(other.isAdmin,false);
 // 接入个人 Key 后面板如实反映；响应不含任何 Key 原文或会话令牌。
 await f.request('/my-model-config',{method:'PUT',cookie:reader.cookie,data:{url:'https://api.deepseek.com/chat/completions',key:'sk-reader-panel-0123456789',model:'m'}});
 const list2=(await f.request('/users',{cookie:admin.cookie})).data;
 assert.equal(list2.users.find(u=>u.email==='reader@example.test').ownModelKey,true);
 assert.ok(!JSON.stringify(list2).includes('sk-reader-panel'));
});
test('translation failure does not block collection or invent bilingual text',async t=>{
 const f=await fixture(t,{config:{translationUrl:'http://127.0.0.1:5000/translate'},feed:xml().replace('</item>','<description>AI construction news.</description></item>'),fetchImpl:async url=>{
  if(String(url).includes('/translate'))return new Response('',{status:503});
  if(String(url).endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
  return new Response(xml().replace('</item>','<description>AI construction news.</description></item>'),{headers:{'Content-Type':'application/rss+xml'}});
 }});
 await f.app.collector.run();await f.app.collector.ready();
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM articles').get().n,1);
 const article=(await f.request('/articles')).data.articles[0];
 assert.equal(article.reading.paragraphs.zh,undefined);
 assert.equal(article.reading.translationLabel,undefined);
});
test('feedback is queued through mail and rejected across origins',async t=>{
 const f=await fixture(t);
 const sent=await f.request('/feedback',{method:'POST',data:{text:'详情页无法打开',page:'/detail/sample'}});
 assert.equal(sent.status,200,JSON.stringify(sent.data));
 assert.equal(sent.data.status,'local');
 const row=f.db.prepare("SELECT * FROM outbox WHERE kind='feedback'").get();
 assert.match(JSON.parse(row.payload).text,/详情页无法打开/);
 assert.equal((await f.request('/feedback',{method:'POST',data:{text:'',page:'/'}})).status,400);
 assert.equal((await f.request('/feedback',{method:'POST',origin:'https://evil.example',data:{text:'leak',page:'/'}})).status,403);
});
test('resend login mail does not retain the plaintext OTP in outbox',async t=>{
 const f=await fixture(t,{fetchImpl:async url=>{
  if(String(url).includes('resend.com'))return Response.json({id:'mail-1'});
  return new Response('',{status:404});
 }});
 f.config.mailMode='resend';f.config.resendKey='k';f.config.mailFrom='ops@example.test';
 const id=f.app.mailer.enqueue({id:'login-test',kind:'login',to:'ops@example.test',subject:'code',text:'验证码：123456\n10 分钟内有效，仅可使用一次。'});
 await f.app.mailer.deliver(id);
 const row=f.db.prepare('SELECT status,payload FROM outbox WHERE id=?').get(id);
 assert.equal(row.status,'sent');
 assert.equal(/\b\d{6}\b/.test(JSON.parse(row.payload).text),false);
 assert.match(JSON.parse(row.payload).text,/\*{6}/);
});
test('production rate limits use the reverse-proxy hop, not the client-supplied X-Forwarded-For prefix',()=>{
 const req=headers=>({headers,socket:{remoteAddress:'10.0.0.2'}});
 assert.equal(clientIp(req({'x-forwarded-for':'8.8.8.8, 203.0.113.10'}),{production:true}),'203.0.113.10');
 assert.equal(clientIp(req({'x-forwarded-for':'8.8.8.8'}),{production:true}),'8.8.8.8');
 assert.equal(clientIp(req({}),{production:true}),'10.0.0.2');
 assert.equal(clientIp(req({'x-forwarded-for':'8.8.8.8, 203.0.113.10'}),{production:false}),'10.0.0.2');
});
test('mail IP buckets follow the resolved client IP rather than a spoofed prefix',async t=>{
 const f=await fixture(t);
 for(let i=0;i<10;i++)await f.app.auth.requestCode(`user${i}@example.test`,'203.0.113.9');
 await assert.rejects(()=>f.app.auth.requestCode('last@example.test','203.0.113.9'),e=>e.status===429);
 const next=await f.app.auth.requestCode('other@example.test','203.0.113.10');
 assert.ok(next.challengeId);
});
test('collector status omits cache validators from the public payload',async t=>{
 const f=await fixture(t);await f.app.collector.run();
 const status=(await f.request('/collector/status')).data;
 assert.equal('etag' in (status.sources[0]||{}),false);
 assert.equal('last_modified' in (status.sources[0]||{}),false);
 assert.ok(status.sources[0].url);
});
test('allowlisted article hosts can use http links upgraded to https; other hosts stay rejected',()=>{
 const arxiv={id:'arxiv',name:'arXiv',url:'https://rss.arxiv.org/rss/cs.CE',articleHosts:['arxiv.org'],sector:'施工',scope:'海外',region:'国际',tier:'t1'};
 const [item]=parseFeed('<rss><channel><item><title>AI for construction simulation</title><link>http://arxiv.org/abs/2609.12345</link><description>civil engineering machine learning</description></item></channel></rss>',arxiv);
 assert.equal(item.sourceUrl,'https://arxiv.org/abs/2609.12345');
 assert.equal(item.sourceTier,'t1');
 assert.equal(item.featuredRank,undefined);
 assert.equal(item.evidence,'待复核');
 assert.ok(item.assistScore.total>0);
 assert.equal(item.assistScore.suggestFeatured,false);
 assert.equal(canonicalUrl('https://evil.example/abs/1',arxiv.url,arxiv.articleHosts),null);
 assert.equal(parseFeed('<rss><channel><item><title>AI for construction</title><link>https://evil.example/a</link></item></channel></rss>',arxiv).length,0);
});
test('first-party sales scores outrank reprints and never write featuredRank or verified evidence',async t=>{
 const feed=`<rss><channel>
  <item><title>Generic AI construction note</title><link>https://example.org/a/low</link><description>AI construction.</description></item>
  <item><title>AI BIM digital twin construction bridge tunnel inspection</title><link>https://example.org/a/high</link><description>machine learning civil infrastructure.</description></item>
 </channel></rss>`;
 const f=await fixture(t,{feed});
 await f.app.collector.run();
 const admin=await f.login('admin@example.test');
 const pending=(await f.request('/review/articles?status=all',{cookie:admin.cookie})).data.articles;
 assert.ok(pending.length>=2);
 assert.ok(pending.every(item=>!item.article.featuredRank));
 const work=(await f.request('/review/articles?status=work',{cookie:admin.cookie})).data.articles;
 assert.ok(work.every(item=>['P0','P1'].includes(item.article.assistScore.priority)));
 const archived=(await f.request('/review/articles?status=archived',{cookie:admin.cookie})).data.articles;
 assert.ok(archived.length>=1);
 const publicItems=(await f.request('/articles')).data.articles;
 assert.ok(publicItems.every(a=>!a.featuredRank && a.evidence==='待复核' && !a.reviewed));
 assert.ok(publicItems.some(a=>a.reviewStatus==='archived'));
});
test('review desk stores sales tags on editorial records only',async t=>{
 const f=await fixture(t,{feed:xml().replace('</item>','<description>AI construction hydraulic tunnel.</description></item>')});
 await f.app.collector.run();
 const id=f.db.prepare('SELECT id FROM articles').get().id;
 const collected=JSON.parse(f.db.prepare('SELECT data FROM articles').get().data);
 assert.equal(collected.offerings,undefined);
 assert.equal(collected.editorial?.status,'archived');
 assert.equal(collected.editorial?.offerings,undefined);
 const admin=await f.login('admin@example.test');
 const listed=await f.request('/review/articles?status=all',{cookie:admin.cookie});
 assert.equal(listed.data.sales.orgs.length,11);
 const saved=await f.request('/review/article',{method:'PUT',cookie:admin.cookie,data:{
  id,status:'pending',offerings:['咨询','知识库'],buyerRole:'工程局',salesStage:'了解需求',watchOrgId:'u-cscec3b',summary:'人工摘要。'
 }});
 assert.equal(saved.status,200,JSON.stringify(saved.data));
 assert.deepEqual(saved.data.article.editorial.offerings,['咨询','知识库']);
 assert.equal(saved.data.article.editorial.salesStage,'了解需求');
 assert.equal(saved.data.public.offerings,undefined);
 assert.equal(saved.data.public.salesStage,undefined);
 assert.equal(saved.data.public.watchOrgId,undefined);
 const publicItem=(await f.request('/articles')).data.articles[0];
 assert.equal(publicItem.offerings,undefined);
 assert.equal(publicItem.salesStage,undefined);
 assert.equal(publicItem.buyerRole,undefined);
 assert.equal(publicItem.watchOrgId,undefined);
 assert.equal((await f.request('/review/article',{method:'PUT',cookie:admin.cookie,data:{id,status:'pending',offerings:['咨询','不相关']}})).status,400);
 assert.equal((await f.request('/review/article',{method:'PUT',cookie:admin.cookie,data:{id,status:'pending',offerings:['翻译'],salesStage:'可破冰',watchOrgId:'m-glodon'}})).status,400);
 await f.app.collector.run();
 const after=JSON.parse(f.db.prepare('SELECT data FROM articles').get().data);
 assert.deepEqual(after.editorial.offerings,['咨询','知识库']);
 assert.equal(after.editorial.watchOrgId,'u-cscec3b');
});
test('archived collector items stay public and P0 extraction cannot verify or ice-break',async t=>{
 const feed=`<rss><channel>
  <item><title>Generic AI construction note</title><link>https://example.org/a/low</link><description>AI construction.</description></item>
  <item><title>中建三局发布数智化规划并启动智能建造试点</title><link>https://example.org/a/lead</link><description>工程局数据治理与数字化部门。</description></item>
 </channel></rss>`;
 let llmCalls=0;
 const f=await fixture(t,{
  feed,
  config:{reviewModelUrl:'https://llm.test/v1/chat/completions',reviewModelKey:'k',reviewModel:'gpt-4o-mini'},
  fetchImpl:async url=>{
   if(String(url).endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
   if(String(url).includes('/chat/completions')){
    llmCalls++;
    return Response.json({choices:[{message:{content:JSON.stringify({summary:'中建三局启动试点',implication:'可破冰，准确率 98%，见 https://evil.example/x',offerings:['咨询'],salesStage:'可破冰',needsHuman:false})}}]});
   }
   return new Response(feed,{headers:{'Content-Type':'application/rss+xml'}});
  }
 });
 const admin=await f.login('admin@example.test');
 await f.request('/model-config',{method:'PUT',cookie:admin.cookie,data:{automation:{useModelTranslation:false}}});
 await f.app.collector.run();
 await f.app.collector.ready();
 const work=(await f.request('/review/articles?status=work',{cookie:admin.cookie})).data;
 const archived=(await f.request('/review/articles?status=archived',{cookie:admin.cookie})).data;
 assert.equal(archived.articles.length,1);
 assert.equal(work.articles.length,1);
 assert.equal(work.articles[0].article.assistScore.priority,'P0');
 assert.equal(work.articles[0].article.machineReview.salesStage,'了解需求');
 assert.doesNotMatch(work.articles[0].article.machineReview.implication||'',/98|https?:/);
 assert.equal(llmCalls,2); // 主评审 + 第二次独立评分
 const publicItems=(await f.request('/articles')).data.articles;
 assert.equal(publicItems.length,2);
 assert.ok(publicItems.every(a=>a.evidence==='待复核'&&!a.reviewed&&!a.verificationRecord));
 const archivedPublic=publicItems.find(a=>a.reviewStatus==='archived');
 const leadPublic=publicItems.find(a=>a.machineReview);
 assert.ok(archivedPublic);
 assert.ok(leadPublic?.machineReview?.note.includes('待复核'));
 assert.equal(leadPublic.evidence,'待复核');
});
test('manual intake registers pending leads without scraping the page',async t=>{
  const f=await fixture(t);
  const admin=await f.login('admin@example.test');
  const before=(await f.request('/articles')).data.articles.length;
  const ok=await f.request('/intake',{method:'POST',data:{sourceUrl:'https://mp.weixin.qq.com/s/abc123',title:'中建三局发布土木行业大模型与知识库平台',quote:'摘录：面向全院科室的企业知识库。',note:'公众号线索，需回链确认。',sourceLabel:'中建三局公众号',watchOrgId:'u-cscec3b',publishedDate:'2026-09-17'},cookie:admin.cookie});
  assert.equal(ok.status,200,JSON.stringify(ok.data));
  assert.equal(ok.data.article.evidence,'待复核');
  assert.equal(ok.data.article.dataOrigin,'manual');
  assert.equal(ok.data.article.editorial.watchOrgId,'u-cscec3b');
  assert.equal(ok.data.article.reading.kind,'manual-clip');
  const dup=await f.request('/intake',{method:'POST',data:{sourceUrl:'https://mp.weixin.qq.com/s/abc123',title:'重复链接'},cookie:admin.cookie});
  assert.equal(dup.status,409);
  assert.equal((await f.request('/intake',{method:'POST',data:{sourceUrl:'not-a-url',title:'坏链接'},cookie:admin.cookie})).status,400);
  const reader=await f.login();
  assert.equal((await f.request('/intake',{method:'POST',data:{sourceUrl:'https://x.example/a',title:'越权'},cookie:reader.cookie})).status,403);
  const after=(await f.request('/articles')).data.articles;
  assert.equal(after.length,before+1);
  const entry=after.find(a=>a.sourceUrl==='https://mp.weixin.qq.com/s/abc123');
  assert.equal(entry.reviewStatus,'pending');
  assert.equal(entry.dataOrigin,'manual');
});
test('model config panel is admin-only, masks keys and drives machine review without restart',async t=>{
 const feed=`<rss><channel>
  <item><title>Generic AI construction note</title><link>https://example.org/a/low</link><description>AI construction.</description></item>
  <item><title>中建三局发布数智化规划并启动智能建造试点</title><link>https://example.org/a/lead</link><description>工程局数据治理与数字化部门。</description></item>
 </channel></rss>`;
 let llmCalls=0;let authHeader='';let bodyModel='';
 const f=await fixture(t,{feed,fetchImpl:async(url,options)=>{
   if(String(url).endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
   if(String(url).includes('/chat/completions')){
    llmCalls++;authHeader=options.headers.Authorization;bodyModel=JSON.parse(options.body).model;
    return Response.json({choices:[{message:{content:JSON.stringify({summary:'中建三局启动智能建造试点',implication:'或反映工程局数智化需求，建议人工回链确认。',offerings:['咨询'],salesStage:'了解需求',needsHuman:true})}}]});
   }
   if(String(url).endsWith('/models')){
    assert.equal(options.headers.Authorization,'Bearer sk-secret-123456');
    return Response.json({data:[{id:'glm-b'},{id:'glm-a'},{id:'glm-a'}]});
   }
   return new Response(feed,{headers:{'Content-Type':'application/rss+xml'}});
 }});
 const admin=await f.login('admin@example.test');const reader=await f.login();
 assert.equal((await f.request('/model-config',{cookie:reader.cookie})).status,403);
 assert.equal((await f.request('/model-config',{method:'PUT',cookie:reader.cookie,data:{url:'https://llm.test/v1/chat/completions'}})).status,403);
 assert.equal((await f.request('/model-config/test',{method:'POST',cookie:reader.cookie,data:{}})).status,403);
 assert.equal((await f.request('/model-config/models',{method:'POST',cookie:reader.cookie,data:{}})).status,403);
 assert.equal((await f.request('/model-config/backfill',{method:'POST',cookie:reader.cookie,data:{}})).status,403);
 assert.equal((await f.request('/model-config/models',{method:'POST',cookie:admin.cookie,data:{baseUrl:'https://llm.test/v1'}})).status,400);
 const before=(await f.request('/model-config',{cookie:admin.cookie})).data;
 assert.equal(before.enabled,false);assert.equal(before.keySet,false);
 assert.equal((await f.request('/model-config',{method:'PUT',cookie:admin.cookie,data:{url:'http://example.com/v1/chat/completions'}})).status,400);
 const saved=(await f.request('/model-config',{method:'PUT',cookie:admin.cookie,data:{url:'https://llm.test/v1/chat/completions',key:'sk-secret-123456',model:'panel-model'}})).data;
 assert.equal(saved.enabled,true);assert.equal(saved.model,'panel-model');assert.ok(saved.keyMasked);
 assert.ok(!JSON.stringify(saved).includes('sk-secret-123456'));
 const probed=(await f.request('/model-config/test',{method:'POST',cookie:admin.cookie,data:{}})).data;
 assert.equal(probed.ok,true);assert.equal(probed.model,'panel-model');assert.equal(authHeader,'Bearer sk-secret-123456');
 assert.equal((await f.request('/model-config/test',{method:'POST',cookie:admin.cookie,data:{url:'https://llm.test/broken'}})).status,400);
 const listed=(await f.request('/model-config/models',{method:'POST',cookie:admin.cookie,data:{baseUrl:'https://llm.test/v1/chat/completions/'}})).data;
 assert.deepEqual(listed.models,['glm-a','glm-b']);
 assert.equal((await f.request('/model-config/models',{method:'POST',cookie:admin.cookie,data:{baseUrl:'https://llm.test/nokey'}})).status,200);
 const resaved=(await f.request('/model-config',{method:'PUT',cookie:admin.cookie,data:{url:'https://llm.test/v1/chat/completions',key:'sk-secret-123456',model:'panel-model'}})).data;
 assert.equal(resaved.keyUnchanged,true);
 const rekeyed=(await f.request('/model-config',{method:'PUT',cookie:admin.cookie,data:{url:'https://llm.test/v1/chat/completions',key:'sk-fresh-987654',model:'panel-model'}})).data;
 assert.equal(rekeyed.keyUnchanged,false);
 await f.request('/model-config',{method:'PUT',cookie:admin.cookie,data:{automation:{useModelTranslation:false}}});
 await f.app.collector.run();await f.app.collector.ready();
 assert.equal(llmCalls,3);assert.equal(bodyModel,'panel-model'); // 探测 1 + 主评审 1 + 独立评分 1
 const lead=JSON.parse(f.db.prepare("SELECT data FROM articles WHERE url='https://example.org/a/lead'").get().data);
 assert.equal(lead.machineReview.model,'panel-model');assert.ok(lead.machineReview.note.includes('待复核'));
 assert.equal((await f.request('/model-config/backfill',{method:'POST',cookie:admin.cookie,data:{}})).status,200);
 for(let i=0;i<100&&f.app.machineReview.status().running;i++)await new Promise(r=>setTimeout(r,10));
 const afterBackfill=(await f.request('/model-config',{cookie:admin.cookie})).data;
 assert.ok(afterBackfill.review.lastRun);assert.equal(afterBackfill.review.lastRun.report.archived,1);
 assert.ok((await f.request('/collector/status')).data.modelReview.enabled);
 const cleared=(await f.request('/model-config',{method:'PUT',cookie:admin.cookie,data:{key:''}})).data;
 assert.equal(cleared.enabled,false);assert.equal(cleared.keySet,false);assert.equal(cleared.source.url,'settings');
 const restored=(await f.request('/model-config',{method:'PUT',cookie:admin.cookie,data:{url:'',model:''}})).data;
 assert.equal(restored.enabled,false);assert.equal(restored.overrides.url,false);assert.equal(restored.source.url,'none');
});
test('saved model key stays identifiable and viewable by the admin without re-entering it',async t=>{
 const feed=`<rss><channel></channel></rss>`;
 let llmCalls=0;
 const f=await fixture(t,{feed,fetchImpl:async(url,options)=>{
   if(String(url).endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
   if(String(url).includes('/chat/completions')){llmCalls++;assert.equal(options.headers.Authorization,'Bearer sk-live-abcdef123456xyz789');return Response.json({choices:[{message:{content:'ok'}}]});}
   return new Response(feed,{headers:{'Content-Type':'application/rss+xml'}});
 }});
 const admin=await f.login('admin@example.test');const reader=await f.login();
 assert.equal((await f.request('/model-config/reveal',{cookie:reader.cookie})).status,403);
 const key='sk-live-abcdef123456xyz789';
 const saved=(await f.request('/model-config',{method:'PUT',cookie:admin.cookie,data:{url:'https://llm.test/v1/chat/completions',key,model:'panel-model'}})).data;
 assert.equal(saved.keySet,true);assert.equal(saved.keyMasked,'sk-liv…xyz789');
 assert.ok(!JSON.stringify(saved).includes(key));
 assert.equal((await f.request('/model-config/reveal',{cookie:admin.cookie})).data.key,key);
 // 换模型时不重贴 Key：连接测试与保存都沿用已保存的 Key。
 const probed=(await f.request('/model-config/test',{method:'POST',cookie:admin.cookie,data:{url:'https://llm.test/v1/chat/completions',model:'panel-model'}})).data;
 assert.equal(probed.ok,true);assert.equal(llmCalls,1);
 const resaved=(await f.request('/model-config',{method:'PUT',cookie:admin.cookie,data:{url:'https://llm.test/v1/chat/completions',model:'next-model'}})).data;
 assert.equal(resaved.keyUnchanged,true);assert.equal(resaved.keySet,true);assert.equal(resaved.model,'next-model');
 assert.equal((await f.request('/model-config/reveal',{cookie:admin.cookie})).data.key,key);
 const cleared=(await f.request('/model-config',{method:'PUT',cookie:admin.cookie,data:{key:''}})).data;
 assert.equal(cleared.keySet,false);
 assert.equal((await f.request('/model-config/reveal',{cookie:admin.cookie})).status,400);
});
test('AI sales pre-review archives low-value leads, ranks the desk by sales value and respects the toggle',async t=>{
 const feed=`<rss><channel>
  <item><title>Generic AI construction note</title><link>https://example.org/a/low</link><description>AI construction.</description></item>
  <item><title>中建三局发布数智化规划并启动智能建造试点</title><link>https://example.org/a/lead</link><description>工程局数据治理与数字化部门。</description></item>
 </channel></rss>`;
 const llm=response=>async url=>{
   if(String(url).endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
   if(String(url).includes('/chat/completions'))return Response.json({choices:[{message:{content:JSON.stringify(response)}}]});
   return new Response(feed,{headers:{'Content-Type':'application/rss+xml'}});
 };
 const model={reviewModelUrl:'https://llm.test/v1/chat/completions',reviewModelKey:'k',reviewModel:'m1'};
 const low={summary:'中建三局启动智能建造试点',implication:'或反映工程局数智化需求，建议人工回链确认。',offerings:['咨询'],salesStage:'了解需求',needsHuman:true,salesValue:12,salesVerdict:'低价值',verdictReason:'假设买家信号牵强，暂列低价值。'};
 const high={...low,salesValue:85,salesVerdict:'重点跟进',verdictReason:'假设买家明确且可行动，准确率 99%。'};
 const f1=await fixture(t,{feed,fetchImpl:llm(low),config:model});
 await f1.app.collector.run();await f1.app.collector.ready();
 const admin1=await f1.login('admin@example.test');
 assert.equal((await f1.request('/review/articles?status=work',{cookie:admin1.cookie})).data.articles.length,0);
 assert.equal((await f1.request('/review/articles?status=archived',{cookie:admin1.cookie})).data.articles.length,2);
 const lead1=JSON.parse(f1.db.prepare("SELECT data FROM articles WHERE url='https://example.org/a/lead'").get().data);
 assert.equal(lead1.editorial.status,'archived');assert.equal(lead1.editorial.reviewer,'machine-review');
 assert.ok(lead1.editorial.notes.includes('低价值'));
 assert.equal(lead1.machineReview.salesVerdict,'低价值');assert.equal(lead1.machineReview.salesValue,12);
 assert.equal(lead1.editorial.verificationRecord,undefined);
 assert.equal((await f1.request('/articles')).data.articles.length,2);
 assert.equal((await f1.request('/model-config/backfill',{method:'POST',cookie:admin1.cookie,data:{}})).status,200);
 for(let i=0;i<100&&f1.app.machineReview.status().running;i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(f1.app.machineReview.status().lastRun.report.autoArchived,1);
 const f2=await fixture(t,{feed,fetchImpl:llm(high),config:model});
 await f2.app.collector.run();await f2.app.collector.ready();
 const admin2=await f2.login('admin@example.test');
 const work2=(await f2.request('/review/articles?status=work',{cookie:admin2.cookie})).data;
 assert.equal(work2.articles.length,1);
 assert.equal(work2.articles[0].article.machineReview.salesValue,85);
 assert.equal(work2.articles[0].article.machineReview.salesVerdict,'重点跟进');
 assert.doesNotMatch(work2.articles[0].article.machineReview.verdictReason,/99|https?:/);
 assert.match(work2.articles[0].article.machineReview.verdictReason,/规则评分分档|假设/);
 const f3=await fixture(t,{feed,fetchImpl:llm(low),config:model});
 const admin3=await f3.login('admin@example.test');
 const off=(await f3.request('/model-config',{method:'PUT',cookie:admin3.cookie,data:{automation:{autoArchiveLow:false}}})).data;
 assert.equal(off.automation.autoArchiveLow,false);
 await f3.app.collector.run();await f3.app.collector.ready();
 assert.equal((await f3.request('/review/articles?status=work',{cookie:admin3.cookie})).data.articles.length,1);
 const on=(await f3.request('/model-config',{method:'PUT',cookie:admin3.cookie,data:{automation:{autoArchiveLow:true}}})).data;
 assert.equal(on.automation.autoArchiveLow,true);
 assert.equal((await f3.request('/model-config',{method:'PUT',cookie:admin3.cookie,data:{automation:{autoArchiveLow:'yes'}}})).status,400);
});
