import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {createModelCalls,REVIEW_FAILURE_RETRY_MS} from '../server/modelCalls.mjs';
import {createMachineReview} from '../server/machineReview.mjs';
import {createTranslator} from '../server/translation.mjs';
import {reviewPrompt,translatePrompt} from '../server/prompts.mjs';

const MODEL_URL='https://model.example/chat/completions';
const reviewPayload={summary:'机器整理草稿',implication:'假设有参考价值。',offerings:[],maturity:'未披露',engineeringStage:'',salesStage:'',needsHuman:true,salesValue:50,salesVerdict:'观察',verdictReason:'证据不足，观察。',extracted:{amounts:[],deadline:'',clientOrgs:[]}};

function insertArticle(db,id,patch={}){
  const article={id,url:'https://example.org/a/'+id,title:'中国建筑集团智慧工地人工智能平台采购公告',source:'测试源',
    summary:'中国建筑集团就智慧工地人工智能平台公开采购。',publishedAt:'2026-09-01T00:00:00.000Z',firstSeenAt:'2026-09-01T00:00:00.000Z',
    dataOrigin:'collector',editorial:{status:'pending'},...patch};
  db.prepare('INSERT INTO articles(id,url,data,content_hash,first_seen,updated_at) VALUES(?,?,?,?,?,?)')
    .run(id,article.url,JSON.stringify(article),'h'+id,Date.parse('2026-09-01T00:00:00Z'),Date.parse('2026-09-01T00:00:00Z'));
  return article;
}
function modelSettingsStub(url=MODEL_URL,key='sk-test'){
  return {effective:()=>({url,key,model:'glm-test'}),automation:()=>({useModelTranslation:true,autoArchiveLow:true})};
}

test('prompts are external files with stable content-hash versions',()=>{
  assert.match(reviewPrompt.version,/^[0-9a-f]{10}$/);
  assert.match(translatePrompt.version,/^[0-9a-f]{10}$/);
  assert.ok(reviewPrompt.content.includes('salesValue'));
  assert.ok(translatePrompt.content.includes('专业翻译'));
  assert.notEqual(reviewPrompt.version,translatePrompt.version);
});

test('ledger records usage on success and status on failure; failedRecently honors the time window',async()=>{
  const db=openDatabase(':memory:');
  let time=Date.parse('2026-09-07T09:00:00Z');
  const calls=createModelCalls({db,now:()=>time});
  const key=calls.key(['review','a1','glm-test',reviewPrompt.version]);
  assert.equal(calls.failedRecently(key),false);
  await assert.rejects(calls.track({purpose:'review',scope:'site',model:'glm-test',promptVersion:reviewPrompt.version,logicalKey:key,target:'a1'},async()=>{const e=new Error('Review model HTTP 502');e.httpStatus=502;throw e;}),/502/);
  assert.equal(calls.failedRecently(key),true);
  const failed=db.prepare('SELECT * FROM model_calls WHERE logical_key=?').get(key);
  assert.equal(failed.ok,0);assert.equal(failed.http_status,502);assert.equal(failed.error,'Review model HTTP 502');
  // 24 小时窗口外不再视为近期失败。
  time+=REVIEW_FAILURE_RETRY_MS+1;
  assert.equal(calls.failedRecently(key),false);
  // 成功调用记录 token 用量。
  const result=await calls.track({purpose:'translate',scope:'site',model:'glm-test',promptVersion:translatePrompt.version,logicalKey:calls.key(['t']),target:'a1'},async()=>({choices:[],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}));
  const okRow=db.prepare("SELECT * FROM model_calls WHERE ok=1 AND purpose='translate'").get();
  assert.equal(JSON.parse(okRow.usage).total_tokens,15);
  const summary=calls.summary(30);
  assert.equal(summary.totals.find(t=>t.purpose==='review').calls,1);
  assert.equal(summary.totals.find(t=>t.purpose==='review').failures,1);
  assert.equal(summary.totals.find(t=>t.purpose==='translate').tokens,15);
  db.close();
});

test('machine review failures are recorded and not re-paid within the retry window',async()=>{
  const db=openDatabase(':memory:');
  let time=Date.parse('2026-09-07T09:00:00Z');
  let fetchCount=0;
  const fetchImpl=async()=>{fetchCount++;return Response.json({error:'boom'},{status:500});};
  const review=createMachineReview({db,config:{reviewModelUrl:MODEL_URL,reviewModelKey:'sk-test',reviewModel:'glm-test'},fetchImpl,now:()=>time});
  insertArticle(db,'feed-a1');
  const first=await review.triage(['feed-a1']);
  assert.equal(first.failed,1);assert.equal(fetchCount,1);
  let row=db.prepare("SELECT * FROM model_calls WHERE purpose='review'").get();
  assert.equal(row.ok,0);assert.equal(row.http_status,500);assert.equal(row.prompt_version,reviewPrompt.version);
  // 再次 triage（含重启后的全量补跑场景）：24 小时内不重复付费。
  const second=await review.triage(['feed-a1']);
  assert.equal(second.throttled,1);assert.equal(fetchCount,1);
  // 窗口过后允许重试。
  time+=REVIEW_FAILURE_RETRY_MS+1;
  const third=await review.triage(['feed-a1']);
  assert.equal(third.failed,1);assert.equal(fetchCount,2);
  db.close();
});

test('machine review success stamps promptVersion and records usage',async()=>{
  const db=openDatabase(':memory:');
  const review=createMachineReview({db,config:{reviewModelUrl:MODEL_URL,reviewModelKey:'sk-test',reviewModel:'glm-test'},
    fetchImpl:async()=>Response.json({choices:[{message:{content:JSON.stringify(reviewPayload)}}],usage:{total_tokens:88}}),now:()=>Date.parse('2026-09-07T09:00:00Z')});
  insertArticle(db,'feed-a2');
  const report=await review.triage(['feed-a2']);
  assert.equal(report.extracted,1);
  const stored=JSON.parse(db.prepare('SELECT data FROM articles WHERE id=?').get('feed-a2').data);
  assert.equal(stored.machineReview.model,'glm-test');
  assert.equal(stored.machineReview.promptVersion,reviewPrompt.version);
  const row=db.prepare("SELECT * FROM model_calls WHERE purpose='review'").get();
  assert.equal(row.ok,1);assert.equal(JSON.parse(row.usage).total_tokens,88);
  db.close();
});

test('model 200 with unparseable content is a ledger failure and is not re-paid within the window',async()=>{
  const db=openDatabase(':memory:');
  let time=Date.parse('2026-09-07T09:00:00Z');
  let fetchCount=0;
  const review=createMachineReview({db,config:{reviewModelUrl:MODEL_URL,reviewModelKey:'sk-test',reviewModel:'glm-test'},
    fetchImpl:async()=>{fetchCount++;return Response.json({choices:[{message:{content:'这不是合法 JSON'}}]});},now:()=>time});
  insertArticle(db,'feed-g1');
  const first=await review.triage(['feed-g1']);
  assert.equal(first.failed,1);assert.equal(fetchCount,1);
  const row=db.prepare("SELECT * FROM model_calls WHERE purpose='review'").get();
  assert.equal(row.ok,0);assert.equal(row.http_status,null);assert.match(row.error,/JSON/);
  const stored=JSON.parse(db.prepare('SELECT data FROM articles WHERE id=?').get('feed-g1').data);
  assert.equal(stored.machineReview.model,'rules');
  // 24 小时窗口内不再为同一逻辑调用付费（回落规则并计 throttled）。
  const second=await review.triage(['feed-g1']);
  assert.equal(second.throttled,1);assert.equal(fetchCount,1);
  db.close();
});

test('translation auth failures do not amplify into per-paragraph paid retries',async()=>{
  const db=openDatabase(':memory:');
  let fetchCount=0;
  const translator=createTranslator({db,config:{},fetchImpl:async()=>{
    fetchCount++;
    return Response.json({error:{message:'令牌已过期或验证不正确'}},{status:401});
  },now:()=>Date.now(),modelSettings:modelSettingsStub()});
  insertArticle(db,'feed-t1',{reading:{originalLanguage:'en',paragraphs:{en:['AI construction summary paragraph one.','Second paragraph about smart bridges.']}}});
  await assert.rejects(translator.translate('feed-t1','zh'),error=>error.status===502&&/HTTP 401/.test(error.message));
  // 多段批次在 401 下不再逐段重发：一次失败就是一次计费调用。
  assert.equal(fetchCount,1);
  const row=db.prepare("SELECT * FROM model_calls WHERE purpose='translate'").get();
  assert.equal(row.ok,0);assert.equal(row.http_status,401);assert.equal(row.scope,'site');
  db.close();
});

test('translation batch degrade still applies for transient server errors and success records usage',async()=>{
  const db=openDatabase(':memory:');
  let time=Date.now();
  const responses=[500,200,200];
  let call=0;
  const translator=createTranslator({db,config:{},fetchImpl:async(url,opts)=>{
    if(String(url)!==MODEL_URL)return new Response('User-agent: *\nAllow: /');
    const status=responses[call++];
    if(status!==200)return Response.json({error:'upstream'},{status});
    const requested=JSON.parse(opts.body).messages[1].content;
    const count=JSON.parse(requested).paragraphs.length;
    const pool=['智能建造第一段摘要。','桥梁智能巡检第二段。'];
    const body={choices:[{message:{content:JSON.stringify({translations:pool.slice(0,count)})}}],usage:{total_tokens:66}};
    return Response.json(body);
  },now:()=>time,modelSettings:modelSettingsStub()});
  insertArticle(db,'feed-t2',{reading:{originalLanguage:'en',paragraphs:{en:['AI construction summary paragraph one.','Second paragraph about smart bridges.']}}});
  // 瞬时 5xx：批次失败仍降级为逐段单发（2 段 = 共 3 次调用），最终成功并入缓存。
  const result=await translator.translate('feed-t2','zh');
  assert.equal(result.reading.paragraphs.zh.length,2);
  assert.equal(result.reading.translationLabel,'机器翻译 · 待校对');
  const rows=db.prepare("SELECT * FROM model_calls WHERE purpose='translate' ORDER BY id").all();
  assert.equal(rows.length,3);
  assert.equal(rows[0].ok,0);assert.equal(rows[0].http_status,500);
  assert.equal(rows[2].ok,1);assert.equal(JSON.parse(rows[2].usage).total_tokens,66);
  db.close();
});

test('dual scoring averages two independent scores and falls back to 观察 on disagreement',async()=>{
  const db=openDatabase(':memory:');
  // 主评审返回 85/重点跟进，第二次独立评分返回 40/低价值：均值 62，分档不一致 → 保守归观察。
  let call=0;
  const review=createMachineReview({db,config:{reviewModelUrl:MODEL_URL,reviewModelKey:'sk-test',reviewModel:'glm-test'},
    fetchImpl:async()=>{
      call++;
      const payload=call===1?{...reviewPayload,salesValue:85,salesVerdict:'重点跟进',verdictReason:'假设买家明确。'}:{salesValue:40,salesVerdict:'低价值',verdictReason:'假设场景牵强。'};
      return Response.json({choices:[{message:{content:JSON.stringify(payload)}}]});
    },now:()=>Date.parse('2026-09-07T09:00:00Z')});
  insertArticle(db,'feed-d1');
  await review.triage(['feed-d1']);
  const stored=JSON.parse(db.prepare('SELECT data FROM articles WHERE id=?').get('feed-d1').data);
  assert.equal(stored.machineReview.salesValue,62);
  assert.equal(stored.machineReview.salesVerdict,'观察');
  assert.match(stored.machineReview.verdictReason,/两次独立评分分档不一致/);
  assert.deepEqual(stored.machineReview.scoreCalls,[85,40]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM model_calls WHERE purpose='review-score'").get().n,1);
  db.close();
});

test('dual scoring keeps the agreed verdict and stores both scores',async()=>{
  const db=openDatabase(':memory:');
  let call=0;
  const review=createMachineReview({db,config:{reviewModelUrl:MODEL_URL,reviewModelKey:'sk-test',reviewModel:'glm-test'},
    fetchImpl:async()=>{
      call++;
      const payload=call===1?{...reviewPayload,salesValue:90,salesVerdict:'重点跟进',verdictReason:'假设买家明确。'}:{salesValue:80,salesVerdict:'重点跟进',verdictReason:'假设可行动。'};
      return Response.json({choices:[{message:{content:JSON.stringify(payload)}}]});
    },now:()=>Date.parse('2026-09-07T09:00:00Z')});
  insertArticle(db,'feed-d2');
  await review.triage(['feed-d2']);
  const stored=JSON.parse(db.prepare('SELECT data FROM articles WHERE id=?').get('feed-d2').data);
  assert.equal(stored.machineReview.salesValue,85);
  assert.equal(stored.machineReview.salesVerdict,'重点跟进');
  assert.deepEqual(stored.machineReview.scoreCalls,[90,80]);
  db.close();
});

test('second score call failure does not block the main review and is not re-paid within the window',async()=>{
  const db=openDatabase(':memory:');
  let time=Date.parse('2026-09-07T09:00:00Z');
  let call=0;
  const review=createMachineReview({db,config:{reviewModelUrl:MODEL_URL,reviewModelKey:'sk-test',reviewModel:'glm-test'},
    fetchImpl:async()=>{
      call++;
      if(call===1)return Response.json({choices:[{message:{content:JSON.stringify({...reviewPayload,salesValue:70,salesVerdict:'重点跟进'})}}]});
      return Response.json({error:'boom'},{status:500});
    },now:()=>time});
  insertArticle(db,'feed-d3');
  const first=await review.triage(['feed-d3']);
  assert.equal(first.extracted,1);
  const stored=JSON.parse(db.prepare('SELECT data FROM articles WHERE id=?').get('feed-d3').data);
  assert.equal(stored.machineReview.salesValue,70);
  assert.equal(stored.machineReview.salesVerdict,'重点跟进');
  assert.equal(stored.machineReview.scoreCalls,undefined);
  // 重跑（窗口内）：已有完整模型结果直接跳过，不新增调用。
  const second=await review.triage(['feed-d3']);
  assert.equal(second.skipped,1);assert.equal(call,2);
  db.close();
});

test('site budget cap pauses machine review and site translations honestly, user keys unaffected',async()=>{
  const db=openDatabase(':memory:');
  const calls=createModelCalls({db,now:()=>Date.parse('2026-09-07T09:00:00Z')});
  assert.equal(calls.overBudget(0),false); // 0 = 不限制
  // 预置 2 条站点调用记录，上限 2 → 已超。
  for(const purpose of ['translate','translate']){
    await calls.track({purpose,scope:'site',model:'glm-test',promptVersion:'v',logicalKey:calls.key(['seed',purpose]),target:'x'},async()=>({choices:[]}));
  }
  assert.equal(calls.overBudget(2),true);
  const settings={effective:()=>({url:MODEL_URL,key:'sk-test',model:'glm-test'}),automation:()=>({useModelTranslation:true,autoArchiveLow:true,dailyModelCallCap:2})};
  const review=createMachineReview({db,config:{},fetchImpl:async()=>{throw new Error('should not be called');},now:()=>Date.parse('2026-09-07T09:00:00Z'),modelSettings:settings,modelCalls:calls});
  insertArticle(db,'feed-b1');
  const report=await review.triage(['feed-b1']);
  assert.equal(report.budgetBlocked,1);
  const stored=JSON.parse(db.prepare('SELECT data FROM articles WHERE id=?').get('feed-b1').data);
  assert.equal(stored.machineReview.model,'rules');
  // 站点作用域翻译同样熔断并如实说明；用户自己的 Key 不受限。
  const translator=createTranslator({db,config:{},fetchImpl:async()=>{throw new Error('should not be called');},now:()=>Date.parse('2026-09-07T09:00:00Z'),modelSettings:settings,modelCalls:calls});
  insertArticle(db,'feed-b2',{reading:{originalLanguage:'en',paragraphs:{en:['Smart construction summary.']}}});
  await assert.rejects(translator.translate('feed-b2','zh'),error=>error.status===503&&/上限/.test(error.message));
  const personal=createTranslator({db,config:{},fetchImpl:async()=>Response.json({choices:[{message:{content:JSON.stringify({translations:['智能建造摘要。']})}}]}),now:()=>Date.parse('2026-09-07T09:00:00Z'),modelSettings:settings,modelCalls:calls});
  insertArticle(db,'feed-b3',{reading:{originalLanguage:'en',paragraphs:{en:['Smart construction summary.']}}});
  const result=await personal.translate('feed-b3','zh',{userCall:true,userSettings:{effective:()=>({url:MODEL_URL,key:'sk-own',model:'glm-test',enabled:true})}});
  assert.equal(result.reading.paragraphs.zh.length,1);
  db.close();
});
